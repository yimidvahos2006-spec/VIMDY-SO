import { Sale } from "../entities/Entities";

export type PaymentMethod =
  | "CASH"
  | "CARD"
  | "TRANSFER"
  | "QR"
  | "MIXED";

export interface PaymentResult {

  success: boolean;

  method: PaymentMethod;

  total: number;

  received: number;

  change: number;

  reference?: string;

  message: string;

  date: Date;

  invoiceError?: string;

}

export interface MixedPayment {

  cash?: number;

  card?: number;

  transfer?: number;

  qr?: number;

}

export class PaymentEngine {

  /**
   * Calcula el cambio.
   */
  public calculateChange(

    total: number,

    received: number

  ): number {

    return Math.max(

      received - total,

      0

    );

  }

  /**
   * Verifica si el pago es válido.
   */
  public validatePayment(

    total: number,

    received: number

  ): boolean {

    return received >= total;

  }

  /**
   * Pago en efectivo.
   */
  public payCash(

    total: number,

    received: number

  ): PaymentResult {

    if (!this.validatePayment(total, received)) {

      throw new Error("INSUFFICIENT_PAYMENT");

    }

    return {

      success: true,

      method: "CASH",

      total,

      received,

      change: this.calculateChange(total, received),

      message: "Pago en efectivo aprobado.",

      date: new Date()

    };

  }

  /**
   * Pago con tarjeta.
   */
  public payCard(

    total: number,

    reference: string

  ): PaymentResult {

    if (!reference.trim()) {
      throw new Error("PAYMENT_REFERENCE_REQUIRED");
    }

    return {

      success: true,

      method: "CARD",

      total,

      received: total,

      change: 0,

      reference,

      message: "Pago con tarjeta aprobado.",

      date: new Date()

    };

  }

  /**
   * Transferencia.
   */
  public payTransfer(

    total: number,

    reference: string

  ): PaymentResult {

    if (!reference.trim()) {
      throw new Error("PAYMENT_REFERENCE_REQUIRED");
    }

    return {

      success: true,

      method: "TRANSFER",

      total,

      received: total,

      change: 0,

      reference,

      message: "Transferencia confirmada.",

      date: new Date()

    };

  }

  /**
   * Pago QR.
   */
  public payQR(

    total: number,

    reference: string

  ): PaymentResult {

    if (!reference.trim()) {
      throw new Error("PAYMENT_REFERENCE_REQUIRED");
    }

    return {

      success: true,

      method: "QR",

      total,

      received: total,

      change: 0,

      reference,

      message: "Pago QR recibido.",

      date: new Date()

    };

  }

  /**
   * Pago mixto.
   */
  public payMixed(

    total: number,

    payments: MixedPayment,

    reference?: string

  ): PaymentResult {

    const received =

      (payments.cash ?? 0) +

      (payments.card ?? 0) +

      (payments.transfer ?? 0) +

      (payments.qr ?? 0);

    if (received < total) {

      throw new Error("INSUFFICIENT_PAYMENT");

    }

    const needsReference =
      (payments.card ?? 0) > 0 ||
      (payments.transfer ?? 0) > 0 ||
      (payments.qr ?? 0) > 0;

    if (needsReference && !reference?.trim()) {
      throw new Error("PAYMENT_REFERENCE_REQUIRED");
    }

    return {

      success: true,

      method: "MIXED",

      total,

      received,

      change: this.calculateChange(total, received),

      reference,

      message: "Pago mixto aprobado.",

      date: new Date()

    };

  }

  /**
   * Devuelve dinero.
   */
  public refund(

    sale: Sale,

    amount: number = sale.total

  ): PaymentResult {

    return {

      success: true,

      method: "CASH",

      total: amount,

      received: 0,

      change: amount,

      message: "Reembolso realizado correctamente.",

      date: new Date()

    };

  }

  /**
   * Igual que refund(), pero para un monto puntual en vez del total de
   * la venta — lo usa SalesEngine.partialRefundSale() para devolver
   * solo el valor proporcional de los ítems seleccionados, no la venta
   * completa.
   */
  public refundAmount(

    amount: number

  ): PaymentResult {

    return {

      success: true,

      method: "CASH",

      total: amount,

      received: 0,

      change: amount,

      message: "Reembolso parcial realizado correctamente.",

      date: new Date()

    };

  }

  /**
   * Cancela un pago.
   */
  public cancelPayment(

    reason: string

  ): string {

    return `Pago cancelado: ${reason}`;

  }

}