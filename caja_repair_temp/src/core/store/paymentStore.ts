import { ObservableStore } from "./ObservableStore";
import { OrderPriority } from "../entities/Entities";

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

  // Desglose real de un pago mixto. La suma debe cubrir el total.
  mixedCash: number;
  mixedCard: number;
  mixedTransfer: number;

  // Observaciones de la venta, enviadas como Sale.notes.
  notes: string;

  // Prioridad manual de la comanda, enviada como Sale.priority -> KitchenOrder.
  // Mismo campo y mismo default (NORMAL) que usa Mesas en TableDetailPanel.
  priority: OrderPriority;

  // Paso 7 — botón Cobrar inteligente: si el cajero marca que esta venta
  // necesita factura, el botón final cambia de "Cobrar" a "Pagar y
  // facturar". Por ahora es solo una señal de UI (no hay InvoiceEngine
  // todavía); cuando exista, este flag es lo que lo dispara.
  requiresInvoice: boolean;
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
  mixedCash: 0,
  mixedCard: 0,
  mixedTransfer: 0,
  notes: "",
  priority: "NORMAL",
  requiresInvoice: false
};

class PaymentStore extends ObservableStore<PaymentState> {
  private state: PaymentState = { ...INITIAL_STATE };

  constructor() {
    super({ ...INITIAL_STATE });
  }

  private sync() {
    this.publish({ ...this.state });
  }

  get() {
    return this.snapshot;
  }

  setMethod(method: PaymentMethod) {
    this.state.method = method;

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
    this.sync();
  }

  setMixedAmount(kind: "cash" | "card" | "transfer", value: number) {
    if (kind === "cash") this.state.mixedCash = value;
    if (kind === "card") this.state.mixedCard = value;
    if (kind === "transfer") this.state.mixedTransfer = value;
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

  reset() {
    this.state = { ...INITIAL_STATE };
    this.sync();
  }

  isPaid() {
    if (this.state.method === "mixed") {
      return this.getMixedReceived() >= this.state.total;
    }
    return this.state.paid;
  }
}

export const paymentStore = new PaymentStore();