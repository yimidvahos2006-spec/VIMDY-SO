/**
 * IPaymentProvider.ts
 * ---------------------------------------------------------------------------
 * Contrato único que TODOS los proveedores (Wompi, Mercado Pago, PayPal, y
 * cualquier futuro proveedor) deben implementar EXACTAMENTE igual.
 * VIMDY Payments solo conoce esta interfaz — nunca el proveedor concreto.
 * Para VIMDY, todos los proveedores son iguales.
 */

import type {
  CountryCode,
  CurrencyCode,
  PaymentMethodCode,
  PaymentProviderName,
  PaymentStatus
} from "../types/payment.types";
import type {
  PaymentRequest,
  PaymentResult,
  RefundRequest,
  RefundResult
} from "../models/PaymentModels";

export interface IPaymentProvider {
  /** Nombre interno del proveedor. Solo lo usa el motor de pagos, nunca el resto de VIMDY. */
  readonly name: PaymentProviderName;

  /** Crea un pago. */
  createPayment(request: PaymentRequest): Promise<PaymentResult>;

  /** Consulta un pago. */
  getPayment(paymentId: string): Promise<PaymentResult>;

  /** Cancela un pago. */
  cancelPayment(paymentId: string): Promise<PaymentResult>;

  /** Reembolsa un pago. */
  refundPayment(request: RefundRequest): Promise<RefundResult>;

  /** Obtiene los métodos de pago disponibles para un país dado. */
  getAvailableMethods(country: CountryCode): PaymentMethodCode[];

  /** Obtiene la moneda que este proveedor usará para un país dado. */
  getCurrency(country: CountryCode): CurrencyCode;

  /** Obtiene el estado normalizado a partir del estado propio del proveedor. */
  getStatus(providerStatus: string): PaymentStatus;

  /** Valida que una respuesta / webhook realmente venga del proveedor. */
  validateResponse(payload: unknown, signature?: string): boolean;
}