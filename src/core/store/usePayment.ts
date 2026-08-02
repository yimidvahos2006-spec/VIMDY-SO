import { useSyncExternalStore } from "react";
import { paymentStore, PaymentMethod, DiscountType, TipType } from "./paymentStore";
import { OrderPriority } from "../entities/Entities";

/**
 * Antes: sondeaba paymentStore cada 150ms con setInterval.
 * Ahora: se suscribe y solo re-renderiza cuando el pago realmente cambia.
 */
export function usePayment() {
  const state = useSyncExternalStore(paymentStore.subscribe, paymentStore.getSnapshot);

  const setMethod = (method: PaymentMethod) => {
    paymentStore.setMethod(method);
  };

  const receive = (value: number) => {
    paymentStore.receive(value);
  };

  const calculateChange = (total: number) => {
    paymentStore.calculateChange(total);
  };

  const setCustomer = (customerId: string, customerName: string) => {
    paymentStore.setCustomer(customerId, customerName);
  };

  const clearCustomer = () => {
    paymentStore.clearCustomer();
  };

  const setDiscount = (type: DiscountType | null, value: number, discountAmount: number) => {
    paymentStore.setDiscount(type, value, discountAmount);
  };

  // BLOQUEANTE (auditoría Fase 2 — rama Bar): ver paymentStore.setTip.
  const setTip = (type: TipType | null, value: number, tipAmount: number) => {
    paymentStore.setTip(type, value, tipAmount);
  };

  const setReference = (reference: string) => {
    paymentStore.setReference(reference);
  };

  const setMixedAmount = (kind: "cash" | "card" | "transfer", value: number) => {
    paymentStore.setMixedAmount(kind, value);
  };

  const setNotes = (notes: string) => {
    paymentStore.setNotes(notes);
  };

  const setPriority = (priority: OrderPriority) => {
    paymentStore.setPriority(priority);
  };

  const setRequiresInvoice = (value: boolean) => {
    paymentStore.setRequiresInvoice(value);
  };

  return {
    ...state,
    setMethod,
    receive,
    calculateChange,
    setCustomer,
    clearCustomer,
    setDiscount,
    setTip,
    setReference,
    setMixedAmount,
    setNotes,
    setPriority,
    setRequiresInvoice,
    mixedReceived: paymentStore.getMixedReceived(),
    isPaid: paymentStore.isPaid()
  };
}