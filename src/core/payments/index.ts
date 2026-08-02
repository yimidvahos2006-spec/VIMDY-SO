/**
 * index.ts
 * ---------------------------------------------------------------------------
 * Puerta de entrada única de VIMDY Payments.
 *
 * El resto de VIMDY (controllers, services, UI) SOLO debe importar desde
 * acá. Nunca desde providers/, ni desde archivos internos sueltos.
 *
 * Uso desde cualquier otra parte de la app:
 *
 *   import { VimdyPayments } from "core/payments";
 *
 *   const result = await VimdyPayments.pay({
 *     country: "CO",
 *     businessType: "restaurante",
 *     plan: "pro",
 *     amount: 50000
 *   });
 *
 * Nota: WompiProvider, MercadoPagoProvider, PayPalProvider y todo lo que
 * hay dentro de providers/ NO se exporta acá a propósito. Nadie fuera de
 * payments/ debe poder importarlos, ni por accidente.
 */

// Punto de entrada público — lo único que el resto de VIMDY necesita en el día a día.
export { VimdyPayments } from "./VimdyPayments";

// Piezas internas del motor, por si algún día se necesitan directamente
// (por ejemplo, tests, u otro módulo interno de core/ que orqueste pagos).
export { GlobalPaymentRouter } from "./GlobalPaymentRouter";
export { PaymentFactory } from "./PaymentFactory";
export { PaymentCountryResolver } from "./PaymentCountryResolver";
export { PaymentCurrencyResolver } from "./PaymentCurrencyResolver";
export { PaymentMethodResolver } from "./PaymentMethodResolver";
export { PaymentStatusManager } from "./PaymentStatusManager";
export { PaymentSessionManager } from "./PaymentSessionManager";
export { PaymentWebhookManager } from "./PaymentWebhookManager";
export { PaymentValidator } from "./PaymentValidator";

// Tipos y modelos — útiles para tipar variables en otras partes de VIMDY.
export type {
  CountryCode,
  CurrencyCode,
  PaymentMethodCode,
  PaymentProviderName,
  PaymentStatus,
  BusinessType,
  PlanCode
} from "./types/payment.types";

export type {
  PaymentRoutingInput,
  PaymentRequest,
  PaymentResult,
  RefundRequest,
  RefundResult,
  PaymentSession,
  WebhookEvent
} from "./models/PaymentModels";

export type { IPaymentProvider } from "./interfaces/IPaymentProvider";