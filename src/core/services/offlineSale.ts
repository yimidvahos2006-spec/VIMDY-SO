import { container } from "../../infrastructure/di/CompositionRoot";
import { companyConfigStore } from "../store/companyConfigStore";
import { paymentStore } from "../store/paymentStore";
import { isOptimisticLockError } from "../errors/OptimisticLockError";
import type { CartItem } from "../store/cartStore";
import type { CreateSaleInput, DiscountInput, TipInput } from "../engines/SalesEngine";
import type { Sale, SaleItem } from "../entities/Entities";
import type { Receipt } from "../engines/ReceiptEngine";

/**
 * offlineSale.ts
 * ---------------------------------------------------------------------------
 * Parte 3 del plan de ventas offline: piezas puras que arman una venta
 * "como si" hubiera pasado por SalesEngine.createSale()/registerPayment(),
 * pero sin tocar Supabase en ningún momento. No persisten nada por su
 * cuenta — quien llama decide qué hacer con lo que devuelven (típicamente,
 * pendingSalesStore.enqueue() en processSale.ts).
 *
 * Todo lo que se usa aquí es intencionalmente local: companyConfigStore
 * (config de impuestos/moneda ya cacheada en el navegador) y los métodos
 * de cálculo de SalesEngine (calculateSubtotal/Tax/Discount/Total), que
 * son funciones puras — no hacen ningún request.
 */

/** Prefijo que distingue un código de venta generado en el navegador (sin Supabase) de uno real. */
const OFFLINE_CODE_PREFIX = "OFFLINE";

/** Debe coincidir con SalesEngineConfig.defaultCustomerId (no se exporta desde SalesEngine.ts). */
const DEFAULT_CUSTOMER_ID = "CLIENTE_GENERAL";

/**
 * Prefijos de errores de NEGOCIO que ya usa el resto del sistema (ver
 * SalesEngine, InventoryEngine, ShiftEngine, TableEngine, etc.) — nunca
 * son un problema de red, así que nunca deben disparar el modo offline
 * ni confundir a la Parte 4 (sincronización). "INSUFFICIENT_STOCK:" en
 * particular es el que lanza InventoryEngine.consumeForSale cuando el
 * stock cambió justo antes del descuento atómico (createSale ya pasó su
 * propia validación previa, pero la venta igual no se puede completar)
 * — es exactamente el caso "se vendió lo último mientras estabas
 * offline" que la Parte 4 debe marcar FAILED para revisión manual, no
 * reintentar como si fuera de red.
 */
const BUSINESS_ERROR_PREFIXES = [
  "VALIDATION_ERROR:",
  "INSUFFICIENT_STOCK:",
  "SHIFT_ALREADY_OPEN:",
  "SHIFT_ALREADY_CLOSED:",
  "SALE_NOT_PAID:",
  "EMPTY_ORDER:",
  "EMPTY_TABLE:",
  "TABLE_NOT_AVAILABLE:",
  "TABLE_NOT_OPEN:",
  "TABLE_NOT_FOUND",
  "ORDER_LOCKED:",
  "ORDER_MISSING_TABLE:",
  "CANCEL_REASON_REQUIRED:",
  "INVALID_AMOUNT:",
  "INVALID_ITEM:",
  "INVALID_SPLIT:",
  "PENDING_SALE_REQUIRES_ID:",
  "CONTEXT_MISMATCH:"
];

/**
 * Distingue un error de NEGOCIO real (ver BUSINESS_ERROR_PREFIXES arriba,
 * y también un OptimisticLockError — "alguien más ya guardó esto") de
 * cualquier otra falla, que en la práctica es de red: fetch rechazado,
 * timeout, DNS, Supabase caído, etc. Los errores de negocio SÍ se le
 * deben mostrar al cajero/administrador tal cual (el pedido está mal
 * armado o hay un conflicto real de datos, no es un problema de
 * conexión); los demás disparan el modo offline (Parte 3) o, durante la
 * sincronización, detienen el lote para reintentar más tarde (Parte 4).
 */
export function isNetworkFailure(error: unknown): boolean {
  if (isOptimisticLockError(error)) return false;

  if (error instanceof Error) {
    return !BUSINESS_ERROR_PREFIXES.some((prefix) => error.message.startsWith(prefix));
  }

  return true;
}

/**
 * Arma el CreateSaleInput que se habría mandado a SalesEngine.createSale()
 * si hubiera habido internet. `saleId` es obligatorio (a diferencia del
 * flujo online) porque es la clave de idempotencia que usará tanto la cola
 * local (Parte 2) como el propio createSale() al sincronizar (Parte 4).
 */
export function buildOfflineSaleInput(params: {
  saleId: string;
  items: CartItem[];
  cashierId?: string;
}): CreateSaleInput {
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

  return {
    id: params.saleId,
    type: "QUICK",
    items: params.items.map((item) => ({
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
  };
}

/**
 * Reconstruye un CreateSaleInput a partir de una Sale ya existente (real o
 * local). Se usa en el caso límite en que la venta SÍ se alcanzó a crear
 * online (ya tiene id de servidor) pero la red se cayó justo al cobrarla:
 * en ese momento el carrito ya pudo haberse vaciado, así que no conviene
 * depender de él. El descuento original no se reconstruye tal cual (Sale
 * solo guarda el monto ya calculado, no el DiscountInput de origen), pero
 * no importa: si la venta ya existe en el servidor, createSale() la
 * reconoce por id al sincronizar y devuelve la que ya está, sin volver a
 * calcular nada (ver SalesEngine.createSale, checklist crítico #4).
 */
export function reconstructCreateSaleInputFromSale(
  sale: Sale,
  cashierId?: string
): CreateSaleInput {
  return {
    id: sale.id,
    type: sale.type ?? "QUICK",
    items: sale.items.map((item) => ({
      productId: item.productId,
      quantity: item.quantity,
      price: item.price
    })),
    customerId: sale.customerId,
    cashierId,
    tableId: sale.tableId,
    deliveryAddress: sale.deliveryAddress,
    notes: sale.notes,
    waiterId: sale.waiterId,
    priority: sale.priority
  };
}

/**
 * Construye una Sale completa SIN tocar Supabase, usando únicamente datos
 * ya disponibles en el navegador: los items (con precio, que ya viene del
 * carrito) y los métodos de cálculo puros de SalesEngine. Se le da un
 * código local claramente distinguible (prefijo "OFFLINE-") para que
 * nunca se confunda con un código real generado por el servidor.
 *
 * Es la misma forma de objeto que devolvería createSale() en el flujo
 * online, así que el resto de la UI (PosSalePanel, chargeSale, impresión
 * de recibo) puede tratarla exactamente igual sin casos especiales.
 */
export function buildOfflineSale(input: CreateSaleInput): Sale {
  const items: SaleItem[] = input.items.map((item) => ({
    productId: item.productId,
    quantity: item.quantity,
    price: item.price ?? 0
  }));

  const subtotal = container.salesEngine.calculateSubtotal(items);
  const taxRate = input.taxRate ?? companyConfigStore.get().tax / 100;
  const tax = container.salesEngine.calculateTax(subtotal, taxRate);
  const discount = container.salesEngine.calculateDiscount(subtotal, input.discount);
  const deliveryFee = input.type === "DELIVERY" ? input.deliveryFee ?? 0 : 0;
  // BLOQUEANTE (auditoría Fase 2 — rama Bar): ver Sale.tip.
  const tip = container.salesEngine.calculateTip(subtotal, input.tip);
  const total = container.salesEngine.calculateTotal(subtotal, tax, discount, deliveryFee, tip);

  const now = new Date();

  return {
    id: input.id ?? crypto.randomUUID(),
    code: `${OFFLINE_CODE_PREFIX}-${now.getTime()}`,
    customerId: input.customerId ?? DEFAULT_CUSTOMER_ID,
    items,
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
}

/**
 * Construye el mismo tipo de objeto que ReceiptEngine.generate(), pero en
 * memoria y sin persistirlo (no hay red para guardarlo en `receipts`
 * todavía). Sirve únicamente para poder imprimirle algo al cliente en el
 * momento; el recibo "real" se genera de verdad cuando la venta se
 * sincroniza (Parte 4).
 */
export function buildOfflineReceipt(params: {
  sale: Sale;
  customerName: string;
  cashierName: string;
  paymentMethodLabel: string;
  received: number;
}): Receipt {
  const { sale } = params;
  const currency = companyConfigStore.get().currency;

  return {
    id: crypto.randomUUID(),
    code: sale.code ?? sale.id,
    customerId: sale.customerId,
    customerName: params.customerName,
    cashier: params.cashierName,
    paymentMethod: params.paymentMethodLabel,
    items: [...sale.items],
    currency,
    subtotal: sale.subtotal ?? 0,
    tax: sale.tax ?? 0,
    discount: sale.discount ?? 0,
    tip: sale.tip ?? 0,
    total: sale.total,
    received: params.received,
    change: Math.max(params.received - sale.total, 0),
    createdAt: new Date()
  };
}