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

  verificationStatus: "CONFIRMED" | "PENDING_VERIFICATION" | "EXTERNAL_TERMINAL";

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

      date: new Date(),
      verificationStatus: "CONFIRMED"

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

      success: false,

      method: "CARD",

      total,

      received: total,

      change: 0,

      reference,

      message: "Pago con tarjeta pendiente de verificación del proveedor o datáfono.",

      date: new Date(),
      verificationStatus: "PENDING_VERIFICATION"

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

      success: false,

      method: "TRANSFER",

      total,

      received: total,

      change: 0,

      reference,

      message: "Transferencia registrada; queda pendiente de verificación del proveedor.",

      date: new Date(),
      verificationStatus: "PENDING_VERIFICATION"

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

      success: false,

      method: "QR",

      total,

      received: total,

      change: 0,

      reference,

      message: "Pago QR registrado; queda pendiente de verificación del proveedor.",

      date: new Date(),
      verificationStatus: "PENDING_VERIFICATION"

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

    const epsilon = 0.005;

    if (received < total - epsilon) {

      throw new Error("INSUFFICIENT_PAYMENT");

    }

    const needsReference =
      (payments.card ?? 0) > 0 ||
      (payments.transfer ?? 0) > 0 ||
      (payments.qr ?? 0) > 0;

    if (needsReference && !reference?.trim()) {
      throw new Error("PAYMENT_REFERENCE_REQUIRED");
    }

    const hasUnverifiedTender =
      (payments.card ?? 0) > 0 ||
      (payments.transfer ?? 0) > 0 ||
      (payments.qr ?? 0) > 0;

    return {

      success: false,

      method: "MIXED",

      total,

      received,

      change: this.calculateChange(total, received),

      reference,

      message: hasUnverifiedTender
        ? "Pago mixto pendiente de verificación server-side de la parte no en efectivo."
        : "El pago mixto requiere integración de verificación; usa efectivo o un método conectado.",

      date: new Date(),
      verificationStatus: "PENDING_VERIFICATION"

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

      success: false,

      method: "CASH",

      total: amount,

      received: 0,

      change: amount,

      message: "Reembolso no ejecutado: debe registrarse y confirmarse mediante el flujo persistente de caja.",

      date: new Date(),
      verificationStatus: "PENDING_VERIFICATION"

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

      success: false,

      method: "CASH",

      total: amount,

      received: 0,

      change: amount,

      message: "Reembolso parcial no ejecutado: debe registrarse y confirmarse mediante el flujo persistente de caja.",

      date: new Date(),
      verificationStatus: "PENDING_VERIFICATION"

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