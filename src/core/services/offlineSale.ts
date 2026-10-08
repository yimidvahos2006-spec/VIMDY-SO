import { container } from "../../infrastructure/di/CompositionRoot";
import { companyConfigStore } from "../store/companyConfigStore";
import { paymentStore } from "../store/paymentStore";
import { isOptimisticLockError } from "../errors/OptimisticLockError";
import type { CartItem } from "../store/cartStore";
import type {
  CreateSaleInput,
  DiscountInput,
  TipInput
} from "../engines/SalesEngine";
import type {
  Sale,
  SaleItem
} from "../entities/Entities";
import type { Receipt } from "../engines/ReceiptEngine";

/**
 * Construcción de ventas offline.
 *
 * Este módulo no persiste ventas y no realiza peticiones a Supabase.
 * Su responsabilidad es construir exactamente los mismos DTOs y entidades
 * que utilizará el flujo online cuando la venta pueda sincronizarse.
 */

const OFFLINE_CODE_PREFIX = "OFFLINE";

const DEFAULT_CUSTOMER_ID = "CLIENTE_GENERAL";

/**
 * Errores que representan problemas de negocio y NO deben interpretarse
 * como una caída de red.
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
 * Determina si un error debe tratarse como fallo de conectividad.
 *
 * Los errores explícitamente conocidos como errores de negocio no deben
 * pasar al flujo offline, porque reintentarlos no solucionará el problema.
 *
 * Un OptimisticLockError tampoco es un error de red: representa un conflicto
 * de concurrencia y debe seguir su propio flujo de resolución.
 */
export function isNetworkFailure(
  error: unknown
): boolean {
  if (isOptimisticLockError(error)) {
    return false;
  }

  if (error instanceof Error) {
    return !BUSINESS_ERROR_PREFIXES.some(
      (prefix) =>
        error.message.startsWith(prefix)
    );
  }

  /*
   * Algunos adaptadores pueden rechazar con valores que no sean instancias
   * de Error. En ausencia de una señal explícita de negocio se considera
   * recuperable como problema de infraestructura.
   */
  return true;
}

/**
 * Construye el CreateSaleInput que habría utilizado SalesEngine.createSale()
 * si la operación hubiera tenido conectividad.
 *
 * El saleId debe conservarse durante todos los reintentos. Es la clave de
 * idempotencia que relaciona:
 *
 * carrito -> cola local -> createSale() -> pago.
 */
export function buildOfflineSaleInput(
  params: {
    saleId: string;
    items: CartItem[];
    cashierId?: string;
    waiterId?: string;
  }
): CreateSaleInput {
  if (!params.saleId.trim()) {
    throw new Error(
      "PENDING_SALE_REQUIRES_ID: saleId es obligatorio para una venta offline."
    );
  }

  if (params.items.length === 0) {
    throw new Error(
      "EMPTY_ORDER: no se puede construir una venta offline sin productos."
    );
  }

  const payment = paymentStore.get();

  const discount: DiscountInput | undefined =
    payment.discountType &&
    payment.discountValue > 0
      ? {
          type: payment.discountType,
          value: payment.discountValue
        }
      : undefined;

  const tip: TipInput | undefined =
    payment.tipType &&
    payment.tipValue > 0
      ? {
          type: payment.tipType,
          value: payment.tipValue
        }
      : undefined;

  return {
    id: params.saleId,

    type: "QUICK",

    items: params.items.map(
      (item) => ({
        productId: item.id,
        quantity: item.quantity,
        price: item.price,
        note: item.note,
        requiresKitchen:
          item.requiresKitchen
      })
    ),

    customerId:
      payment.customerId ??
      undefined,

    cashierId:
      params.cashierId,

    waiterId:
      params.waiterId,

    discount,

    tip,

    notes:
      payment.notes ||
      undefined,

    priority:
      payment.priority
  };
}

/**
 * Reconstruye la receta original de creación a partir de una Sale.
 *
 * Este caso es importante cuando:
 *
 * 1. createSale() alcanzó el servidor.
 * 2. El servidor creó la venta.
 * 3. La respuesta se perdió por un problema de red.
 * 4. El pago no llegó a confirmarse en el cliente.
 *
 * Al conservar sale.id como createSaleInput.id, el siguiente intento puede
 * ser reconocido por la lógica idempotente del SalesEngine.
 */
export function reconstructCreateSaleInputFromSale(
  sale: Sale,
  cashierId?: string
): CreateSaleInput {
  if (!sale.id) {
    throw new Error(
      "PENDING_SALE_REQUIRES_ID: no se puede reconstruir una venta sin id."
    );
  }

  return {
    id: sale.id,

    type:
      sale.type ??
      "QUICK",

    items:
      sale.items.map(
        (item) => ({
          productId:
            item.productId,

          quantity:
            item.quantity,

          price:
            item.price
        })
      ),

    customerId:
      sale.customerId,

    cashierId:
      cashierId ??
      sale.cashierId,

    tableId:
      sale.tableId,

    deliveryAddress:
      sale.deliveryAddress,

    notes:
      sale.notes,

    waiterId:
      sale.waiterId,

    priority:
      sale.priority
  };
}

/**
 * Construye una Sale local sin acceder al backend.
 *
 * IMPORTANTE:
 * La Sale local es una representación temporal para que la UI pueda
 * continuar funcionando mientras la operación espera sincronización.
 *
 * El inventario, la caja, la cocina y la factura REAL no se consideran
 * confirmados hasta que SalesEngine procese la operación contra el backend.
 */
export function buildOfflineSale(
  input: CreateSaleInput
): Sale {
  if (!input.id) {
    throw new Error(
      "PENDING_SALE_REQUIRES_ID: una venta offline necesita un id estable."
    );
  }

  if (
    !input.items ||
    input.items.length === 0
  ) {
    throw new Error(
      "EMPTY_ORDER: no se puede construir una venta sin productos."
    );
  }

  const items: SaleItem[] =
    input.items.map(
      (item) => ({
        productId:
          item.productId,

        quantity:
          item.quantity,

        price:
          item.price ??
          0
      })
    );

  /*
   * Utilizamos los métodos de cálculo existentes en SalesEngine en lugar
   * de duplicar las reglas fiscales/comerciales en este servicio.
   */
  const salesEngine =
    container.salesEngine.get();

  const subtotal =
    salesEngine.calculateSubtotal(
      items
    );

  const taxRate =
    input.taxRate ??
    companyConfigStore.get().tax /
      100;

  const tax =
    salesEngine.calculateTax(
      subtotal,
      taxRate
    );

  const discount =
    salesEngine.calculateDiscount(
      subtotal,
      input.discount
    );

  const deliveryFee =
    input.type === "DELIVERY"
      ? input.deliveryFee ?? 0
      : 0;

  const tip =
    salesEngine.calculateTip(
      subtotal,
      input.tip
    );

  const total =
    salesEngine.calculateTotal(
      subtotal,
      tax,
      discount,
      deliveryFee,
      tip
    );

  const now =
    new Date();

  return {
    id:
      input.id,

    code:
      `${OFFLINE_CODE_PREFIX}-${input.id}`,

    customerId:
      input.customerId ??
      DEFAULT_CUSTOMER_ID,

    items,

    subtotal,

    tax,

    discount,

    deliveryFee,

    tip,

    total,

    createdAt:
      now,

    updatedAt:
      now,

    type:
      input.type,

    status:
      "PENDING_PAYMENT",

    tableId:
      input.tableId,

    cashierId:
      input.cashierId,

    waiterId:
      input.waiterId,

    deliveryAddress:
      input.deliveryAddress,

    notes:
      input.notes,

    priority:
      input.priority ??
      "NORMAL"
  };
}

/**
 * Construye un recibo local para impresión inmediata.
 *
 * Este recibo no significa que la venta haya sido confirmada por Supabase.
 * Es una representación local de la operación que será reconciliada al
 * sincronizar.
 */
export function buildOfflineReceipt(
  params: {
    sale: Sale;
    customerName: string;
    cashierName: string;
    paymentMethodLabel: string;
    received: number;
  }
): Receipt {
  const {
    sale,
    customerName,
    cashierName,
    paymentMethodLabel,
    received
  } = params;

  const currency =
    companyConfigStore.get()
      .currency;

  const saleTotal =
    sale.total ?? 0;

  return {
    id:
      crypto.randomUUID(),

    code:
      sale.code ??
      sale.id,

    customerId:
      sale.customerId,

    customerName,

    cashier:
      cashierName,

    paymentMethod:
      paymentMethodLabel,

    items:
      [...sale.items],

    currency,

    subtotal:
      sale.subtotal ?? 0,

    tax:
      sale.tax ?? 0,

    discount:
      sale.discount ?? 0,

    tip:
      sale.tip ?? 0,

    total:
      saleTotal,

    received,

    change:
      Math.max(
        received -
          saleTotal,
        0
      ),

    createdAt:
      new Date()
  };
}