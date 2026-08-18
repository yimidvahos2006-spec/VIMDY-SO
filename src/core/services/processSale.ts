import { cartStore } from "../store/cartStore";
import type { CartItem } from "../store/cartStore";
import { paymentStore } from "../store/paymentStore";
import { productCatalogStore } from "../store/productCatalogStore";
import { container } from "../../infrastructure/di/CompositionRoot";
import type { PaymentMethod, MixedPayment } from "../engines/PaymentEngine";
import type { DiscountInput, TipInput } from "../engines/SalesEngine";
import type { Sale } from "../entities/Entities";
import { assertShiftOpen, assertSubscriptionActive, printReceiptIfEnabled, syncDashboardAfterSale } from "./checkout";
import { toast } from "../store/toastStore";
import { connectionStore } from "../store/connectionStore";
import { pendingSalesStore } from "../offline/pendingSalesStore";
import { translateBusinessError } from "../errors/translateBusinessError";
import {
  buildOfflineReceipt,
  buildOfflineSale,
  buildOfflineSaleInput,
  isNetworkFailure,
  reconstructCreateSaleInputFromSale
} from "./offlineSale";
import { logError } from "../../infrastructure/logging/opsLogger";

const PAYMENT_METHOD_MAP: Record<string, PaymentMethod> = {
  cash: "CASH",
  card: "CARD",
  transfer: "TRANSFER",
  mixed: "MIXED"
};

const PAYMENT_METHOD_LABEL: Record<string, string> = {
  cash: "Efectivo",
  card: "Tarjeta",
  transfer: "Transferencia",
  mixed: "Pago mixto"
};

const OFFLINE_ORDER_MESSAGE =
  "Sin conexión: el pedido quedó guardado en este dispositivo y se sincronizará solo cuando vuelva internet.";

const OFFLINE_CHARGE_MESSAGE =
  "Sin conexión: el cobro quedó guardado en este dispositivo y se sincronizará solo cuando vuelva internet.";

export interface ProcessSaleParams {
  cashierId: string;
  cashierName: string;
  /**
   * IDEMPOTENCIA (checklist crítico #4): id generado por la UI UNA sola vez
   * por intento de cobro (ver PosSalePanel.tsx), reutilizado en cada
   * reintento del mismo intento. Se reenvía tal cual a
   * SalesEngine.quickSale()/createSale(): si el primer intento se cayó a
   * mitad de camino y el cajero reintenta con el mismo saleId, createSale
   * detecta que la venta ya existe y la devuelve sin volver a descontar
   * inventario ni duplicar la comanda en Cocina. Opcional para no romper
   * otros llamadores (ej. CloseTableDialog.tsx) que no lo necesitan.
   */
  saleId?: string;
}

/**
 * Parte 3 del plan de ventas offline: arma la venta localmente (sin tocar
 * Supabase) y la deja en la cola de la Parte 2 (pendingSalesStore),
 * devolviendo una Sale con la misma forma que la de SalesEngine.createSale()
 * para que el resto del flujo (chargeSale, PosSalePanel) no necesite saber
 * si esta venta ya está en el servidor o todavía no.
 */
async function queueOrderOffline(
  saleId: string,
  items: CartItem[],
  params: ProcessSaleParams
): Promise<Sale> {
  const createSaleInput = buildOfflineSaleInput({
    saleId,
    items,
    cashierId: params.cashierId
  });

  const sale = buildOfflineSale(createSaleInput);

  await pendingSalesStore.enqueue({
    createSaleInput,
    cashierName: params.cashierName
  });

  // Mismo efecto que this.clearSource(source) dentro de createSale() en el
  // flujo online: el pedido ya quedó registrado (aquí, en la cola local),
  // así que el carrito se limpia igual para que el cajero pueda empezar
  // el siguiente cliente.
  cartStore.clear();

  toast.warning(OFFLINE_ORDER_MESSAGE);

  return sale;
}

/**
 * Paso 7 — botón Cobrar inteligente, primer paso del flujo de restaurante:
 * crea la venta (PENDING_PAYMENT) y la manda a Cocina real (KitchenEngine,
 * dentro de SalesEngine.createSale), pero todavía NO cobra. Devuelve la
 * Sale creada para que el segundo click (chargeSale) la cobre cuando el
 * cliente pida la cuenta. No toca el carrito ni paymentStore — ambos
 * siguen vivos hasta que la venta se cobra de verdad.
 *
 * Si no hay conexión real (Parte 1), o si Supabase falla por red a mitad
 * de camino, este paso no le muestra un error al cajero: la venta se
 * arma localmente y se encola (ver queueOrderOffline) para sincronizarse
 * sola cuando vuelva internet (Parte 4). Un error de VALIDACIÓN real (ej.
 * sin stock) sigue mostrándose tal cual — eso no es un problema de red.
 */
export async function sendOrderToKitchen(params: ProcessSaleParams): Promise<Sale | null> {
  const items = cartStore.getItems();

  if (items.length === 0) {
    return null;
  }

  let shiftOpen: boolean;
  try {
    shiftOpen = await assertShiftOpen();
  } catch (error) {
    if (isNetworkFailure(error) && !connectionStore.isOnline()) {
      // Sin internet no hay forma de confirmar el turno contra el
      // servidor (getCurrentShift() necesita Supabase). Se asume abierto
      // para no bloquear la venta offline — si en verdad no lo estaba,
      // la Parte 4 lo deja en evidencia al sincronizar, sin haber perdido
      // la venta ni el dinero cobrado.
      shiftOpen = true;
    } else {
      toast.error("No se pudo verificar el turno de caja.");
      return null;
    }
  }

  if (!shiftOpen) {
    return null;
  }

  if (!(await assertSubscriptionActive())) {
    return null;
  }

  // Se genera (o reutiliza) el saleId ANTES de saber si se podrá ir por
  // el camino online: así el mismo id sirve de clave de idempotencia sin
  // importar cuál de los dos caminos termine tomando esta venta.
  const saleId = (params.saleId && params.saleId.trim() !== "") ? params.saleId : crypto.randomUUID();

  if (!connectionStore.isOnline()) {
    return queueOrderOffline(saleId, items, params);
  }

  const payment = paymentStore.get();

  const discount: DiscountInput | undefined =
    payment.discountType && payment.discountValue > 0
      ? { type: payment.discountType, value: payment.discountValue }
      : undefined;

  // BLOQUEANTE (auditoría Fase 2 — rama Bar): ver Sale.tip.
  const tip: TipInput | undefined =
    payment.tipType && payment.tipValue > 0
      ? { type: payment.tipType, value: payment.tipValue }
      : undefined;

  try {
    const sale = await container.salesEngine.quickSale({
      id: saleId,
      source: items.map((item) => ({
        productId: item.id,
        quantity: item.quantity,
        price: item.price,
        note: item.note,
        requiresKitchen: item.requiresKitchen
      })),
      customerId: payment.customerId ?? undefined,
      cashierId: params.cashierId,
      discount,
      tip,
      notes: payment.notes || undefined,
      priority: payment.priority
    });

    return sale;
  } catch (error) {
    if (isNetworkFailure(error)) {
      return queueOrderOffline(saleId, items, params);
    }

    toast.error(translateBusinessError(error, "No se pudo enviar la comanda a cocina."));
    return null;
  }
}

/**
 * Cobra una venta que quedó en la cola local (offline) en vez de en
 * Supabase: actualiza el mismo registro de pendingSalesStore con los
 * datos del cobro (createSale() la reconocerá por id al sincronizar,
 * ver checklist crítico #4) e imprime un recibo provisional armado en
 * memoria, sin persistirlo todavía.
 */
async function chargeSaleOffline(
  sale: Sale,
  params: ProcessSaleParams,
  method: PaymentMethod,
  mixed: MixedPayment | undefined,
  itemNames: Map<string, string>
): Promise<boolean> {
  const payment = paymentStore.get();

  if (method === "CASH") {
    const received = payment.received ?? sale.total;
    if (received < sale.total) {
      toast.warning(
        `El efectivo recibido ($${(received).toLocaleString("es-CO")}) no cubre el total ($${(sale.total).toLocaleString("es-CO")}).`
      );
      return false;
    }
  }

  const alreadyQueued = pendingSalesStore.list().find((pending) => pending.id === sale.id);

  // Si sendOrderToKitchen() ya la había encolado offline, se reutiliza
  // exactamente el mismo createSaleInput (conserva el descuento real).
  // Si en cambio la venta SÍ llegó a crearse online y la red se cayó
  // recién ahora al cobrarla, se reconstruye a partir de la Sale ya
  // existente (ver reconstructCreateSaleInputFromSale) en vez de fiarse
  // del carrito, que a esta altura del flujo de un solo click ya pudo
  // haberse vaciado.
  const createSaleInput =
    alreadyQueued?.createSaleInput ?? reconstructCreateSaleInputFromSale(sale, params.cashierId);

  await pendingSalesStore.enqueue({
    createSaleInput,
    cashierName: params.cashierName,
    payment: {
      method,
      received: method === "CASH" ? payment.received || sale.total : sale.total,
      reference: payment.reference || undefined,
      mixed
    }
  });

  const receipt = buildOfflineReceipt({
    sale,
    customerName: payment.customerName,
    cashierName: params.cashierName,
    paymentMethodLabel: PAYMENT_METHOD_LABEL[payment.method] ?? payment.method,
    received:
      method === "MIXED"
        ? payment.mixedCash + payment.mixedCard + payment.mixedTransfer
        : payment.received || sale.total
  });

  const printableItems = sale.items.map((item) => ({
    name: itemNames.get(item.productId) ?? item.productId,
    quantity: item.quantity,
    price: item.price,
    unit: item.unit,
    quantityRaw: item.quantityRaw,
    selectedSizeId: item.selectedSizeId,
    selectedExtraIds: item.selectedExtraIds,
    discount: item.discount,
    taxRate: item.taxRate
  }));

  printReceiptIfEnabled(receipt, printableItems);

  toast.warning(OFFLINE_CHARGE_MESSAGE);

  cartStore.clear();
  paymentStore.reset();

  return true;
}

/**
 * Paso 7 — segundo paso: cobra una Sale que ya existe (PENDING_PAYMENT),
 * ya sea porque se acaba de crear (tienda, flujo de un solo click vía
 * processSale) o porque ya se había enviado a Cocina antes (restaurante,
 * flujo de dos clicks). Aquí sí se limpia el carrito y se resetea el pago.
 *
 * Igual que sendOrderToKitchen: si no hay conexión real, o si Supabase
 * falla por red a mitad del cobro, no se le muestra un error al cajero —
 * el cobro se guarda en la cola local (ver chargeSaleOffline) y se
 * sincroniza solo cuando vuelva internet.
 */
export async function chargeSale(
  sale: Sale,
  params: ProcessSaleParams,
  precomputedItemNames?: Map<string, string>
): Promise<boolean> {
  // Los nombres de producto no viven en Sale/SaleItem (solo productId+price+
  // quantity), así que normalmente se toman del carrito real. BUG que se
  // arregla acá: si esta venta ya se armó/encoló offline en el paso
  // anterior (sendOrderToKitchen -> queueOrderOffline), ESE paso ya vació
  // el carrito (ver queueOrderOffline), así que leerlo aquí de nuevo
  // devuelve un mapa vacío y el recibo termina mostrando el productId en
  // vez del nombre. Por eso processSale() captura los nombres ANTES de
  // llamar a sendOrderToKitchen (mientras el carrito todavía tiene algo) y
  // los pasa acá ya listos; si no vienen (ej. alguien llama a chargeSale()
  // directo, como hacía antes el flujo de dos clics), se cae al
  // comportamiento de siempre.
  const itemNames = precomputedItemNames ?? new Map(cartStore.getItems().map((item) => [item.id, item.name]));

  const payment = paymentStore.get();
  const method = PAYMENT_METHOD_MAP[payment.method] ?? "CASH";

  if (payment.method === "mixed") {
    const mixedTotal = payment.mixedCash + payment.mixedCard + payment.mixedTransfer;
    if (mixedTotal < payment.total) {
      toast.warning(
        `El pago mixto no cubre el total. Faltan $${(payment.total - mixedTotal).toLocaleString("es-CO")}.`
      );
      return false;
    }
  }

  const requiresPaymentReference =
    payment.method === "card" ||
    payment.method === "transfer" ||
    (payment.method === "mixed" && (payment.mixedCard > 0 || payment.mixedTransfer > 0));

  if (requiresPaymentReference && !payment.reference.trim()) {
    toast.warning("Debe ingresar una referencia de pago para la tarjeta/transferencia.");
    return false;
  }

  const mixed: MixedPayment | undefined =
    method === "MIXED"
      ? {
          cash: payment.mixedCash || undefined,
          card: payment.mixedCard || undefined,
          transfer: payment.mixedTransfer || undefined
        }
      : undefined;

  // Si la venta ya está en la cola offline (se creó sin conexión en
  // sendOrderToKitchen) o si ahora mismo no hay internet real, ni
  // siquiera se intenta hablar con Supabase: se va directo al camino
  // offline, igual que hace queueOrderOffline en sendOrderToKitchen.
  const isQueuedOffline = pendingSalesStore.list().some((pending) => pending.id === sale.id);

  if (isQueuedOffline || !connectionStore.isOnline()) {
    return chargeSaleOffline(sale, params, method, mixed, itemNames);
  }

  try {
    const { sale: paidSale } = await container.salesEngine.registerPayment(sale, method, {
      received: method === "CASH" ? payment.received || sale.total : sale.total,
      reference: payment.reference || undefined,
      mixed
    });

    const receipt = await container.salesEngine.generateReceipt(
      paidSale,
      payment.customerName,
      params.cashierName,
      PAYMENT_METHOD_LABEL[payment.method] ?? payment.method,
      method === "MIXED" ? payment.mixedCash + payment.mixedCard + payment.mixedTransfer : payment.received || paidSale.total
    );

    // Impresión real: abre el diálogo de impresión del sistema con el
    // recibo formateado (no un console.log). Respeta la configuración
    // real del negocio (companyConfigStore.autoPrintReceipt) — regla
    // compartida con el cobro de mesas, ver checkout.ts.
    const printableItems = paidSale.items.map((item) => ({
      name: itemNames.get(item.productId) ?? item.productId,
      quantity: item.quantity,
      price: item.price,
      unit: item.unit,
      quantityRaw: item.quantityRaw,
      selectedSizeId: item.selectedSizeId,
      selectedExtraIds: item.selectedExtraIds,
      discount: item.discount,
      taxRate: item.taxRate
    }));

    printReceiptIfEnabled(receipt, printableItems);

    // La comanda a Cocina ya se envió antes (sendOrderToKitchen ->
    // quickSale() -> createSale()), usando el KitchenEngine real. No se
    // vuelve a enviar aquí: hacerlo generaría una segunda comanda
    // duplicada con el mismo id de venta.

    // La venta YA está cobrada y confirmada en Supabase (registerPayment,
    // arriba). Lo que sigue es refrescar lo que el cajero VE en pantalla
    // (stock del catálogo, tarjetas del Dashboard) — no afecta si la venta
    // quedó bien guardada. Por eso el cajero no tiene que esperarlo: se
    // dispara en segundo plano, sigue siendo 100% real contra Supabase,
    // solo que ya no está en el camino crítico del cobro. El Dashboard de
    // todas formas se reconcilia solo con datos reales vía useDashboardSync
    // (evento "sale"), así que no se pierde ni se inventa ningún número.
    productCatalogStore.refresh().catch((error) => {
      logError("No se pudo refrescar el catálogo tras la venta", { category: "sync", context: { error: String(error) } });
    });

    syncDashboardAfterSale(paidSale).catch((error) => {
      logError("No se pudo sincronizar el Dashboard tras la venta", { category: "sync", context: { error: String(error) } });
    });

    cartStore.clear();
    paymentStore.reset();

    return true;
  } catch (error) {
    if (isNetworkFailure(error)) {
      // La venta se cayó por red a mitad del cobro. Gracias a la
      // idempotencia por id (checklist crítico #4) no hay riesgo de
      // duplicar nada: si `sale` ya se había creado en el servidor, al
      // sincronizar createSale() la reconoce y solo falta el pago.
      return chargeSaleOffline(sale, params, method, mixed, itemNames);
    }

    toast.error(translateBusinessError(error, "No se pudo procesar el pago."));
    return false;
  }
}

/**
 * Flujo de un solo click (tienda, sin módulo Cocina): crea la venta y la
 * cobra de inmediato, igual que antes. Internamente reusa los mismos dos
 * pasos que el flujo de restaurante, así que el comportamiento real
 * (inventario, Cocina, recibo, Dashboard) es exactamente el mismo — solo
 * cambia si el cajero ve uno o dos clicks. Lo mismo aplica al modo
 * offline: si no hay conexión, ambos pasos internos caen a la cola local
 * sin que el cajero note más que el aviso de "sin conexión".
 */
export async function processSale(params: ProcessSaleParams): Promise<boolean> {
  // Se capturan los nombres ANTES de sendOrderToKitchen (ver comentario en
  // chargeSale de arriba): si no hay conexión, sendOrderToKitchen vacía el
  // carrito internamente antes de que lleguemos a chargeSale.
  const itemNames = new Map(cartStore.getItems().map((item) => [item.id, item.name]));

  const sale = await sendOrderToKitchen(params);

  if (!sale) {
    return false;
  }

  return chargeSale(sale, params, itemNames);
}