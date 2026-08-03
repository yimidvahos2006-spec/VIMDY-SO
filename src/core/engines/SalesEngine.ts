import {
  Sale,
  SaleItem,
  SaleType,
  SaleStatus,
  SaleRefundRecord,
  Alert,
  CashMovement,
  KitchenOrder,
  OrderPriority
} from "../entities/Entities";

import { IRepository } from "../../infrastructure/di/repositories/IRepository";
import { SaleRepository } from "../../infrastructure/di/repositories/SaleRepository";
import { logWarning } from "../../infrastructure/logging/opsLogger";

import { CartEngine } from "./CartEngine";
import { InventoryEngine } from "./InventoryEngine";
import {
  PaymentEngine,
  PaymentMethod,
  PaymentResult,
  MixedPayment
} from "./PaymentEngine";
import { ReceiptEngine, Receipt } from "./ReceiptEngine";
import { KitchenEngine } from "./KitchenEngine";
import { CashEngine } from "./CashEngine";
import { CustomerEngine } from "./CustomerEngine";
import { AlertEngine } from "./AlertEngine";
import { HealthEngine } from "./HealthEngine";
import { KardexEngine } from "./KardexEngine";
import { PosCore } from "./PosCore";
import { AuditEngine } from "./AuditEngine";
import { isOptimisticLockError } from "../errors/OptimisticLockError";

import { HealthResult } from "../types/HealthTypes";
import { companyConfigStore } from "../store/companyConfigStore";
import { roundMoney } from "../config/globalization";
import { dashboardStore } from "../store/dashboardStore";
import { kitchenOutputModeStore } from "../store/kitchenOutputModeStore";
import { createKitchenOutput } from "../services/KitchenOutputFactory";
import { getSaleNetTotal } from "../utils/saleRefunds";

/* ===========================================================================
   SalesEngine
   ---------------------------------------------------------------------------
   Motor central de ventas de VIMDY OS. Orquesta el ciclo de vida completo
   de una venta (rápida, de mesa o a domicilio): validación, cálculo de
   totales, descuento de inventario, envío a cocina, cobro, generación de
   recibo, actualización de caja, fidelización de clientes y sincronización
   del dashboard.

   Conexiones directas (obligatorias):
     - CartEngine        → carrito rápido por defecto (mostrador).
     - InventoryEngine   → validación y descuento/reposición de stock.
     - PaymentEngine     → procesamiento de pagos y reembolsos.
     - ReceiptEngine     → generación, reimpresión y consulta de recibos.
     - KitchenEngine     → envío y cancelación de comandas en cocina.
     - CashEngine        → ingresos/egresos de caja derivados de la venta.
     - CustomerEngine    → fidelización (puntos) y perfil del cliente.
     - DashboardEngine   → sincronización de métricas en tiempo real.
     - AlertEngine       → alertas de stock generadas tras la venta.
     - HealthEngine      → salud general del negocio para el dashboard.
     - KardexEngine      → trazabilidad de movimientos de inventario.
     - PosCore           → carrito/orquestación para ventas de mesa/domicilio.
     - IRepository<Sale> → persistencia de las ventas.

   Conexiones explícitamente PROHIBIDAS (por diseño):
     - AIEngine, SalesAI, InventoryAI, CustomerAI, PredictionAI
       Estos motores de IA son consumidos por capas superiores
       (servicios/aplicación), nunca directamente desde SalesEngine.
=========================================================================== */

/* -----------------------------------------------------------------------
   Tipos y contratos propios de SalesEngine
----------------------------------------------------------------------- */

export interface CreateSaleItemInput {
  readonly productId: string;
  readonly quantity: number;
  /** Si se omite, se toma el precio vigente del catálogo de inventario. */
  readonly price?: number;
}

export interface DiscountInput {
  readonly type: "PERCENT" | "FIXED";
  readonly value: number;
}

/**
 * BLOQUEANTE (auditoría Fase 2 — rama Bar): mismo shape que DiscountInput
 * (porcentaje o monto fijo) pero es un tipo propio a propósito — una
 * propina no es "un descuento negativo", es un concepto de negocio
 * distinto (no lo paga el negocio, lo recibe el mesero/el negocio del
 * cliente) y algún día puede necesitar reglas propias (ej. tope máximo,
 * repartición entre meseros) que no tendría sentido colgar de
 * DiscountInput.
 */
export interface TipInput {
  readonly type: "PERCENT" | "FIXED";
  readonly value: number;
}

export interface CreateSaleInput {
  /**
   * IDEMPOTENCIA (checklist crítico #4): id opcional generado por quien
   * llama (típicamente una sola vez por intento de cobro en el POS, antes
   * del primer click). Si se reintenta createSale() con el MISMO id (ej.
   * porque el primer intento se cayó a mitad de camino y el cajero volvió
   * a darle al botón), se detecta que la venta ya existe y se devuelve tal
   * cual, sin descontar inventario ni crear una segunda comanda. Si se
   * omite, se genera uno aleatorio y el comportamiento es igual al de
   * siempre (una venta nueva por llamada).
   */
  readonly id?: string;
  readonly type: SaleType;
  readonly items: CreateSaleItemInput[];
  readonly customerId?: string;
  readonly cashierId?: string;
  readonly tableId?: string;
  readonly deliveryAddress?: string;
  readonly deliveryFee?: number;
  readonly discount?: DiscountInput;
  /** BLOQUEANTE (auditoría Fase 2 — rama Bar): propina voluntaria, ver Sale.tip. */
  readonly tip?: TipInput;
  readonly taxRate?: number;
  readonly notes?: string;
  /** id del mesero (User.id) que atiende la venta, si aplica. */
  readonly waiterId?: string;
  /** Prioridad manual elegida al crear el pedido. Sin selección = "NORMAL". */
  readonly priority?: OrderPriority;
}

export type SaleSource = PosCore | CartEngine | CreateSaleItemInput[];

export interface ValidationResult {
  readonly valid: boolean;
  readonly errors: string[];
}

export interface PaymentOptions {
  readonly received?: number;
  readonly reference?: string;
  readonly mixed?: MixedPayment;
}

export interface ProductSalesRanking {
  readonly productId: string;
  readonly quantity: number;
  readonly revenue: number;
}

export interface SalesStatistics {
  readonly totalSales: number;
  readonly totalOrders: number;
  readonly averageTicket: number;
  readonly totalTax: number;
  readonly totalDiscount: number;
  readonly byType: Record<SaleType, number>;
  readonly byStatus: Partial<Record<SaleStatus, number>>;
  readonly bestSellingProducts: ProductSalesRanking[];
}

export interface SalesDashboardSnapshot {
  readonly realtime: {
    sales: number;
    customers: number;
    orders: number;
    inventory: number;
  };
  readonly alerts: Alert[];
  readonly cashBalance: number;
  readonly health: HealthResult;
}

export interface SalesEngineConfig {
  readonly defaultTaxRate: number;
  readonly defaultCustomerId: string;
  /** Puntos de fidelización otorgados por cada unidad de moneda gastada. */
  readonly loyaltyPointsPerCurrencyUnit: number;
}

const DEFAULT_CONFIG: SalesEngineConfig = {
  defaultTaxRate: 0.19,
  defaultCustomerId: "CLIENTE_GENERAL",
  loyaltyPointsPerCurrencyUnit: 0.001
};

/* -----------------------------------------------------------------------
   SalesEngine
----------------------------------------------------------------------- */

export class SalesEngine {
  private saleCounter = 0;

  constructor(
    // FASE 3 (Optimización): tipado como el repositorio concreto (no
    // IRepository<Sale> genérico) para poder usar findByCustomer(), que
    // filtra por SQL en vez de traer TODA la tabla de ventas del negocio
    // con findAll() y filtrar en JavaScript (ver
    // customer_purchase_history_migration.sql). CustomerEngine ya se
    // arregló así; SalesEngine.getSalesByCustomer() se había quedado con
    // el patrón viejo — es el que usa useCustomers.ts para poblar Clientes.
    private readonly saleRepository: SaleRepository,
    private readonly cart: CartEngine,
    private readonly inventory: InventoryEngine,
    private readonly payment: PaymentEngine,
    private readonly receipt: ReceiptEngine,
    private readonly kitchen: KitchenEngine,
    private readonly cash: CashEngine,
    private readonly customer: CustomerEngine,
    private readonly alert: AlertEngine,
    private readonly health: HealthEngine,
    private readonly kardex: KardexEngine,
    private readonly posCore: PosCore,
    private readonly audit: AuditEngine,
    private readonly config: SalesEngineConfig = DEFAULT_CONFIG
  ) {}

  /* =======================================================================
     CREACIÓN DE VENTAS
  ======================================================================= */

  /**
   * Crea una venta genérica. Es el orquestador central utilizado por
   * quickSale(), tableSale() y deliverySale().
   */
  public async createSale(input: CreateSaleInput): Promise<Sale> {
    // IDEMPOTENCIA (checklist crítico #4): si quien llama ya trae un id
    // (ver CreateSaleInput.id) y esa venta ya existe en la base de datos,
    // esto es un reintento del mismo intento de cobro — no un pedido
    // nuevo. Se devuelve la venta ya creada tal cual, SIN volver a
    // descontar inventario ni volver a mandar comanda a cocina (eso
    // duplicaría stock descontado y comandas). Solo aplica cuando el
    // llamador pide explícitamente idempotencia pasando un id.
    if (input.id) {
      const existing = await this.saleRepository.findById(input.id);
      if (existing) {
        return existing;
      }
    }

    const validation = await this.validateSale(input);

    if (!validation.valid) {
      throw new Error(
        `VALIDATION_ERROR: ${validation.errors.join(" | ")}`
      );
    }

    const resolvedItems = await this.resolveSaleItems(input.items);

    const subtotal = this.calculateSubtotal(resolvedItems);
    // La tasa por defecto se lee en vivo de companyConfigStore (lo que edita
    // Configuracion > Impuestos) en vez del valor que quedó congelado en
    // this.config al arrancar la app, para que un cambio de IVA se refleje
    // de inmediato en la próxima venta sin reiniciar.
    const taxRate = input.taxRate ?? companyConfigStore.get().tax / 100;
    const tax = this.calculateTax(subtotal, taxRate);
    const discount = this.calculateDiscount(subtotal, input.discount);
    const deliveryFee =
      input.type === "DELIVERY" ? input.deliveryFee ?? 0 : 0;
    // BLOQUEANTE (auditoría Fase 2 — rama Bar): la propina se calcula sobre
    // el subtotal (antes de IVA/descuento) pero se SUMA al total ya con
    // IVA y descuento aplicados — ver calculateTotal. No es un valor sobre
    // el que se cobre IVA.
    const tip = this.calculateTip(subtotal, input.tip);
    const total = this.calculateTotal(subtotal, tax, discount, deliveryFee, tip);

    const now = new Date();
    const code = this.generateSaleCode(input.type);

    const sale: Sale = {
      id: input.id ?? crypto.randomUUID(),
      code,
      customerId: input.customerId ?? this.config.defaultCustomerId,
      items: resolvedItems,
      subtotal,
      tax,
      discount,
      deliveryFee,
      tip,
      total,
      createdAt: now,
      updatedAt: now,
      type: input.type,
      status: "PENDING_PAYMENT",
      tableId: input.tableId,
      cashierId: input.cashierId,
      waiterId: input.waiterId,
      deliveryAddress: input.deliveryAddress,
      notes: input.notes,
      priority: input.priority ?? "NORMAL"
    };

    await this.updateInventory(
      resolvedItems,
      `Venta ${code}`,
      "DECREASE"
    );

    // saveSale() y sendToKitchen() escriben a tablas distintas (sales y
    // kitchen_orders, sin foreign key entre ellas) y ambas solo necesitan
    // el objeto `sale` ya armado en memoria — no hay razón de negocio para
    // que una espere a la otra. Antes iban en fila; ahora van a la vez.
    await Promise.all([this.saveSale(sale), this.sendToKitchen(sale)]);

    // generateEvents() sí necesita que updateInventory() ya haya corrido
    // (revisa alertas de stock bajo sobre el inventario ya descontado), por
    // eso sigue yendo después de esa línea de arriba. audit.log() no
    // depende de nada de esto — solo de `sale` — así que va junto.
    await Promise.all([
      this.generateEvents(),
      this.audit.log(
        sale.cashierId ?? "system",
        "SALE_CREATED",
        "sales",
        `Venta ${sale.code ?? sale.id} creada (${sale.type}) por $${sale.total}.`,
        sale.id
      )
    ]);

    return sale;
  }

  /**
   * Venta rápida de mostrador. Toma los productos del carrito por defecto
   * (CartEngine) salvo que se indique otra fuente explícita.
   */
  public async quickSale(params: {
    /** Idempotencia (checklist crítico #4): ver CreateSaleInput.id. */
    id?: string;
    source?: SaleSource;
    customerId?: string;
    cashierId?: string;
    discount?: DiscountInput;
    /** BLOQUEANTE (auditoría Fase 2 — rama Bar): ver Sale.tip. */
    tip?: TipInput;
    taxRate?: number;
    notes?: string;
    priority?: OrderPriority;
  } = {}): Promise<Sale> {
    const source = params.source ?? this.cart;
    const items = this.extractItems(source);

    const sale = await this.createSale({
      id: params.id,
      type: "QUICK",
      items,
      customerId: params.customerId,
      cashierId: params.cashierId,
      discount: params.discount,
      tip: params.tip,
      taxRate: params.taxRate,
      notes: params.notes,
      priority: params.priority
    });

    this.clearSource(source);

    return sale;
  }

  /**
   * Venta de mesa (salón/restaurante). Requiere un identificador de mesa.
   */
  public async tableSale(params: {
    /** Idempotencia (checklist crítico #4): ver CreateSaleInput.id. */
    id?: string;
    tableId: string;
    source?: SaleSource;
    customerId?: string;
    cashierId?: string;
    waiterId?: string;
    discount?: DiscountInput;
    /** BLOQUEANTE (auditoría Fase 2 — rama Bar): ver Sale.tip. */
    tip?: TipInput;
    taxRate?: number;
    notes?: string;
    priority?: OrderPriority;
  }): Promise<Sale> {
    const source = params.source ?? this.posCore;
    const items = this.extractItems(source);

    const sale = await this.createSale({
      id: params.id,
      type: "TABLE",
      items,
      tableId: params.tableId,
      customerId: params.customerId,
      cashierId: params.cashierId,
      waiterId: params.waiterId,
      discount: params.discount,
      tip: params.tip,
      taxRate: params.taxRate,
      notes: params.notes,
      priority: params.priority
    });

    this.clearSource(source);

    return sale;
  }

  /**
   * Venta a domicilio. Requiere dirección de entrega y admite costo de envío.
   */
  public async deliverySale(params: {
    /** Idempotencia (checklist crítico #4): ver CreateSaleInput.id. */
    id?: string;
    deliveryAddress: string;
    deliveryFee?: number;
    source?: SaleSource;
    customerId?: string;
    cashierId?: string;
    discount?: DiscountInput;
    /** BLOQUEANTE (auditoría Fase 2 — rama Bar): ver Sale.tip. */
    tip?: TipInput;
    taxRate?: number;
    notes?: string;
    priority?: OrderPriority;
  }): Promise<Sale> {
    const source = params.source ?? this.posCore;
    const items = this.extractItems(source);

    const sale = await this.createSale({
      id: params.id,
      type: "DELIVERY",
      items,
      deliveryAddress: params.deliveryAddress,
      deliveryFee: params.deliveryFee,
      customerId: params.customerId,
      cashierId: params.cashierId,
      discount: params.discount,
      tip: params.tip,
      taxRate: params.taxRate,
      notes: params.notes,
      priority: params.priority
    });

    this.clearSource(source);

    return sale;
  }

  /* =======================================================================
     VALIDACIÓN
  ======================================================================= */

  /**
   * Valida de forma integral una solicitud de venta: estructura de items,
   * reglas específicas por tipo de venta y disponibilidad de inventario.
   */
  public async validateSale(input: CreateSaleInput): Promise<ValidationResult> {
    const errors: string[] = [];

    const itemsResult = this.validateItems(input.items);
    errors.push(...itemsResult.errors);

    if (input.type === "TABLE" && !input.tableId) {
      errors.push("Las ventas de mesa requieren un identificador de mesa.");
    }

    if (input.type === "DELIVERY" && !input.deliveryAddress) {
      errors.push("Las ventas a domicilio requieren una dirección de entrega.");
    }

    if (
      input.discount?.type === "PERCENT" &&
      (input.discount.value < 0 || input.discount.value > 100)
    ) {
      errors.push("El descuento porcentual debe estar entre 0 y 100.");
    }

    if (itemsResult.valid) {
      const inventoryResult = await this.validateInventory(input.items);
      errors.push(...inventoryResult.errors);
    }

    return { valid: errors.length === 0, errors };
  }

  /**
   * Valida la estructura básica de los items de la venta.
   */
  public validateItems(items: CreateSaleItemInput[]): ValidationResult {
    const errors: string[] = [];

    if (!items || items.length === 0) {
      errors.push("La venta debe contener al menos un producto.");
      return { valid: false, errors };
    }

    items.forEach((item, index) => {
      if (!item.productId) {
        errors.push(`El producto en la posición ${index + 1} no tiene un ID válido.`);
      }

      if (!item.quantity || item.quantity <= 0) {
        errors.push(`La cantidad del producto "${item.productId}" debe ser mayor a cero.`);
      }

      if (item.price !== undefined && item.price < 0) {
        errors.push(`El precio del producto "${item.productId}" no puede ser negativo.`);
      }
    });

    return { valid: errors.length === 0, errors };
  }

  /**
   * Valida que exista stock suficiente y que los productos estén activos.
   */
  public async validateInventory(
    items: CreateSaleItemInput[]
  ): Promise<ValidationResult> {
    const errors: string[] = [];
    // PASO 2 (Motor de Producción): si un producto de la venta tiene receta,
    // su propio `stock` es irrelevante (normalmente 0 o no se usa) — lo que
    // hay que validar es el stock de cada INGREDIENTE. Se acumula por
    // ingrediente entre todos los items de la venta (ej. dos productos
    // distintos que ambos llevan "Pan") antes de comparar contra el stock
    // real, para no aprobar una venta que individualmente parece válida
    // pero en conjunto excede lo disponible.
    const ingredientNeeded = new Map<string, { quantity: number; requiredBy: Set<string> }>();

    // Antes: 1 consulta a Supabase por item del carrito, una esperando a la
    // anterior (N round-trips en fila). Ahora se piden todas a la vez — el
    // orden de recorrido y de los mensajes de error no cambia, solo que las
    // N consultas viajan en paralelo en vez de en fila.
    const products = await Promise.all(
      items.map((item) => this.inventory.getById(item.productId))
    );

    items.forEach((item, index) => {
      const product = products[index];

      if (!product) {
        errors.push(`El producto "${item.productId}" no existe en el inventario.`);
        return;
      }

      if (product.active === false) {
        errors.push(`El producto "${product.name}" está inactivo.`);
        return;
      }

      if (product.recipe && product.recipe.length > 0) {
        for (const ingredient of product.recipe) {
          const needed = ingredient.quantity * item.quantity;
          const current = ingredientNeeded.get(ingredient.productId) ?? {
            quantity: 0,
            requiredBy: new Set<string>()
          };
          current.quantity += needed;
          current.requiredBy.add(product.name);
          ingredientNeeded.set(ingredient.productId, current);
        }
        return;
      }

      // BLOQUEANTE (bug reportado en video 2026-07-31): mismo fix que
      // InventoryEngine.buildConsumptionTargets — un producto sin receta
      // con trackStock === false (Servicio, o Cocina sin receta que no
      // maneja stock propio, ej. Caldo de Costilla) no debe exigir stock
      // aquí tampoco. Esta validación corre ANTES que InventoryEngine (es
      // la que de verdad estaba bloqueando la venta con VALIDATION_ERROR
      // en el video), así que sin este mismo chequeo acá, arreglar solo
      // InventoryEngine no habría sido suficiente.
      if (product.trackStock === false) {
        return;
      }

      if (product.stock < item.quantity) {
        errors.push(
          `Stock insuficiente para "${product.name}". Disponible: ${product.stock}, solicitado: ${item.quantity}.`
        );
      }
    });

    // Misma idea para los ingredientes de receta: se piden todos a la vez.
    const ingredientIds = [...ingredientNeeded.keys()];
    const ingredients = await Promise.all(
      ingredientIds.map((id) => this.inventory.getById(id))
    );

    ingredientIds.forEach((ingredientId, index) => {
      const ingredient = ingredients[index];
      const need = ingredientNeeded.get(ingredientId)!;

      if (!ingredient) {
        errors.push(`Un ingrediente de receta (id "${ingredientId}") ya no existe en el inventario.`);
        return;
      }

      if (ingredient.stock < need.quantity) {
        errors.push(
          `No puedes vender "${[...need.requiredBy].join(", ")}": falta ${ingredient.name}. ` +
            `Disponible: ${ingredient.stock}, necesario: ${need.quantity}.`
        );
      }
    });

    return { valid: errors.length === 0, errors };
  }

  /* =======================================================================
     CÁLCULOS
  ======================================================================= */

  public calculateSubtotal(items: SaleItem[]): number {
    const subtotal = items.reduce(
      (sum, item) => sum + item.price * item.quantity,
      0
    );

    return roundMoney(subtotal, companyConfigStore.get().currency);
  }

  public calculateTax(
    subtotal: number,
    taxRate: number = this.config.defaultTaxRate
  ): number {
    return roundMoney(
      Math.max(subtotal, 0) * taxRate,
      companyConfigStore.get().currency
    );
  }

  public calculateDiscount(
    subtotal: number,
    discount?: DiscountInput
  ): number {
    if (!discount || discount.value <= 0) {
      return 0;
    }

    const currency = companyConfigStore.get().currency;

    if (discount.type === "PERCENT") {
      const percent = Math.min(Math.max(discount.value, 0), 100);
      return roundMoney((subtotal * percent) / 100, currency);
    }

    return roundMoney(Math.min(discount.value, subtotal), currency);
  }

  /**
   * BLOQUEANTE (auditoría Fase 2 — rama Bar): calcula el monto real de
   * propina a partir de un TipInput (porcentaje o monto fijo), igual que
   * calculateDiscount pero SIN topar el valor fijo al subtotal — un
   * cliente puede dar de propina más de lo que topa una regla de
   * descuento, es su plata, no la del negocio.
   */
  public calculateTip(subtotal: number, tip?: TipInput): number {
    if (!tip || tip.value <= 0) {
      return 0;
    }

    const currency = companyConfigStore.get().currency;

    if (tip.type === "PERCENT") {
      const percent = Math.min(Math.max(tip.value, 0), 100);
      return roundMoney((subtotal * percent) / 100, currency);
    }

    return roundMoney(Math.max(tip.value, 0), currency);
  }

  public calculateTotal(
    subtotal: number,
    tax: number,
    discount: number = 0,
    deliveryFee: number = 0,
    /**
     * BLOQUEANTE (auditoría Fase 2 — rama Bar): se suma DESPUÉS de aplicar
     * IVA y descuento — la propina no lleva IVA. Default 0 mantiene el
     * comportamiento exacto de siempre para cualquier llamada que no la
     * pase (ninguna venta existente cambia de total).
     */
    tip: number = 0
  ): number {
    const total = subtotal + tax - discount + deliveryFee + tip;
    return roundMoney(Math.max(total, 0), companyConfigStore.get().currency);
  }

  /**
   * Calcula la utilidad de una venta a partir del costo unitario de cada
   * producto. Si no se provee costo para un producto, se asume cero.
   */
  public calculateProfit(
    sale: Sale,
    costByProduct: Record<string, number> = {}
  ): number {
    const subtotal = sale.subtotal ?? this.calculateSubtotal(sale.items);

    const cost = sale.items.reduce(
      (sum, item) => sum + item.quantity * (costByProduct[item.productId] ?? 0),
      0
    );

    return roundMoney(subtotal - cost, companyConfigStore.get().currency);
  }

  /**
   * Genera estadísticas agregadas para un conjunto de ventas
   * (reportes, dashboard, cierres de caja, etc).
   */
  public calculateStatistics(sales: Sale[]): SalesStatistics {
    const currency = companyConfigStore.get().currency;

    const totalSales = roundMoney(
      sales.reduce((sum, sale) => sum + sale.total, 0),
      currency
    );
    const totalOrders = sales.length;
    const averageTicket =
      totalOrders === 0 ? 0 : roundMoney(totalSales / totalOrders, currency);

    const totalTax = roundMoney(
      sales.reduce((sum, sale) => sum + (sale.tax ?? 0), 0),
      currency
    );
    const totalDiscount = roundMoney(
      sales.reduce((sum, sale) => sum + (sale.discount ?? 0), 0),
      currency
    );

    const byType: Record<SaleType, number> = {
      QUICK: 0,
      TABLE: 0,
      DELIVERY: 0
    };
    const byStatus: Partial<Record<SaleStatus, number>> = {};
    const ranking = new Map<string, { quantity: number; revenue: number }>();

    for (const sale of sales) {
      if (sale.type) {
        byType[sale.type] += 1;
      }

      if (sale.status) {
        byStatus[sale.status] = (byStatus[sale.status] ?? 0) + 1;
      }

      for (const item of sale.items) {
        const current = ranking.get(item.productId) ?? {
          quantity: 0,
          revenue: 0
        };

        current.quantity += item.quantity;
        current.revenue += item.quantity * item.price;

        ranking.set(item.productId, current);
      }
    }

    const bestSellingProducts: ProductSalesRanking[] = [...ranking.entries()]
      .map(([productId, data]) => ({ productId, ...data }))
      .sort((a, b) => b.quantity - a.quantity)
      .slice(0, 10);

    return {
      totalSales,
      totalOrders,
      averageTicket,
      totalTax,
      totalDiscount,
      byType,
      byStatus,
      bestSellingProducts
    };
  }

  /* =======================================================================
     PERSISTENCIA (CRUD)
  ======================================================================= */

  public async saveSale(sale: Sale): Promise<void> {
    await this.saleRepository.save(sale);
  }

  public async updateSale(sale: Sale): Promise<Sale> {
    const updated: Sale = { ...sale, updatedAt: new Date() };
    await this.saleRepository.update(updated);
    return updated;
  }

  /**
   * Cancela una venta que aún no ha sido cerrada, restituyendo el
   * inventario y notificando a cocina.
   */
  public async cancelSale(id: string, reason: string, actorId?: string): Promise<Sale> {
    const sale = await this.getSale(id);

    if (!sale) {
      throw new Error("SALE_NOT_FOUND");
    }

    if (
      sale.status === "CANCELLED" ||
      sale.status === "REFUNDED" ||
      sale.status === "CLOSED"
    ) {
      throw new Error(
        `SALE_CANNOT_BE_CANCELLED: la venta ya se encuentra en estado "${sale.status}".`
      );
    }

    // Solo si ya había sido cobrada llegó a sumarse al Dashboard (eso
    // ocurre al pagar, no al crear la venta) — así que solo en ese caso
    // hay algo que revertir ahí.
    const wasPaid = sale.status === "PAID";

    await this.updateInventory(
      sale.items,
      `Cancelación venta ${sale.code ?? sale.id}: ${reason}`,
      "INCREASE"
    );

    try {
      await this.kitchen.updateStatus(sale.id, "CANCELADO");
    } catch {
      // La comanda pudo no haberse registrado en cocina; se ignora de forma segura.
    }

    const cancelled = await this.updateSale({
      ...sale,
      status: "CANCELLED",
      notes: this.appendNote(sale.notes, `Cancelada: ${reason}`)
    });

    if (wasPaid) {
      this.reverseDashboardForSale(sale);
    }

    await this.updateDashboard();

    await this.audit.log(
      actorId ?? sale.cashierId ?? "system",
      "SALE_CANCELLED",
      "sales",
      `Venta ${sale.code ?? sale.id} cancelada: ${reason}`,
      sale.id
    );

    return cancelled;
  }

  /**
   * Reembolsa una venta pagada: revierte el pago, restituye inventario
   * y registra el egreso correspondiente en caja.
   */
  public async refundSale(
    id: string,
    reason: string,
    actorId?: string
  ): Promise<{ sale: Sale; payment: PaymentResult }> {
    const sale = await this.getSale(id);

    if (!sale) {
      throw new Error("SALE_NOT_FOUND");
    }

    if (sale.status !== "PAID" && sale.status !== "CLOSED") {
      throw new Error("SALE_NOT_PAID: solo se pueden reembolsar ventas pagadas.");
    }

    if (sale.invoiceId) {
      throw new Error(
        "SALE_HAS_INVOICE: esta venta ya tiene factura electrónica. " +
          "Para devolverla hace falta generar una nota crédito primero " +
          "(hoy manual en Factus; automatizarlo queda en el backlog de Fase 4)."
      );
    }

    // Fix: si esta venta ya tuvo uno o más reembolsos PARCIALES antes
    // (partialRefundSale), un "reembolso total" solo debe cubrir lo que
    // TODAVÍA no se había devuelto — si no, se repone inventario y se
    // devuelve dinero por unidades que ya se habían reembolsado, dos veces.
    const alreadyRefunded = this.getRefundedQuantities(sale);
    const remainingItems: SaleItem[] = sale.items
      .map(item => ({
        ...item,
        quantity: item.quantity - (alreadyRefunded[item.productId] ?? 0)
      }))
      .filter(item => item.quantity > 0);

    if (remainingItems.length === 0) {
      throw new Error(
        "REFUND_NOTHING_LEFT: esta venta ya fue reembolsada por completo en devoluciones parciales previas."
      );
    }

    const currency = companyConfigStore.get().currency;
    const remainingAmount = roundMoney(
      remainingItems.reduce((sum, item) => sum + item.price * item.quantity, 0),
      currency
    );

    const paymentResult = this.payment.refund(sale, remainingAmount);

    await this.verifyInventoryTrail(sale);

    await this.updateInventory(
      remainingItems,
      `Reembolso venta ${sale.code ?? sale.id}: ${reason}`,
      "INCREASE"
    );

    await this.updateCash(sale, "OUT", remainingAmount);

    const refunded = await this.updateSale({
      ...sale,
      status: "REFUNDED",
      notes: this.appendNote(sale.notes, `Reembolsada: ${reason}`)
    });

    // reverseDashboardForSale ahora recibe el monto/cantidad REALES que
    // faltaban (no sale.total/sale.items completos), para no duplicar lo
    // que un reembolso parcial previo ya había restado del Dashboard.
    const remainingQuantity = remainingItems.reduce((sum, item) => sum + item.quantity, 0);
    this.reverseDashboardForSale(sale, remainingAmount, remainingQuantity);

    await this.updateDashboard();

    await this.audit.log(
      actorId ?? sale.cashierId ?? "system",
      "SALE_REFUNDED",
      "sales",
      `Venta ${sale.code ?? sale.id} reembolsada: ${reason}`,
      sale.id
    );

    return { sale: refunded, payment: paymentResult };
  }

  /**
   * Devuelve cuántas unidades de cada producto de la venta ya fueron
   * reembolsadas (sumando TODOS los reembolsos parciales previos, no
   * solo el último), para no dejar reembolsar dos veces la misma unidad.
   */
  public getRefundedQuantities(sale: Sale): Record<string, number> {
    const result: Record<string, number> = {};

    for (const refund of sale.refunds ?? []) {
      for (const item of refund.items) {
        result[item.productId] = (result[item.productId] ?? 0) + item.quantity;
      }
    }

    return result;
  }

  /**
   * Devuelve cuántas unidades de cada producto de la venta TODAVÍA se
   * pueden reembolsar (lo comprado menos lo ya reembolsado). La UI usa
   * esto para no dejar seleccionar más cantidad de la que queda.
   */
  public getRefundableQuantities(sale: Sale): Record<string, number> {
    const refunded = this.getRefundedQuantities(sale);
    const result: Record<string, number> = {};

    for (const item of sale.items) {
      const already = refunded[item.productId] ?? 0;
      result[item.productId] = Math.max(item.quantity - already, 0);
    }

    return result;
  }

  /**
   * Reembolsa solo ALGUNOS ítems de una venta pagada (bloqueante #3 de
   * la auditoría) en vez de la venta completa. Por ejemplo: un cliente
   * pidió 3 productos y solo devuelve 1.
   *
   * El monto se prorratea con la misma tasa efectiva de impuesto y
   * descuento que tuvo la venta original (proporcional al subtotal de
   * los ítems que se están devolviendo). La propina y el costo de
   * domicilio NO se prorratean porque no están atados a productos
   * puntuales — quedan íntegros del lado del negocio/repartidor.
   *
   * Si esta llamada termina de reembolsar TODAS las unidades de TODOS
   * los ítems (porque ya no queda nada más por devolver), la venta pasa
   * a `status: "REFUNDED"`, igual que un reembolso total — para que el
   * resto del sistema (reportes, caja, /caja → "Ya fue reembolsada")
   * la trate exactamente igual que si se hubiera usado refundSale().
   */
  public async partialRefundSale(
    id: string,
    itemsToRefund: { productId: string; quantity: number }[],
    reason: string,
    actorId?: string
  ): Promise<{ sale: Sale; payment: PaymentResult; amount: number }> {
    const sale = await this.getSale(id);

    if (!sale) {
      throw new Error("SALE_NOT_FOUND");
    }

    if (sale.status !== "PAID" && sale.status !== "CLOSED") {
      throw new Error("SALE_NOT_PAID: solo se pueden reembolsar ventas pagadas.");
    }

    const cleanItems = itemsToRefund.filter(line => line.quantity > 0);

    if (cleanItems.length === 0) {
      throw new Error("REFUND_EMPTY: seleccioná al menos un producto para devolver.");
    }

    const refundable = this.getRefundableQuantities(sale);

    for (const line of cleanItems) {
      const original = sale.items.find(item => item.productId === line.productId);

      if (!original) {
        throw new Error(
          `REFUND_ITEM_NOT_IN_SALE: el producto ${line.productId} no pertenece a esta venta.`
        );
      }

      const available = refundable[line.productId] ?? 0;

      if (line.quantity > available) {
        throw new Error(
          `REFUND_EXCEEDS_AVAILABLE: solo quedan ${available} unidad(es) reembolsables de ` +
            `"${line.productId}" (de ${original.quantity} compradas).`
        );
      }
    }

    const currency = companyConfigStore.get().currency;
    const priceByProduct = new Map(sale.items.map(item => [item.productId, item.price]));

    const refundSubtotal = cleanItems.reduce(
      (sum, line) => sum + (priceByProduct.get(line.productId) ?? 0) * line.quantity,
      0
    );

    const saleSubtotal = sale.subtotal ?? this.calculateSubtotal(sale.items);
    const effectiveRate = saleSubtotal > 0 ? refundSubtotal / saleSubtotal : 0;
    const refundTax = roundMoney((sale.tax ?? 0) * effectiveRate, currency);
    const refundDiscount = roundMoney((sale.discount ?? 0) * effectiveRate, currency);
    const refundAmount = roundMoney(
      Math.max(refundSubtotal + refundTax - refundDiscount, 0),
      currency
    );

    await this.verifyInventoryTrail(sale);

    // Solo se repone al inventario lo que efectivamente se está
    // devolviendo en ESTE reembolso, no la venta entera.
    const restockItems: SaleItem[] = cleanItems.map(line => ({
      productId: line.productId,
      quantity: line.quantity,
      price: priceByProduct.get(line.productId) ?? 0
    }));

    await this.updateInventory(
      restockItems,
      `Reembolso parcial venta ${sale.code ?? sale.id}: ${reason}`,
      "INCREASE"
    );

    await this.cash.registerExpense(
      refundAmount,
      `Reembolso parcial venta ${sale.code ?? sale.id}`
    );

    const paymentResult = this.payment.refundAmount(refundAmount);

    const refundRecord: SaleRefundRecord = {
      id: crypto.randomUUID(),
      items: cleanItems,
      amount: refundAmount,
      reason,
      actorId,
      createdAt: new Date()
    };

    // ¿Con este reembolso ya no queda NADA reembolsable? Entonces es,
    // en la práctica, un reembolso total hecho ítem por ítem — se marca
    // la venta como REFUNDED igual que refundSale().
    const refundedSoFar = this.getRefundedQuantities(sale);
    const projectedRefunded: Record<string, number> = { ...refundedSoFar };
    for (const line of cleanItems) {
      projectedRefunded[line.productId] =
        (projectedRefunded[line.productId] ?? 0) + line.quantity;
    }
    const fullyRefundedNow = sale.items.every(
      item => (projectedRefunded[item.productId] ?? 0) >= item.quantity
    );

    const updated: Sale = {
      ...sale,
      status: fullyRefundedNow ? "REFUNDED" : sale.status,
      refunds: [...(sale.refunds ?? []), refundRecord],
      notes: this.appendNote(
        sale.notes,
        `Reembolso parcial (${reason}): ${cleanItems
          .map(line => `${line.quantity}× ${line.productId}`)
          .join(", ")}`
      )
    };

    const savedSale = await this.updateSale(updated);

    const refundedUnits = cleanItems.reduce((sum, line) => sum + line.quantity, 0);

    if (fullyRefundedNow) {
      this.reverseDashboardForSale(sale);
    } else {
      dashboardStore.partialReverseSale(refundAmount, refundedUnits);
    }

    await this.updateDashboard();

    await this.audit.log(
      actorId ?? sale.cashierId ?? "system",
      "SALE_PARTIALLY_REFUNDED",
      "sales",
      `Venta ${sale.code ?? sale.id}: reembolso parcial de ${refundedUnits} unidad(es) ` +
        `por ${refundAmount} ${currency}. Motivo: ${reason}`,
      sale.id
    );

    return { sale: savedSale, payment: paymentResult, amount: refundAmount };
  }

  /**
   * Elimina definitivamente una venta. Solo permitido para ventas que
   * nunca llegaron a pagarse o que ya fueron canceladas/reembolsadas.
   */
  public async deleteSale(id: string): Promise<void> {
    const sale = await this.getSale(id);

    if (!sale) {
      throw new Error("SALE_NOT_FOUND");
    }

    if (sale.status === "PAID" || sale.status === "CLOSED") {
      throw new Error(
        "SALE_LOCKED: no se puede eliminar una venta pagada o cerrada. Use refundSale()."
      );
    }

    await this.saleRepository.delete(id);
  }

  public async getSale(id: string): Promise<Sale | null> {
    return await this.saleRepository.findById(id);
  }

  public async getAllSales(): Promise<Sale[]> {
    return await this.saleRepository.findAll();
  }

  public async getSalesByDate(from: Date, to: Date = new Date()): Promise<Sale[]> {
    const sales = await this.getAllSales();

    return sales.filter(
      sale => sale.createdAt >= from && sale.createdAt <= to
    );
  }

  /**
   * FASE 3 (Optimización): ver SaleRepository.getCustomerPurchaseStats().
   * Agregados de compra de todos los clientes calculados en Postgres, para
   * que useCustomers.ts no tenga que traer cada venta del negocio con
   * getAllSales() para sumar LTV/cantidad de compras en JavaScript.
   */
  public async getCustomerPurchaseStats() {
    return await this.saleRepository.getCustomerPurchaseStats();
  }

  public async getSalesByCustomer(customerId: string): Promise<Sale[]> {
    // FASE 3 (Optimización): antes traía TODAS las ventas del negocio con
    // getAllSales() y filtraba por customerId en JavaScript. Con años de
    // historial esto se vuelve más lento cada mes. findByCustomer() filtra
    // en Postgres usando la columna generada sale_customer_id (ver
    // customer_purchase_history_migration.sql), así que solo viaja por la
    // red lo que realmente pertenece a ese cliente.
    return await this.saleRepository.findByCustomer(customerId);
  }

  public async getSalesByCashier(cashierId: string): Promise<Sale[]> {
    const sales = await this.getAllSales();
    return sales.filter(sale => sale.cashierId === cashierId);
  }

  public async getSalesByTable(tableId: string): Promise<Sale[]> {
    const sales = await this.getAllSales();
    return sales.filter(sale => sale.tableId === tableId);
  }

  /**
   * Búsqueda libre por código, ID, cliente o notas.
   */
  public async searchSales(query: string): Promise<Sale[]> {
    const sales = await this.getAllSales();
    const normalized = query.trim().toLowerCase();

    if (!normalized) {
      return sales;
    }

    return sales.filter(sale =>
      sale.id.toLowerCase().includes(normalized) ||
      (sale.code?.toLowerCase().includes(normalized) ?? false) ||
      sale.customerId.toLowerCase().includes(normalized) ||
      (sale.notes?.toLowerCase().includes(normalized) ?? false)
    );
  }

  /* =======================================================================
     PAGO, RECIBO Y COCINA
  ======================================================================= */

  /**
   * Registra el cobro de una venta: procesa el pago, ingresa el dinero
   * a caja, marca la venta como pagada y aplica fidelización al cliente.
   */
  public async registerPayment(
    sale: Sale,
    method: PaymentMethod,
    options: PaymentOptions = {}
  ): Promise<{ sale: Sale; payment: PaymentResult }> {
    // IDEMPOTENCIA (checklist crítico #4): no confiar en el `sale` en
    // memoria que trae el llamador — puede venir de un intento anterior
    // (ej. el datáfono se cayó, la respuesta nunca llegó al navegador, y
    // el cajero le vuelve a dar a "Cobrar" con la misma venta ya cobrada
    // de verdad en el servidor). Se relee el estado real desde la base de
    // datos: si ya está PAID/CLOSED, se devuelve tal cual SIN volver a
    // ingresar el dinero a caja, sin duplicar puntos de fidelización y sin
    // duplicar el log de auditoría.
    const current = (await this.getSale(sale.id)) ?? sale;

    if (current.status === "PAID" || current.status === "CLOSED") {
      return {
        sale: current,
        payment: this.processPayment(current, method, options)
      };
    }

    const paymentResult = this.processPayment(current, method, options);

    // Los 4 pasos de abajo usan datos que ya existen en `current` desde
    // antes de empezar (total, code, cashierId, customerId, id) — ninguno
    // depende del resultado de otro, así que van a la vez. updateCustomer y
    // audit.log usan `current` (no `updatedSale`) a propósito: el único
    // cambio entre ambos es status/paymentMethod, que ninguno de los dos
    // lee.
    //
    // El movimiento de caja usa un id DETERMINÍSTICO (`sale-payment-<id>`,
    // no aleatorio): si por una condición de carrera dos llamadas a
    // registerPayment para la MISMA venta llegan a correr a la vez (ej. dos
    // pestañas, o un reintento que alcanzó a pasar el check de arriba antes
    // de que el primero terminara de escribir), el upsert por id en
    // SupabaseRepository.save() pisa el mismo movimiento en vez de crear
    // dos — el dinero registrado en caja no se duplica aunque el registro
    // de auditoría sí pueda quedar dos veces en ese caso límite, que es
    // inofensivo.
    try {
      const [updatedSale] = await Promise.all([
        this.updateSale({
          ...current,
          status: "PAID",
          paymentMethod: method
        }),
        this.cash.registerIncome(
          current.total,
          `Venta ${current.code ?? current.id} (${method})`,
          method,
          method === "MIXED" ? options.mixed?.cash ?? 0 : undefined,
          `sale-payment-${current.id}`
        ),
        this.updateCustomer(current.customerId, current),
        this.audit.log(
          current.cashierId ?? "system",
          "SALE_PAID",
          "sales",
          `Venta ${current.code ?? current.id} cobrada (${method}) por $${current.total}.`,
          current.id
        )
      ]);

      return { sale: updatedSale, payment: paymentResult };
    } catch (err) {
      // CIERRE DE LA VENTANA DE CARRERA: el chequeo de idempotencia de arriba
      // (current.status === "PAID"/"CLOSED") solo protege contra reintentos
      // SECUENCIALES. Si dos llamadas a registerPayment para la MISMA venta
      // arrancan casi a la vez (dos pestañas del cajero, doble click antes
      // de que el primer round-trip termine), ambas pueden pasar ese
      // chequeo viendo "PENDING_PAYMENT" y llegar aquí juntas. Solo una
      // gana el updateSale (bloqueo optimista por version); la otra recibe
      // OptimisticLockError. En vez de mostrarle un error de "choque de
      // edición" al cajero por algo que en realidad es su propio cobro ya
      // procesado por la otra pestaña, se relee la venta: si en efecto ya
      // quedó PAID/CLOSED, se devuelve esa venta real sin volver a tocar
      // caja, fidelización ni auditoría (evita el doble ingreso de dinero
      // que el id determinístico de cash.registerIncome ya mitigaba, pero
      // ahora sin siquiera intentar la escritura perdedora).
      if (isOptimisticLockError(err)) {
        const settled = await this.getSale(current.id);
        if (settled && (settled.status === "PAID" || settled.status === "CLOSED")) {
          return { sale: settled, payment: this.processPayment(settled, method, options) };
        }
      }
      throw err;
    }
  }

  /**
   * Genera el recibo formal de una venta ya cobrada.
   */
  public async generateReceipt(
    sale: Sale,
    customerName: string,
    cashier: string,
    paymentMethod: string,
    received: number,
    discount: number = sale.discount ?? 0,
    taxRate: number = this.config.defaultTaxRate
  ): Promise<Receipt> {
    return this.receipt.generate(
      sale,
      customerName,
      cashier,
      paymentMethod,
      received,
      discount,
      taxRate,
      // Igual que taxRate arriba: se lee en vivo de companyConfigStore (lo
      // que edita Configuración > Impuestos/Moneda) en vez de quedar
      // congelada en this.config al arrancar la app.
      companyConfigStore.get().currency
    );
  }

  /**
   * Envía la comanda de una venta a cocina. El ID de la comanda coincide
   * con el ID de la venta para permitir correlación directa entre ambas.
   *
   * Solo entran los items cuyo producto necesita preparación (ver
   * Product.requiresKitchen): a diferencia de TableEngine/OrderEngine
   * (que tienen prohibido tocar InventoryEngine y por eso dependen del
   * flag ya copiado en SaleItem.requiresKitchen), SalesEngine SÍ puede
   * consultar InventoryEngine directamente, así que resuelve aquí el
   * producto real de cada item en vez de confiar en un flag que pudo
   * no venir (ej. una venta armada con un array de items "a mano", sin
   * pasar por el carrito).
   *
   * Si ningún item requiere cocina (ej. una venta solo de bebidas
   * embotelladas), no se crea ninguna comanda — devuelve null. Esto es
   * lo normal en una tienda sin cocina, no un error: por eso no lanza.
   */
  public async sendToKitchen(sale: Sale): Promise<KitchenOrder | null> {
    const products = await this.inventory.getMany(
      sale.items.map(item => item.productId)
    );
    const productMap = new Map(products.map(p => [p.id, p]));

    const kitchenItems = sale.items.filter(item => {
      const product = productMap.get(item.productId);
      // Producto ya no existe en el catálogo (ej. borrado después de la
      // venta): se trata como "sí requiere cocina" por seguridad, para
      // no perder silenciosamente un item que sí necesitaba prepararse.
      if (!product) return true;
      return product.requiresKitchen !== false;
    });

    if (kitchenItems.length === 0) {
      return null;
    }

    const order: KitchenOrder = {
      id: sale.id,
      items: kitchenItems,
      status: "PENDIENTE",
      createdAt: new Date(),
      origin: this.describeSaleOrigin(sale),
      waiterId: sale.waiterId,
      notes: sale.notes,
      priority: sale.priority ?? "NORMAL"
    };

    // Antes: await this.kitchen.save(order) directo. Ver mismo comentario
    // en OrderEngine.sendToKitchen — esta es la ruta de venta directa en
    // Caja/mostrador/domicilio (createSale la dispara automático).
    await createKitchenOutput(kitchenOutputModeStore.get(), this.kitchen).send(order);

    return order;
  }

  /** Texto descriptivo del origen de la venta, para mostrar en Cocina. */
  private describeSaleOrigin(sale: Sale): string {
    if (sale.type === "TABLE") {
      return sale.tableId ? `Mesa ${sale.tableId}` : "Mesa";
    }

    if (sale.type === "DELIVERY") {
      return sale.deliveryAddress
        ? `Domicilio — ${sale.deliveryAddress}`
        : "Domicilio";
    }

    return "Mostrador";
  }

  /**
   * Envía el recibo a la impresora física del punto de venta.
   * (Punto de integración con el driver ESC/POS correspondiente).
   */
  public printReceipt(receipt: Receipt): boolean {
    console.log(
      `[SalesEngine] Imprimiendo recibo ${receipt.code} — total: ${receipt.total}`
    );

    return true;
  }

  /**
   * Reimprime un recibo previamente emitido.
   */
  public async reprintReceipt(code: string): Promise<Receipt> {
    const receipt = await this.receipt.reprint(code);
    this.printReceipt(receipt);
    return receipt;
  }

  /* =======================================================================
     INVENTARIO, CLIENTE, CAJA Y DASHBOARD
  ======================================================================= */

  /**
   * Aplica movimientos de inventario derivados de una venta
   * (descuento al vender, incremento al cancelar/reembolsar).
   */
  public async updateInventory(
    items: SaleItem[],
    reason: string,
    direction: "DECREASE" | "INCREASE" = "DECREASE"
  ): Promise<void> {
    const stockItems = items.map((item) => ({ productId: item.productId, quantity: item.quantity }));

    // consumeForSale/restoreForSale ya saben distinguir productos simples de
    // productos con receta (BOM): un producto elaborado (ej. Hamburguesa)
    // descuenta/repone sus ingredientes en vez de su propio stock.
    if (direction === "DECREASE") {
      await this.inventory.consumeForSale(stockItems, reason);
    } else {
      await this.inventory.restoreForSale(stockItems, reason);
    }
  }

  /**
   * Aplica fidelización: otorga puntos al cliente registrado según el
   * total de la venta. Los clientes genéricos (mostrador) no acumulan puntos.
   */
  public async updateCustomer(customerId: string, sale: Sale): Promise<void> {
    if (!customerId || customerId === this.config.defaultCustomerId) {
      return;
    }

    try {
      const profile = await this.customer.getCustomerProfile(customerId);
      const earnedPoints = Math.floor(
        sale.total * this.config.loyaltyPointsPerCurrencyUnit
      );

      await this.customer.update({
        ...profile.customer,
        points: (profile.customer.points ?? 0) + earnedPoints
      });
    } catch (error) {
      if (error instanceof Error && error.message === "CUSTOMER_NOT_FOUND") {
        return;
      }

      throw error;
    }
  }

  /**
   * Registra en caja el efecto monetario de una venta (ingreso) o de una
   * reversión (egreso). `amount` permite registrar solo una parte del
   * total (reembolso total de una venta que ya tuvo parciales antes) —
   * por defecto usa sale.total.
   */
  public async updateCash(
    sale: Sale,
    direction: "IN" | "OUT" = "IN",
    amount: number = sale.total
  ): Promise<CashMovement> {
    const description =
      direction === "IN"
        ? `Venta ${sale.code ?? sale.id}`
        : `Reembolso venta ${sale.code ?? sale.id}`;

    return direction === "IN"
      ? await this.cash.registerIncome(amount, description, sale.paymentMethod as CashMovement["paymentMethod"])
      : await this.cash.registerExpense(amount, description);
  }

  /**
   * Sincroniza y devuelve una fotografía consolidada del estado del
   * negocio: métricas en tiempo real, alertas activas, saldo de caja
   * y salud general calculada por HealthEngine.
   */
  public async updateDashboard(options: {
    targetSales?: number;
    targetProfit?: number;
    retentionRate?: number;
  } = {}): Promise<SalesDashboardSnapshot> {
    // Antes: `DashboardRealtimeEngine` arrancaba en $2.540.000 inventados y
    // subía con Math.random() en cada tick(). Ahora los 4 números salen de
    // los mismos repositorios/engines que ya procesaron las ventas reales.
    const [allSales, products, customers] = await Promise.all([
      this.saleRepository.findAll(),
      this.inventory.listAll(),
      this.customer.getAllCustomers()
    ]);

    const paidSales = allSales.filter(
      sale => sale.status === "PAID" || sale.status === "CLOSED"
    );

    const realtime = {
      // Fix: antes sumaba sale.total a secas — una venta con reembolso
      // parcial se queda en status PAID/CLOSED (no cambia de estado a
      // propósito, ver partialRefundSale), así que sin restar
      // sale.refunds acá, el Dashboard se vuelve a inflar con lo ya
      // devuelto en cuanto updateDashboard() recalcula desde cero.
      sales: paidSales.reduce((sum, sale) => sum + this.netTotal(sale), 0),
      customers: customers.length,
      orders: paidSales.length,
      inventory: products.reduce((sum, product) => sum + product.stock, 0)
    };

    const alerts = this.alert.checkStockAlerts(products);
    const cashBalance = await this.cash.getBalance();

    const inventoryLevel =
      products.length === 0
        ? 1
        : products.filter(product => product.stock > product.minStock).length /
          products.length;

    const targetSales = options.targetSales ?? realtime.sales;
    const targetProfit = options.targetProfit ?? realtime.sales * 0.3;
    const currentProfit = realtime.sales * 0.3;

    const health = this.health.calculate({
      currentSales: realtime.sales,
      targetSales,
      currentProfit,
      targetProfit,
      inventoryLevel,
      cashBalance,
      diff: realtime.sales - targetSales,
      retentionRate: options.retentionRate ?? 80,
      criticalAlerts: alerts.filter(alert => alert.priority === "CRITICAL").length,
      aiTrend: "STABLE"
    });

    return { realtime, alerts, cashBalance, health };
  }

  /**
   * Revierte en el Dashboard (capa de UI) el efecto de una venta pagada que
   * se cancela o reembolsa. Sin esto, cancelar o reembolsar una venta ya
   * cobrada dejaba las tarjetas del Dashboard infladas con una venta que ya
   * no existe, hasta que alguien recargara la página manualmente.
   */
  private reverseDashboardForSale(
    sale: Sale,
    amount: number = sale.total,
    quantity?: number
  ): void {
    const totalProducts =
      quantity ??
      sale.items.reduce((sum, item) => sum + item.quantity, 0);
    dashboardStore.reverseSale(amount, totalProducts);
  }

  /**
   * Total de una venta neto de todo lo ya reembolsado (parcial o total).
   * Reexporta el helper compartido de src/core/utils/saleRefunds — Dashboard/
   * Ganancias/Pérdidas/Reportes usan el mismo cálculo.
   */
  private netTotal(sale: Sale): number {
    return getSaleNetTotal(sale);
  }

  /**
   * Genera las alertas de inventario vigentes tras el efecto de una venta.
   */
  public async generateEvents(): Promise<Alert[]> {
    const products = await this.inventory.listAll();
    return this.alert.checkStockAlerts(products);
  }

  /* =======================================================================
     OPERACIONES ADICIONALES
  ======================================================================= */

  /**
   * Duplica una venta existente como un nuevo pedido abierto
   * (útil para "repetir pedido" en mesas o domicilios recurrentes).
   */
  public async duplicateSale(id: string): Promise<Sale> {
    const original = await this.getSale(id);

    if (!original) {
      throw new Error("SALE_NOT_FOUND");
    }

    const now = new Date();

    const duplicated: Sale = {
      ...original,
      id: crypto.randomUUID(),
      code: this.generateSaleCode(original.type ?? "QUICK"),
      status: "OPEN",
      createdAt: now,
      updatedAt: now
    };

    await this.saveSale(duplicated);

    return duplicated;
  }

  /**
   * Cierra una venta ya pagada, dejándola lista para reportes/auditoría.
   */
  public async closeSale(id: string): Promise<Sale> {
    const sale = await this.getSale(id);

    if (!sale) {
      throw new Error("SALE_NOT_FOUND");
    }

    if (sale.status !== "PAID") {
      throw new Error("SALE_NOT_PAID: la venta debe estar pagada antes de cerrarse.");
    }

    const closed = await this.updateSale({ ...sale, status: "CLOSED" });

    await this.updateDashboard();

    return closed;
  }

  /* =======================================================================
     HELPERS PRIVADOS
  ======================================================================= */

  private async resolveSaleItems(
    items: CreateSaleItemInput[]
  ): Promise<SaleItem[]> {
    // Antes: por cada item sin precio explícito (el caso normal desde el
    // POS, que solo manda productId + quantity), se hacía una consulta a
    // Supabase en secuencia. Con un carrito de varios productos distintos,
    // esto sumaba una consulta en fila detrás de otra. Ahora se piden todos
    // los precios faltantes a la vez.
    const lookups = await Promise.all(
      items.map((item) =>
        item.price === undefined ? this.inventory.getById(item.productId) : null
      )
    );

    return items.map((item, index) => ({
      productId: item.productId,
      quantity: item.quantity,
      price: item.price ?? lookups[index]?.price ?? 0
    }));
  }

  private processPayment(
    sale: Sale,
    method: PaymentMethod,
    options: PaymentOptions
  ): PaymentResult {
    switch (method) {
      case "CASH":
        return this.payment.payCash(sale.total, options.received ?? sale.total);

      case "CARD":
        return this.payment.payCard(sale.total, options.reference ?? "");

      case "TRANSFER":
        return this.payment.payTransfer(sale.total, options.reference ?? "");

      case "QR":
        return this.payment.payQR(sale.total, options.reference ?? "");

      case "MIXED":
        return this.payment.payMixed(sale.total, options.mixed ?? {});

      default:
        throw new Error("UNSUPPORTED_PAYMENT_METHOD");
    }
  }

  private extractItems(source: SaleSource): CreateSaleItemInput[] {
    if (Array.isArray(source)) {
      return source;
    }

    return source.getItems().map(item => ({
      productId: item.productId,
      quantity: item.quantity,
      price: item.price
    }));
  }

  private clearSource(source: SaleSource): void {
    if (Array.isArray(source)) {
      return;
    }

    if (source instanceof CartEngine) {
      source.clear();
      return;
    }

    source.clearCart();
  }

  /**
   * Verifica, a través del Kardex, que exista trazabilidad de los
   * movimientos de inventario asociados a una venta antes de reembolsarla.
   */
  private async verifyInventoryTrail(sale: Sale): Promise<void> {
    const reference = sale.code ?? sale.id;

    for (const item of sale.items) {
      const history = await this.kardex.getHistory(item.productId);
      const hasTrail = history.some(movement => movement.reason.includes(reference));

      if (!hasTrail) {
        logWarning(`Sin trazabilidad en Kardex para el producto ${item.productId} de la venta ${reference}.`, {
          category: "inventory",
          context: { productId: item.productId, saleReference: reference }
        });
      }
    }
  }

  private appendNote(existing: string | undefined, note: string): string {
    return existing ? `${existing} | ${note}` : note;
  }

  private generateSaleCode(type: SaleType): string {
    this.saleCounter += 1;

    const prefix =
      type === "QUICK" ? "RAP" : type === "TABLE" ? "MSA" : "DEL";

    const timestamp = Date.now().toString().slice(-6);
    const sequence = this.saleCounter.toString().padStart(4, "0");

    return `${prefix}-${timestamp}-${sequence}`;
  }
}