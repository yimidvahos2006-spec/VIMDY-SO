/**
 * PaymentModels.ts
 * ---------------------------------------------------------------------------
 * Modelos de datos que viajan dentro de VIMDY Payments. Son agnósticos de
 * proveedor: el Router y los managers hablan siempre en estos términos,
 * nunca en los términos propios de Wompi / Mercado Pago / PayPal.
 */

import type {
  BusinessType,
  CountryCode,
  CurrencyCode,
  PaymentMethodCode,
  PaymentProviderName,
  PaymentStatus,
  PlanCode
} from "../types/payment.types";

/** Entrada que el resto de VIMDY le da al Router. Nada de proveedor aquí. */
export interface PaymentRoutingInput {
  /**
   * Negocio que está pagando. Obligatorio: los proveedores reales (Wompi,
   * y cualquier otro que llegue a llamar a un backend propio) necesitan
   * saber A QUIÉN activarle el plan cuando el pago se confirme — nunca se
   * infiere ni se adivina en el backend, siempre viaja explícito desde acá.
   */
  businessId: string;
  country: CountryCode;
  businessType: BusinessType;
  plan: PlanCode;
  amount: number;
  /** Opcional: si no se envía, se resuelve automáticamente a partir del país. */
  currency?: CurrencyCode;
  method?: PaymentMethodCode;
}

/** Solicitud de creación de pago ya enriquecida (país, moneda y proveedor resueltos). */
export interface PaymentRequest {
  id: string;
  provider: PaymentProviderName;
  businessId: string;
  country: CountryCode;
  currency: CurrencyCode;
  amount: number;
  method?: PaymentMethodCode;
  businessType: BusinessType;
  plan: PlanCode;
  metadata?: Record<string, unknown>;
}

/** Resultado normalizado de cualquier operación de pago, sin importar el proveedor. */
export interface PaymentResult {
  id: string;
  provider: PaymentProviderName;
  status: PaymentStatus;
  amount: number;
  currency: CurrencyCode;
  createdAt: string;
  /**
   * URL real a la que hay que redirigir al usuario para completar el pago
   * (ej. Web Checkout de Wompi). Los proveedores con checkout hospedado
   * NUNCA devuelven "approved" de inmediato — devuelven esto, y el estado
   * final llega después por webhook. Ausente en proveedores sin redirect.
   */
  checkoutUrl?: string;
  /** Referencia única que el proveedor usará para conciliar su webhook con este pago. */
  reference?: string;
  raw?: unknown;
}

/** Solicitud de reembolso, total o parcial. */
export interface RefundRequest {
  paymentId: string;
  amount?: number;
  reason?: string;
}

/** Resultado normalizado de un reembolso. */
export interface RefundResult {
  id: string;
  paymentId: string;
  provider: PaymentProviderName;
  status: PaymentStatus;
  amount: number;
  createdAt: string;
  raw?: unknown;
}

/** Sesión de pago que VIMDY mantiene mientras el usuario completa el checkout. */
export interface PaymentSession {
  id: string;
  provider: PaymentProviderName;
  country: CountryCode;
  currency: CurrencyCode;
  amount: number;
  status: PaymentStatus;
  createdAt: string;
  updatedAt: string;
}

/** Evento de webhook ya normalizado, listo para que el resto de VIMDY lo consuma. */
export interface WebhookEvent {
  provider: PaymentProviderName;
  paymentId: string;
  status: PaymentStatus;
  receivedAt: string;
  raw: unknown;
}