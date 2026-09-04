import {
  Table,
  SaleItem,
  Product,
  Sale,
  OrderPriority,
  Order,
  KitchenOrder
} from "../entities/Entities";

import { IRepository } from "../../infrastructure/di/repositories/IRepository";
import { isOptimisticLockError } from "../errors/OptimisticLockError";

import { CartEngine } from "./CartEngine";
import { SalesEngine, DiscountInput } from "./SalesEngine";
import { KitchenEngine } from "./KitchenEngine";
import { companyConfigStore } from "../store/companyConfigStore";
import { OrderEngine } from "./OrderEngine";
import { PaymentMethod, PaymentResult } from "./PaymentEngine";
import { Receipt } from "./ReceiptEngine";

import { vimdyCore } from "../VimdyCore";
import { logWarning } from "../../infrastructure/logging/opsLogger";
import { kitchenOutputModeStore } from "../store/kitchenOutputModeStore";
import { createKitchenOutput } from "../services/KitchenOutputFactory";
import { getCurrentBusinessId, getCurrentBranchId } from "../../infrastructure/supabase/supabaseClient";
import { connectionStore } from "../store/connectionStore";
import { TableLocalRepository } from "../../infrastructure/di/repositories/TableLocalRepository";
import { queueOpenTableOffline, queueCloseTableOffline, queueAddItemOffline, queueRemoveItemOffline, queueUpdateQuantityOffline, queueSendToKitchenOffline } from "../services/offlineTable";

/* ===========================================================================
   TableEngine
   ---------------------------------------------------------------------------
   Motor de administración de mesas de VIMDY OS. No vende, no cobra y no
   imprime: es el "recepcionista" del restaurante — controla el ciclo de
   vida completo de cada mesa (libre → ocupada → comiendo → pagando → libre)
   y delega en SalesEngine todo lo relacionado con dinero, inventario, cocina
   y recibo en el momento del cobro.

   FUENTE DE VERDAD DEL PEDIDO EN CURSO (base #3 del checklist de
   lanzamiento):
   ---------------------------------------------------------------------------
   El pedido de cada mesa vive ÚNICAMENTE en `Table.items`, la fila real de
   `tableRepository` (Supabase). Este engine NO guarda un carrito propio en
   memoria por mesa: cada operación (agregar/quitar producto, enviar a
   cocina, cobrar) empieza siempre releyendo la mesa desde el repositorio.

   Por qué importa: VIMDY corre en varios dispositivos a la vez para el
   mismo negocio (el celular del mesero, la tablet de otro mesero, el
   computador de Caja). Si el "pedido en curso" viviera en un Map en
   memoria de este engine, cada dispositivo tendría su PROPIA copia —
   el mesero podría agregar productos en su celular y el cajero, en el
   computador de al lado, no vería nada porque su instancia de TableEngine
   nunca abrió esa mesa. Con la mesa persistida como única fuente, todos
   los dispositivos leen y escriben sobre la misma fila: no hay "versión
   propia" posible ni para un mesero ni para un cajero.

   Qué pasa si dos dispositivos editan la MISMA mesa casi al mismo tiempo:
   Table.version (bloqueo optimista, ya soportado por SupabaseRepository)
   detecta el choque. Para operaciones de items (agregar/quitar/cambiar
   cantidad) esto se resuelve solo: se relee la versión más reciente y se
   reaplica el cambio encima, en vez de perderlo o de mostrarle un error al
   mesero por algo tan normal como que otro compañero tocó la misma mesa un
   segundo antes. Para operaciones estructurales (abrir, cobrar, transferir,
   unir) el conflicto SÍ se propaga como OptimisticLockError — la UI ya lo
   atrapa (ver TableDetailPanel.tsx) y refresca para que el usuario reintente
   sobre datos actuales, que es lo correcto cuando lo que chocó fue, por
   ejemplo, un intento de cobro.

   Conexiones directas (obligatorias):
     - KitchenEngine      → envío de comandas mientras la mesa sigue abierta.
     - SalesEngine        → generación de la venta y cobro al cerrar la mesa.
     - IRepository<Table> → persistencia y única fuente de verdad de las mesas.
     - vimdyCore          → emisión de eventos ("table") para el resto de VIMDY
                             (Dashboard, Alertas, IA, etc) y para que otros
                             dispositivos refresquen su grid (ver
                             realtimeSync.ts + Meseros.tsx).

   Conexiones PROHIBIDAS (por diseño):
     - InventoryEngine, PaymentEngine, ReceiptEngine, CashEngine, CustomerEngine
       Estos solo se tocan a través de SalesEngine.tableSale()/registerPayment(),
       nunca directamente desde TableEngine.
=========================================================================== */

export interface CreateTableInput {
  readonly name: string;
  readonly capacity: number;
  readonly zone?: string;
  readonly businessId?: string;
  readonly branchId?: string;
}

export interface OpenTableInput {
  readonly tableId: string;
  readonly peopleCount: number;
  readonly waiterId?: string;
  readonly customerId?: string;
  readonly notes?: string;
  readonly operationId?: string;
}

export interface AddProductInput {
  readonly tableId: string;
  readonly product: Product;
  readonly quantity?: number;
  /** Nota/observación del mesero para este producto (ej: "sin arroz"). */
  readonly note?: string;
}

export interface CloseTableInput {
  readonly tableId: string;
  readonly method: PaymentMethod;
  readonly cashierId?: string;
  readonly customerName?: string;
  readonly cashier?: string;
  readonly received?: number;
  readonly reference?: string;
  readonly discount?: DiscountInput;
  /**
   * IDEMPOTENCIA (checklist crítico #4): id generado por la UI una sola vez
   * por intento de cobro de la mesa, reutilizado en cada reintento (ver
   * CloseTableDialog.tsx). Se reenvía a SalesEngine.tableSale(): si el
   * primer intento falló a mitad de camino y el mesero/cajero reintenta con
   * el mismo saleId, no se crea una segunda venta con doble descuento de
   * inventario ni doble comanda para la misma mesa.
   */
  readonly saleId?: string;
}

export interface SplitBillResult {
  readonly perPerson: number;
  readonly people: number;
  readonly total: number;
}

/** Estados en los que una mesa NO tiene un pedido en curso editable. */
const NOT_OPEN_STATUSES = new Set<Table["status"]>(["FREE", "CLOSED"]);

/** Reintentos ante choque de edición simultánea en operaciones de items. */
const MAX_CONFLICT_RETRIES = 4;

export class TableEngine {
  constructor(
    private readonly tableRepository: IRepository<Table>,
    private readonly kitchen: KitchenEngine,
    private readonly sales: SalesEngine,
    private readonly orders: OrderEngine,
    private readonly local: TableLocalRepository = new TableLocalRepository()
  ) {}

  /* =======================================================================
     CREACIÓN Y CONSULTA
  ======================================================================= */

  public async createTable(input: CreateTableInput): Promise<Table> {
    const now = new Date();

    const table: Table = {
      id: crypto.randomUUID(),
      businessId: input.businessId ?? getCurrentBusinessId(),
      branchId: input.branchId ?? getCurrentBranchId() ?? undefined,
      name: input.name,
      capacity: input.capacity,
      peopleCount: 0,
      status: "FREE",
      items: [],
      subtotal: 0,
      tax: 0,
      discount: 0,
      total: 0,
      zone: input.zone,
      updatedAt: now
    };

    await this.tableRepository.save(table);

    this.emit(table, "table.created");

    return table;
  }

  public async getTable(tableId: string): Promise<Table> {
    try {
      const table = await this.tableRepository.findById(tableId);

      if (!table) {
        throw new Error("TABLE_NOT_FOUND");
      }

      return table;
    } catch (error) {
      if (!connectionStore.isOnline()) {
        const localTable = await this.local.findById(tableId);

        if (!localTable) {
          throw new Error("TABLE_NOT_FOUND");
        }

        return localTable;
      }

      throw error;
    }
  }

  public async getAllTables(): Promise<Table[]> {
    if (!connectionStore.isOnline()) {
      return this.local.findAll();
    }

    return this.tableRepository.findAll();
  }

  public async getFreeTables(): Promise<Table[]> {
    const tables = await this.getAllTables();
    return tables.filter(table => table.status === "FREE" || table.status === "RESERVED");
  }

  public async getOccupiedTables(): Promise<Table[]> {
    const tables = await this.getAllTables();
    return tables.filter(table => table.status !== "FREE" && table.status !== "RESERVED" && table.status !== "CLOSED");
  }

  /* =======================================================================
     APERTURA Y CLIENTES
  ======================================================================= */

  /**
   * Abre una mesa libre y la marca como ocupada. El pedido en curso
   * arranca vacío directamente en la fila persistida (no hay carrito
   * separado que crear): cualquier dispositivo que la lea de ahora en
   * adelante ve exactamente el mismo estado.
   */
  public async openTable(input: OpenTableInput): Promise<Table> {
    const table = await this.getTable(input.tableId);

    if (table.status !== "FREE" && table.status !== "RESERVED") {
      if (input.operationId && table.openOperationId === input.operationId) {
        return table;
      }

      throw new Error(
        `TABLE_NOT_AVAILABLE: la mesa "${table.name}" está en estado "${table.status}".`
      );
    }

    // Paso 1: crear el Order primero. Si falla, no tocamos la mesa.
    let order: Order;
    try {
      order = await this.orders.createOrder({
        source: "TABLE",
        tableId: table.id,
        waiterId: input.waiterId,
        customerId: input.customerId,
        notes: input.notes
      });
    } catch (orderError) {
      throw new Error(
        `ORDER_CREATION_FAILED: no se pudo crear el pedido para la mesa "${table.name}".`
      );
    }

    // Paso 2: abrir la mesa. Si falla, cancelar el Order para no dejarlo huérfano.
    try {
      const opened = await this.updateTable(table.id, {
        status: "BUSY",
        peopleCount: input.peopleCount,
        waiterId: input.waiterId,
        customerId: input.customerId,
        notes: input.notes,
        openedAt: new Date(),
        openOperationId: input.operationId
      });

      const withOrder = await this.updateTable(table.id, { orderId: order.id });

      this.emit(withOrder, "table.opened");

      return withOrder;
    } catch (tableError) {
      try {
        await this.orders.updateOrder(order.id, { status: "CANCELLED" });
      } catch (rollbackError) {
        logWarning(`No se pudo cancelar el Order huérfano ${order.id} tras fallo en openTable`, {
          context: { error: String(rollbackError) }
        });
      }
      throw tableError;
    }
  }

  public async reserveTable(tableId: string): Promise<Table> {
    const table = await this.getTable(tableId);

    if (table.status !== "FREE") {
      throw new Error("TABLE_NOT_AVAILABLE: solo se pueden reservar mesas libres.");
    }

    const reserved = await this.updateTable(tableId, { status: "RESERVED" });

    this.emit(reserved, "table.reserved");

    return reserved;
  }

  public async addPeople(tableId: string, peopleCount: number): Promise<Table> {
    return this.updateTable(tableId, { peopleCount });
  }

  /* =======================================================================
     PEDIDO (productos) — siempre contra la mesa persistida, nunca contra
     un carrito en memoria de este dispositivo.
  ======================================================================= */

  /**
   * Agrega un producto al pedido en curso de la mesa. No descuenta
   * inventario ni cobra nada: solo guarda el pedido, tal como haría
   * un mesero al anotar en su libreta — pero la libreta es la mesa en
   * la base de datos, no una hoja que solo él puede ver.
   */
  public async addItem(input: AddProductInput): Promise<Table> {
    if (!connectionStore.isOnline()) {
      const table = await this.getTable(input.tableId);
      return queueAddItemOffline({ table, input });
    }

    return this.mutateItems(input.tableId, cart =>
      cart.addItem(input.product, input.quantity ?? 1, input.note)
    );
  }

  public async removeItem(tableId: string, productId: string): Promise<Table> {
    if (!connectionStore.isOnline()) {
      const table = await this.getTable(tableId);
      return queueRemoveItemOffline({ table, productId });
    }

    return this.mutateItems(tableId, cart => cart.removeItem(productId));
  }

  public async updateItemQuantity(
    tableId: string,
    productId: string,
    quantity: number
  ): Promise<Table> {
    if (!connectionStore.isOnline()) {
      const table = await this.getTable(tableId);
      return queueUpdateQuantityOffline({ table, productId, quantity });
    }

    return this.mutateItems(tableId, cart => cart.updateQuantity(productId, quantity));
  }

  /**
   * Lee el pedido actual de la mesa directamente de la base de datos.
   * (Antes leía de un carrito en memoria — ver nota de cabecera del
   * archivo. Ningún componente de la UI depende de la firma síncrona
   * anterior: todos leen `table.items` de la mesa ya cargada.)
   */
  public async getItems(tableId: string): Promise<SaleItem[]> {
    const table = await this.getTable(tableId);
    return table.items;
  }

  /* =======================================================================
     COCINA
  ======================================================================= */

  /**
   * Envía el pedido actual de la mesa a cocina y actualiza su estado.
   * La mesa permanece abierta: el mesero puede seguir agregando productos
   * y volver a enviarlos (por ejemplo, cuando llegan los postres).
   */
  public async sendToKitchen(
    tableId: string,
    priority: OrderPriority = "NORMAL"
  ): Promise<KitchenOrder | null> {
    const table = await this.getTable(tableId);

    if (NOT_OPEN_STATUSES.has(table.status)) {
      throw new Error(
        `TABLE_NOT_OPEN: la mesa "${table.name}" no tiene un pedido en curso. Ábrela primero con openTable().`
      );
    }

    const order = await this.sendPendingKitchenItems(tableId, priority);

    await this.updateTable(tableId, { status: "CUENTA_SOLICITADA" });

    this.emit(await this.getTable(tableId), "table.sent_to_kitchen");

    return order;
  }

  /** Envía solo los items de cocina pendientes de esta mesa, sin tocar el estado. */
  private async sendPendingKitchenItems(
    tableId: string,
    priority: OrderPriority = "NORMAL"
  ): Promise<KitchenOrder | null> {
    const table = await this.getTable(tableId);

    const items = table.items;

    if (items.length === 0) {
      return null;
    }

    if (!connectionStore.isOnline()) {
      await queueSendToKitchenOffline({ table, priority });
      return null;
    }

    const previousOrders = await this.kitchen.getByTableId(table.id);
    const sentQuantities = new Map<string, number>();
    for (const order of previousOrders) {
      for (const item of order.items) {
        sentQuantities.set(item.productId, (sentQuantities.get(item.productId) ?? 0) + item.quantity);
      }
    }

    const kitchenItems = items
      .filter(item => item.requiresKitchen === true)
      .map(item => {
        const sent = sentQuantities.get(item.productId) ?? 0;
        if (item.quantity <= sent) return null;
        return { ...item, quantity: item.quantity - sent };
      })
      .filter((item): item is NonNullable<typeof item> => item !== null);

    if (kitchenItems.length === 0) {
      return null;
    }

    const order: KitchenOrder = {
      id: crypto.randomUUID(),
      items: kitchenItems,
      status: "PENDIENTE",
      createdAt: new Date(),
      origin: table.name,
      waiterId: table.waiterId,
      priority,
      businessId: table.businessId,
      branchId: table.branchId,
      tableId: table.id,
      orderId: table.orderId
    };

    await createKitchenOutput(kitchenOutputModeStore.get(), this.kitchen).send(order);

    return order;
  }

  /* =======================================================================
     TRANSFERENCIAS Y UNIÓN DE MESAS
  ======================================================================= */

  /**
   * Mueve todo el pedido y la información de una mesa a otra mesa libre.
   * La mesa de origen queda libre nuevamente. Ambas mesas son filas
   * independientes en el repositorio: se leen y escriben directamente,
   * sin pasar por ningún estado en memoria.
   */
  public async transferTable(fromTableId: string, toTableId: string): Promise<Table> {
    const from = await this.getTable(fromTableId);
    const to = await this.getTable(toTableId);

    if (NOT_OPEN_STATUSES.has(from.status)) {
      throw new Error(
        `TABLE_NOT_OPEN: la mesa "${from.name}" no tiene un pedido en curso.`
      );
    }

    if (to.status !== "FREE") {
      throw new Error(`TABLE_NOT_AVAILABLE: la mesa "${to.name}" no está libre.`);
    }

    const moved = await this.persist(
      {
        ...to,
        status: from.status,
        peopleCount: from.peopleCount,
        waiterId: from.waiterId,
        customerId: from.customerId,
        notes: from.notes,
        openedAt: from.openedAt,
        discount: from.discount
      },
      from.items
    );

    await this.resetTable(fromTableId);

    this.emit(moved, "table.transferred");

    return moved;
  }

  /**
   * Une el pedido de una mesa dentro de otra (mesa grande). La mesa
   * absorbida queda marcada como unida y libre para volver a usarse
   * de forma independiente una vez se cierre la mesa principal.
   */
  public async mergeTables(mainTableId: string, otherTableId: string): Promise<Table> {
    const other = await this.getTable(otherTableId);

    if (NOT_OPEN_STATUSES.has(other.status)) {
      throw new Error(
        `TABLE_NOT_OPEN: la mesa "${other.name}" no tiene un pedido en curso.`
      );
    }

    const merged = await this.mutateItems(mainTableId, cart => {
      other.items.forEach(item => {
        cart.addItem(
          {
            id: item.productId,
            price: item.price,
            requiresKitchen: item.requiresKitchen
          } as Product,
          item.quantity
        );
      });
    });

    await this.persist(
      { ...other, status: "CLOSED", mergedInto: mainTableId },
      []
    );

    this.emit(merged, "table.merged");

    return merged;
  }

  /**
   * Divide el total de la mesa en partes iguales entre varias personas.
   * (La división por productos específicos se resuelve en la capa de
   * servicio, armando "mesas virtuales" con subconjuntos de items).
   */
  public splitBill(table: Table, people: number): SplitBillResult {
    if (people <= 0) {
      throw new Error("INVALID_SPLIT: el número de personas debe ser mayor a cero.");
    }

    return {
      perPerson: Number((table.total / people).toFixed(2)),
      people,
      total: table.total
    };
  }

  public async requestBill(tableId: string): Promise<Table> {
    return this.updateTable(tableId, { status: "CUENTA_SOLICITADA" });
  }

  /* =======================================================================
     CIERRE (cobro)
  ======================================================================= */

  /**
   * Cierra la mesa: delega en SalesEngine la creación de la venta y el
   * cobro (inventario, caja, recibo, fidelización, dashboard). Al terminar,
   * la mesa vuelve a quedar libre. Los items que se cobran son los que
   * estén persistidos en la mesa en este momento — el mismo pedido que ve
   * cualquier dispositivo que la consulte, sea el del mesero que lo tomó
   * o el del cajero que cobra.
   */
  public async closeTable(
    input: CloseTableInput
  ): Promise<{ sale: Sale; payment: PaymentResult; receipt: Receipt }> {
    const table = await this.getTable(input.tableId);

    if (input.saleId) {
      const existingSale = await this.sales.getSale(input.saleId);
      if (existingSale) {
        if (existingSale.status === "PAID" || existingSale.status === "CLOSED") {
          const existingReceipt = await this.sales.getReceiptBySaleId(existingSale.id);
          const receipt = existingReceipt ?? await this.sales.generateReceipt(
            existingSale,
            input.customerName ?? "Cliente General",
            input.cashier ?? "Administrador",
            input.method,
            input.received ?? existingSale.total,
            existingSale.discount ?? 0
          );

          const payment: PaymentResult = {
            success: true,
            method: (existingSale.paymentMethod as PaymentMethod) || "CASH",
            total: existingSale.total,
            received: existingSale.total,
            change: 0,
            message: "Pago ya procesado (idempotente)",
            date: existingSale.updatedAt
          };

          return { sale: existingSale, payment, receipt };
        }
      }
    }

    if (table.items.length === 0) {
      throw new Error("EMPTY_TABLE: la mesa no tiene productos para cobrar.");
    }

    await this.sendPendingKitchenItems(input.tableId);

    const sale = await this.sales.tableSale({
      id: input.saleId,
      tableId: input.tableId,
      source: table.items,
      cashierId: input.cashierId,
      waiterId: table.waiterId,
      discount: input.discount,
      taxRate: companyConfigStore.get().tax / 100,
      skipKitchen: true
    });

    const { sale: paidSale, payment } = await this.sales.registerPayment(
      sale,
      input.method,
      { received: input.received, reference: input.reference }
    );

    const existingReceipt = await this.sales.getReceiptBySaleId(paidSale.id);
    const receipt = existingReceipt
      ? existingReceipt
      : await this.sales.generateReceipt(
          paidSale,
          input.customerName ?? "Cliente General",
          input.cashier ?? "Administrador",
          input.method,
          input.received ?? paidSale.total,
          paidSale.discount ?? 0
        );

    if (!existingReceipt) {
      this.sales.printReceipt(receipt);
    }

    if (table.orderId) {
      try {
        await this.orders.updateOrder(table.orderId, {
          status: "COMPLETED",
          saleId: paidSale.id
        });
      } catch (orderError) {
        logWarning(`No se pudo marcar COMPLETED el Order ${table.orderId} tras cerrar mesa ${input.tableId}`, {
          context: { error: String(orderError), saleId: paidSale.id }
        });
      }
    }

    const closed = await this.resetTable(input.tableId);

    this.emit(closed, "table.closed");

    return { sale: paidSale, payment, receipt };
  }

  /* =======================================================================
     HELPERS PRIVADOS
  ======================================================================= */

  /**
   * Relee la mesa desde el repositorio (fuente de verdad real, no un mapa
   * en memoria de este dispositivo), le aplica `mutate` sobre sus items
   * actuales con una CartEngine desechable, y guarda. Si otro mesero o
   * cajero guardó un cambio sobre la MISMA mesa justo entre la lectura y
   * la escritura (OptimisticLockError), se repite el ciclo completo con
   * los datos más recientes — así dos dispositivos pueden tomar pedido
   * sobre la misma mesa casi al mismo tiempo sin que ninguno de los dos
   * pierda su cambio ni vea un error por algo tan normal como eso.
   */
  private async mutateItems(
    tableId: string,
    mutate: (cart: CartEngine) => void
  ): Promise<Table> {
    for (let attempt = 1; attempt <= MAX_CONFLICT_RETRIES; attempt++) {
      const table = await this.getTable(tableId);

      if (NOT_OPEN_STATUSES.has(table.status)) {
        throw new Error(
          `TABLE_NOT_OPEN: la mesa "${table.name}" no tiene un pedido en curso. Ábrela primero con openTable().`
        );
      }

      const cart = new CartEngine();
      cart.loadItems(table.items);
      mutate(cart);

      try {
        return await this.persist(table, cart.getItems());
      } catch (err) {
        if (isOptimisticLockError(err) && attempt < MAX_CONFLICT_RETRIES) {
          await new Promise(resolve => setTimeout(resolve, 50 * Math.pow(2, attempt - 1)));
          continue;
        }

        if (!connectionStore.isOnline()) {
          const updated = {
            ...table,
            items: cart.getItems(),
            updatedAt: new Date()
          };

          await this.local.save(updated);
          vimdyCore.emit("table", { action: "table.updated", table: updated });

          return updated;
        }

        throw err;
      }
    }

    // Inalcanzable en la práctica: el bucle siempre retorna o lanza antes.
    throw new Error(
      "TABLE_UPDATE_CONFLICT: no se pudo actualizar la mesa tras varios intentos por choques de edición simultánea."
    );
  }

  /** Recalcula subtotal/impuesto/total a partir de `items` y guarda la mesa. */
  private async persist(table: Table, items: SaleItem[]): Promise<Table> {
    const subtotal = Number(
      items.reduce((sum, item) => sum + item.price * item.quantity, 0).toFixed(2)
    );
    const tax = Number((subtotal * (companyConfigStore.get().tax / 100)).toFixed(2));
    const discount = table.discount ?? 0;
    const total = Number(Math.max(subtotal + tax - discount, 0).toFixed(2));

    const updated: Table = {
      ...table,
      items,
      subtotal,
      tax,
      total,
      updatedAt: new Date()
    };

    await this.tableRepository.update(updated);

    return updated;
  }

  public async updateTable(
    tableId: string,
    patch: Partial<Table>
  ): Promise<Table> {
    for (let attempt = 1; attempt <= MAX_CONFLICT_RETRIES; attempt++) {
      const table = await this.getTable(tableId);

      const updated: Table = {
        ...table,
        ...patch,
        updatedAt: new Date()
      };

      try {
        await this.tableRepository.update(updated);
        return updated;
      } catch (err) {
        if (isOptimisticLockError(err) && attempt < MAX_CONFLICT_RETRIES) {
          await new Promise(resolve => setTimeout(resolve, 50 * Math.pow(2, attempt - 1)));
          continue;
        }

        if (!connectionStore.isOnline()) {
          await this.local.save(updated);
          vimdyCore.emit("table", { action: "table.updated", table: updated });
          return updated;
        }

        throw err;
      }
    }

    throw new Error(
      "TABLE_UPDATE_CONFLICT: no se pudo actualizar la mesa tras varios intentos por choques de edición simultánea."
    );
  }

  private async resetTable(tableId: string): Promise<Table> {
    return this.updateTable(tableId, {
      status: "FREE",
      peopleCount: 0,
      waiterId: undefined,
      customerId: undefined,
      items: [],
      subtotal: 0,
      tax: 0,
      discount: 0,
      total: 0,
      notes: undefined,
      openedAt: undefined,
      openOperationId: undefined,
      orderId: undefined
    });
  }

  private emit(table: Table, action: string): void {
    vimdyCore.emit("table", { action, table });
  }
}