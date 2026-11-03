import { ObservableStore } from "./ObservableStore";
import { OrderPriority } from "../entities/Entities";
import {
  MixedKind,
  remainderFor,
  sanitizeMixedAmount,
  summarizeMixed
} from "../payments/mixedPayment";

export type PaymentMethod = "cash" | "card" | "transfer" | "mixed";
export type DiscountType = "PERCENT" | "FIXED";
/** BLOQUEANTE (auditoría Fase 2 — rama Bar): mismo shape que DiscountType. */
export type TipType = "PERCENT" | "FIXED";

export interface PaymentState {
  method: PaymentMethod;
  received: number;
  total: number;
  change: number;
  paid: boolean;

  // Cliente real asociado a la venta (CustomerEngine). Si es null, la venta
  // se factura a "Cliente General" (comportamiento por defecto de SalesEngine).
  customerId: string | null;
  customerName: string;

  // Descuento real que se envia a SalesEngine.createSale({ discount }).
  discountType: DiscountType | null;
  discountValue: number;
  discountAmount: number;

  // BLOQUEANTE (auditoría Fase 2 — rama Bar): propina real que se envía a
  // SalesEngine.createSale({ tip }). Mismo patrón que discount* de arriba:
  // tipType/tipValue son lo que el cajero eligió (ej. 10% o $5.000 fijo),
  // tipAmount es el monto ya calculado (SalesEngine.calculateTip) listo
  // para mostrar en el resumen y enviar a la venta.
  tipType: TipType | null;
  tipValue: number;
  tipAmount: number;

  // Referencia de la transaccion (tarjeta/transferencia), requerida por
  // PaymentEngine.payCard / payTransfer para que el pago quede trazable.
  reference: string;

  // Cuenta de cobro elegida (business_payment_accounts.id) cuando el método es
  // transferencia. Vacío = ninguna elegida. Al elegirla, `reference` queda con
  // el nombre legible de la cuenta (ej. "Nequi - Caja 1") para que la venta
  // sea trazable sin cambiar el contrato de processSale/PaymentEngine.
  paymentAccountId: string;

  // Desglose real de un pago mixto. La suma debe cubrir el total.
  mixedCash: number;
  mixedCard: number;
  mixedTransfer: number;

  // Pago mixto inteligente: mientras `mixedAutoEnabled` sea true, el campo
  // `mixedBalanceKind` (efectivo o transferencia) se llena solo con lo que
  // falta por cubrir cada vez que el cajero escribe en el otro campo o cambia
  // el total. Si el cajero escribe a mano en ese campo, se apaga el
  // automático (respeta lo que escribió) hasta que pulse "Completar con ...".
  mixedAutoEnabled: boolean;
  mixedBalanceKind: MixedKind | null;

  // Observaciones de la venta, enviadas como Sale.notes.
  notes: string;

  // Prioridad manual de la comanda, enviada como Sale.priority -> KitchenOrder.
  // Mismo campo y mismo default (NORMAL) que usa Mesas en TableDetailPanel.
  priority: OrderPriority;

  // Paso 7 — botón Cobrar inteligente: si el cajero marca que esta venta
  // necesita factura, el botón final cambia de "Cobrar" a
  // "Pagar y facturar". Por ahora es solo una señal de UI (no hay InvoiceEngine
  // todavía); cuando exista, este flag es lo que lo dispara.
  requiresInvoice: boolean;

  // POS externo: si es true, se crea un checkout de Wompi en vez de pedir
  // referencia manual. El pago queda PENDING_VERIFICATION hasta que el webhook
  // confirme.
  useWompiCheckout: boolean;
}

const INITIAL_STATE: PaymentState = {
  method: "cash",
  received: 0,
  total: 0,
  change: 0,
  paid: false,
  customerId: null,
  customerName: "Cliente General",
  discountType: null,
  discountValue: 0,
  discountAmount: 0,
  tipType: null,
  tipValue: 0,
  tipAmount: 0,
  reference: "",
  paymentAccountId: "",
  mixedCash: 0,
  mixedCard: 0,
  mixedTransfer: 0,
  mixedAutoEnabled: true,
  mixedBalanceKind: null,
  notes: "",
  priority: "NORMAL",
  requiresInvoice: false,
  useWompiCheckout: false,
};

class PaymentStore extends ObservableStore<PaymentState> {
  private state: PaymentState = { ...INITIAL_STATE };

  constructor() {
    super({ ...INITIAL_STATE });
  }

  private sync() {
    if (this.state.method === "mixed") this.refreshMixed();
    this.publish({ ...this.state });
  }

  /** Mantiene recibido/vuelto/pagado coherentes con el desglose mixto. */
  private refreshMixed() {
    const summary = summarizeMixed(this.state.total, {
      cash: this.state.mixedCash,
      card: this.state.mixedCard,
      transfer: this.state.mixedTransfer
    });
    this.state.received = summary.received;
    this.state.change = summary.change;
    this.state.paid = summary.valid;
  }

  private mixedAmounts() {
    return {
      cash: this.state.mixedCash,
      card: this.state.mixedCard,
      transfer: this.state.mixedTransfer
    };
  }

  private setMixedField(kind: MixedKind, value: number) {
    if (kind === "cash") this.state.mixedCash = value;
    if (kind === "card") this.state.mixedCard = value;
    if (kind === "transfer") this.state.mixedTransfer = value;
  }

  /** Llena el campo automático con lo que falta por cubrir. */
  private rebalanceMixed() {
    const kind = this.state.mixedBalanceKind;
    if (!this.state.mixedAutoEnabled || !kind) return;
    this.setMixedField(kind, remainderFor(this.state.total, this.mixedAmounts(), kind));
  }

  get() {
    return this.snapshot;
  }

   setMethod(method: PaymentMethod) {
    // Si cambia de método, la cuenta elegida (y la referencia que salió de
    // ella) ya no aplica: evita cobrar una tarjeta con "Nequi - Caja 1".
    if (method !== this.state.method && this.state.paymentAccountId) {
      this.state.paymentAccountId = "";
      this.state.reference = "";
    }

    const enteringMixed = method === "mixed" && this.state.method !== "mixed";
    const leavingMixed = method !== "mixed" && this.state.method === "mixed";

    this.state.method = method;
    this.state.useWompiCheckout = false;

    if (enteringMixed) {
      // Montos viejos de una visita anterior al pago mixto no deben colarse
      // en la venta actual (el total pudo haber cambiado).
      this.state.mixedCash = 0;
      this.state.mixedCard = 0;
      this.state.mixedTransfer = 0;
      this.state.mixedAutoEnabled = true;
      this.state.mixedBalanceKind = null;
    }

    if (leavingMixed) {
      // El "recibido" del mixto no aplica al nuevo método.
      this.state.received = Math.max(this.state.total, 0);
    }

    if (method !== "cash") {
      this.state.received = Math.max(this.state.total, 0);
      this.state.change = 0;
      this.state.paid = true;
    } else {
      this.calculateChange(this.state.total);
    }

    this.sync();
  }

  receive(value: number) {
    this.state.received = value;
    this.calculateChange(this.state.total);
  }

  setTotal(total: number) {
    this.state.total = total;
    if (this.state.method === "mixed") this.rebalanceMixed();
    if (this.state.method !== "cash") {
      this.state.received = total;
      this.state.paid = true;
    } else {
      this.calculateChange(total);
    }
    this.sync();
  }

  calculateChange(total: number) {
    this.state.total = total;
    this.state.change = Math.max(0, this.state.received - total);
    this.state.paid = this.state.received >= total;
    this.sync();
  }

  setCustomer(customerId: string, customerName: string) {
    this.state.customerId = customerId;
    this.state.customerName = customerName;
    this.sync();
  }

  clearCustomer() {
    this.state.customerId = null;
    this.state.customerName = "Cliente General";
    this.sync();
  }

  setDiscount(type: DiscountType | null, value: number, discountAmount: number) {
    this.state.discountType = type;
    this.state.discountValue = value;
    this.state.discountAmount = discountAmount;
    this.sync();
  }

  /** BLOQUEANTE (auditoría Fase 2 — rama Bar): ver PaymentState.tipType. */
  setTip(type: TipType | null, value: number, tipAmount: number) {
    this.state.tipType = type;
    this.state.tipValue = value;
    this.state.tipAmount = tipAmount;
    this.sync();
  }

  setReference(reference: string) {
    this.state.reference = reference;
    // Una referencia escrita a mano ya no viene de una cuenta registrada.
    this.state.paymentAccountId = "";
    this.sync();
  }

  /** Cuenta de cobro elegida por el cajero + su nombre legible como referencia. */
  setPaymentAccount(accountId: string, displayName: string) {
    this.state.paymentAccountId = accountId;
    this.state.reference = displayName;
    this.sync();
  }

  clearPaymentAccount() {
    if (!this.state.paymentAccountId && !this.state.reference) return;
    this.state.paymentAccountId = "";
    this.state.reference = "";
    this.sync();
  }

  setMixedAmount(kind: MixedKind, value: number) {
    this.setMixedField(kind, sanitizeMixedAmount(value));

    if (kind === "card") {
      // La tarjeta es siempre manual; solo reajusta el campo automático.
      this.rebalanceMixed();
    } else if (this.state.mixedAutoEnabled && this.state.mixedBalanceKind === kind) {
      // Escribió a mano en el campo que se llenaba solo: se respeta lo que
      // escribió y se apaga el automático.
      this.state.mixedAutoEnabled = false;
      this.state.mixedBalanceKind = null;
    } else if (this.state.mixedAutoEnabled) {
      // Efectivo y transferencia se complementan: el que NO se tocó se
      // llena solo con lo que falta.
      this.state.mixedBalanceKind = kind === "cash" ? "transfer" : "cash";
      this.rebalanceMixed();
    }

    this.sync();
  }

  /** Botón "Completar con ...": pone en `kind` lo que falta y reactiva el automático. */
  fillMixedRemainder(kind: MixedKind) {
    this.setMixedField(kind, remainderFor(this.state.total, this.mixedAmounts(), kind));
    this.state.mixedAutoEnabled = kind !== "card";
    this.state.mixedBalanceKind = kind !== "card" ? kind : null;
    this.sync();
  }

  getMixedReceived(): number {
    return this.state.mixedCash + this.state.mixedCard + this.state.mixedTransfer;
  }

  setNotes(notes: string) {
    this.state.notes = notes;
    this.sync();
  }

  setPriority(priority: OrderPriority) {
    this.state.priority = priority;
    this.sync();
  }

  setRequiresInvoice(value: boolean) {
    this.state.requiresInvoice = value;
    this.sync();
  }

  setUseWompiCheckout(value: boolean) {
    this.state.useWompiCheckout = value;
    this.sync();
  }

  reset() {
    this.state = { ...INITIAL_STATE };
    this.sync();
  }

  isPaid() {
    if (this.state.method === "mixed") {
      return summarizeMixed(this.state.total, this.mixedAmounts()).valid;
    }
    return this.state.paid;
  }
}

export const paymentStore = new PaymentStore();