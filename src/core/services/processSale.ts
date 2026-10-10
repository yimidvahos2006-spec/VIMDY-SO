import { cartStore } from "../store/cartStore";
import type { CartItem } from "../store/cartStore";
import { paymentStore } from "../store/paymentStore";
import { productCatalogStore } from "../store/productCatalogStore";
import { container } from "../../infrastructure/di/CompositionRoot";
import type { PaymentMethod, MixedPayment } from "../engines/PaymentEngine";
import type { DiscountInput, TipInput } from "../engines/SalesEngine";
import type { Sale } from "../entities/Entities";
import {
  assertShiftOpen,
  assertSubscriptionActive,
  printReceiptIfEnabled,
  syncDashboardAfterSale
} from "./checkout";
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
   * IDEMPOTENCIA: id generado por la UI UNA sola vez por intento de cobro,
   * reutilizado en cada reintento del mismo intento.
   *
   * Se reenvía tal cual a SalesEngine.quickSale()/createSale(): si el primer
   * intento llegó a crear la venta y la respuesta se perdió, createSale()
   * puede reconocer la venta existente por su id y evitar crear una segunda
   * venta, descontar inventario nuevamente o duplicar la comanda.
   *
   * Es opcional para no romper otros llamadores que todavía no lo necesitan.
   */
  saleId?: string;
}

/**
 * Arma una venta localmente y la deja en la cola offline.
 *
 * No toca Supabase. La venta local conserva el mismo saleId que utilizará
 * posteriormente SalesEngine.createSale() durante la sincronización.
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

  /*
   * El pedido ya quedó registrado en la cola local.
   * Se libera el carrito para permitir comenzar el siguiente pedido.
   */
  cartStore.clear();

  toast.warning(OFFLINE_ORDER_MESSAGE);

  return sale;
}

/**
 * Primer paso del flujo de restaurante:
 *
 * 1. Valida que exista un pedido.
 * 2. Verifica el turno.
 * 3. Verifica la suscripción.
 * 4. Genera/reutiliza el saleId idempotente.
 * 5. Si no hay conexión, crea una representación local y la encola.
 * 6. Si hay conexión, crea la venta mediante SalesEngine.quickSale().
 *
 * El cobro todavía NO se realiza aquí.
 */
export async function sendOrderToKitchen(
  params: ProcessSaleParams
): Promise<Sale | null> {
  const items = cartStore.getItems();

  if (items.length === 0) {
    return null;
  }

  let shiftOpen: boolean;

  try {
    shiftOpen = await assertShiftOpen();
  } catch (error) {
    if (isNetworkFailure(error) && !connectionStore.isOnline()) {
      /*
       * Sin internet no se puede confirmar el turno contra Supabase.
       * Se permite continuar offline y el servidor será la autoridad final
       * durante la sincronización.
       */
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

  /*
   * El saleId debe existir antes de elegir entre online/offline.
   * Así ambos caminos representan exactamente el mismo intento de venta.
   */
  const saleId =
    params.saleId && params.saleId.trim() !== ""
      ? params.saleId
      : crypto.randomUUID();

  if (!connectionStore.isOnline()) {
    return queueOrderOffline(saleId, items, params);
  }

  const payment = paymentStore.get();

  const discount: DiscountInput | undefined =
    payment.discountType && payment.discountValue > 0
      ? {
          type: payment.discountType,
          value: payment.discountValue
        }
      : undefined;

  const tip: TipInput | undefined =
    payment.tipType && payment.tipValue > 0
      ? {
          type: payment.tipType,
          value: payment.tipValue
        }
      : undefined;

  try {
    const sale = await container.salesEngine.get().quickSale({
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
    /*
     * Una caída de red no debe convertirse en una venta perdida.
     * Se conserva el mismo saleId y se pasa al flujo offline.
     */
    if (isNetworkFailure(error)) {
      return queueOrderOffline(saleId, items, params);
    }

    toast.error(
      translateBusinessError(
        error,
        "No se pudo enviar la comanda a cocina."
      )
    );

    return null;
  }
}

/**
 * Guarda localmente el cobro de una venta que todavía no ha sido confirmado
 * por Supabase.
 *
 * El createSaleInput se reutiliza si la venta ya estaba en la cola.
 * Si la venta llegó a existir online antes de perderse la conexión,
 * se reconstruye a partir de la Sale existente utilizando su mismo id.
 */
async function chargeSaleOffline(
  sale: Sale,
  params: ProcessSaleParams,
  method: PaymentMethod,
  mixed: MixedPayment | undefined,
  itemNames: Map<string, string>
): Promise<{ success: boolean; invoiceError?: string }> {
  const payment = paymentStore.get();

  if (method === "CASH") {
    const received = payment.received ?? sale.total;

    if (received < sale.total) {
      toast.warning(
        `El efectivo recibido ($${received.toLocaleString(
          "es-CO"
        )}) no cubre el total ($${sale.total.toLocaleString("es-CO")}).`
      );

      return { success: false };
    }
  }

  const alreadyQueued = pendingSalesStore
    .list()
    .find((pending) => pending.id === sale.id);

  /*
   * Si sendOrderToKitchen() ya había creado la venta offline,
   * reutilizamos exactamente el input original.
   *
   * Si la venta sí alcanzó a existir online y la red falló al cobrar,
   * reconstruimos el input a partir de esa venta.
   */
  const createSaleInput =
    alreadyQueued?.createSaleInput ??
    reconstructCreateSaleInputFromSale(
      sale,
      params.cashierId
    );

  await pendingSalesStore.enqueue({
    createSaleInput,
    cashierName: params.cashierName,
    payment: {
      method,
      received:
        method === "CASH"
          ? payment.received || sale.total
          : sale.total,
      reference: payment.reference || undefined,
      mixed
    }
  });

  const receipt = buildOfflineReceipt({
    sale,
    customerName: payment.customerName,
    cashierName: params.cashierName,
    paymentMethodLabel:
      PAYMENT_METHOD_LABEL[payment.method] ?? payment.method,
    received:
      method === "MIXED"
        ? payment.mixedCash +
          payment.mixedCard +
          payment.mixedTransfer
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

  return {
    success: true
  };
}

/**
 * Segundo paso del flujo:
 *
 * Cobra una Sale que ya existe y está pendiente de pago.
 *
 * Puede ejecutarse:
 * - después de sendOrderToKitchen();
 * - directamente por consumidores existentes;
 * - offline;
 * - después de una pérdida de conexión durante registerPayment().
 */
export async function chargeSale(
  sale: Sale,
  params: ProcessSaleParams,
  precomputedItemNames?: Map<string, string>
): Promise<{ success: boolean; invoiceError?: string }> {
  /*
   * Los nombres de producto no forman parte necesariamente de SaleItem.
   *
   * processSale() captura estos nombres antes de enviar la venta porque
   * queueOrderOffline() puede limpiar el carrito.
   */
  const itemNames =
    precomputedItemNames ??
    new Map(
      cartStore
        .getItems()
        .map((item) => [item.id, item.name])
    );

  const payment = paymentStore.get();

  const method = PAYMENT_METHOD_MAP[payment.method] ?? "CASH";

  if (payment.method === "mixed") {
    const mixedTotal =
      payment.mixedCash +
      payment.mixedCard +
      payment.mixedTransfer;

    if (mixedTotal < payment.total) {
      toast.warning(
        `El pago mixto no cubre el total. Faltan $${(
          payment.total - mixedTotal
        ).toLocaleString("es-CO")}.`
      );

      return {
        success: false
      };
    }
  }

  const requiresPaymentReference =
    payment.method === "card" ||
    payment.method === "transfer" ||
    (payment.method === "mixed" &&
      (payment.mixedCard > 0 ||
        payment.mixedTransfer > 0));

  if (
    requiresPaymentReference &&
    !payment.reference.trim()
  ) {
    toast.warning(
      "Debe ingresar una referencia de pago para la tarjeta/transferencia."
    );

    return {
      success: false
    };
  }

  const mixed: MixedPayment | undefined =
    method === "MIXED"
      ? {
          cash:
            payment.mixedCash || undefined,
          card:
            payment.mixedCard || undefined,
          transfer:
            payment.mixedTransfer || undefined
        }
      : undefined;

  /*
   * Si la venta ya está en la cola local, nunca intentamos cobrarla
   * contra Supabase directamente desde este camino.
   *
   * Esto evita tener una venta local y una venta remota paralelas.
   */
  const isQueuedOffline = pendingSalesStore
    .list()
    .some((pending) => pending.id === sale.id);

  if (
    isQueuedOffline ||
    !connectionStore.isOnline()
  ) {
    return chargeSaleOffline(
      sale,
      params,
      method,
      mixed,
      itemNames
    );
  }

  try {
    const {
      sale: paidSale,
      payment: paymentResult
    } = await container.salesEngine
      .get()
      .registerPayment(
        sale,
        method,
        {
          received:
            method === "CASH"
              ? payment.received || sale.total
              : sale.total,
          reference:
            payment.reference || undefined,
          mixed
        }
      );

    const receipt =
      await container.salesEngine
        .get()
        .generateReceipt(
          paidSale,
          payment.customerName,
          params.cashierName,
          PAYMENT_METHOD_LABEL[payment.method] ??
            payment.method,
          method === "MIXED"
            ? payment.mixedCash +
              payment.mixedCard +
              payment.mixedTransfer
            : payment.received ||
              paidSale.total
        );

    const printableItems =
      paidSale.items.map((item) => ({
        name:
          itemNames.get(item.productId) ??
          item.productId,
        quantity: item.quantity,
        price: item.price,
        unit: item.unit,
        quantityRaw: item.quantityRaw,
        selectedSizeId:
          item.selectedSizeId,
        selectedExtraIds:
          item.selectedExtraIds,
        discount: item.discount,
        taxRate: item.taxRate
      }));

    printReceiptIfEnabled(
      receipt,
      printableItems
    );

    /*
     * La comanda ya fue enviada a Cocina durante createSale().
     *
     * No se vuelve a llamar sendToKitchen() aquí porque hacerlo podría
     * producir una segunda comanda.
     */

    /*
     * La venta ya está confirmada y cobrada.
     * Estas actualizaciones son posteriores al camino crítico.
     */
    productCatalogStore
      .refresh()
      .catch((error) => {
        logError(
          "No se pudo refrescar el catálogo tras la venta",
          {
            category: "sync",
            context: {
              error: String(error)
            }
          }
        );
      });

    syncDashboardAfterSale(paidSale)
      .catch((error) => {
        logError(
          "No se pudo sincronizar el Dashboard tras la venta",
          {
            category: "sync",
            context: {
              error: String(error)
            }
          }
        );
      });

    cartStore.clear();
    paymentStore.reset();

    return {
      success: true,
      invoiceError:
        paymentResult.invoiceError
    };
  } catch (error) {
    /*
     * Si registerPayment() falló por red, no sabemos si el servidor alcanzó
     * a registrar el pago antes de perderse la respuesta.
     *
     * Por eso se guarda la misma operación con el mismo saleId.
     * registerPayment()/CashEngine debe resolver la idempotencia del pago
     * cuando el registro vuelva a intentarse.
     */
    if (isNetworkFailure(error)) {
      return chargeSaleOffline(
        sale,
        params,
        method,
        mixed,
        itemNames
      );
    }

    toast.error(
      translateBusinessError(
        error,
        "No se pudo procesar el pago."
      )
    );

    return {
      success: false
    };
  }
}

/**
 * Flujo de un solo click:
 *
 * 1. Crea la venta.
 * 2. Cobra la venta.
 *
 * Internamente utiliza exactamente los mismos dos pasos que el flujo de
 * restaurante, por lo que online y offline conservan la misma arquitectura.
 */
export async function processSale(
  params: ProcessSaleParams
): Promise<{
  success: boolean;
  invoiceError?: string;
}> {
  /*
   * Se capturan antes de sendOrderToKitchen() porque el camino offline
   * puede limpiar el carrito al encolarlo.
   */
  const itemNames = new Map(
    cartStore
      .getItems()
      .map((item) => [item.id, item.name])
  );

  const sale =
    await sendOrderToKitchen(params);

  if (!sale) {
    return {
      success: false
    };
  }

  return chargeSale(
    sale,
    params,
    itemNames
  );
}