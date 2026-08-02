/**
 * VimdyPayments.ts
 * ---------------------------------------------------------------------------
 * ÚNICO punto de entrada público al motor de pagos de VIMDY.
 *
 * El resto de la aplicación (controllers, services, UI) SOLO debe importar
 * esta clase. Jamás debe importar WompiProvider, MercadoPagoProvider,
 * PayPalProvider, ni ningún archivo dentro de providers/. Para VIMDY, el
 * negocio "paga con VIMDY Payments" — nunca sabe qué pasa por debajo.
 *
 * Ejemplo de uso desde el resto de la app:
 *
 *   const result = await VimdyPayments.pay({
 *     country: "CO",
 *     businessType: "restaurante",
 *     plan: "pro",
 *     amount: 50000
 *   });
 *
 * VIMDY nunca sabrá (ni debe saber) que por debajo se usó Wompi.
 */

import { GlobalPaymentRouter } from "./GlobalPaymentRouter";
import { PaymentMethodResolver } from "./PaymentMethodResolver";
import { PaymentSessionManager } from "./PaymentSessionManager";
import { PaymentFactory } from "./PaymentFactory";
import type {
  PaymentResult,
  PaymentRoutingInput,
  RefundRequest,
  RefundResult
} from "./models/PaymentModels";
import type { CountryCode, PaymentMethodCode, PaymentProviderName } from "./types/payment.types";

export class VimdyPayments {
  /** Crea un pago. VIMDY Payments decide el proveedor internamente. */
  static async pay(input: PaymentRoutingInput): Promise<PaymentResult> {
    const { providerInstance, request } = GlobalPaymentRouter.route(input);

    PaymentSessionManager.create({
      provider: request.provider,
      country: request.country,
      currency: request.currency,
      amount: request.amount
    });

    return providerInstance.createPayment(request);
  }

  /** Consulta un pago existente. */
  static async getPayment(provider: PaymentProviderName, paymentId: string): Promise<PaymentResult> {
    return PaymentFactory.create(provider).getPayment(paymentId);
  }

  /** Cancela un pago. */
  static async cancelPayment(provider: PaymentProviderName, paymentId: string): Promise<PaymentResult> {
    return PaymentFactory.create(provider).cancelPayment(paymentId);
  }

  /** Reembolsa un pago, total o parcial. */
  static async refundPayment(provider: PaymentProviderName, request: RefundRequest): Promise<RefundResult> {
    return PaymentFactory.create(provider).refundPayment(request);
  }

  /**
   * Métodos de pago que se le deben mostrar al usuario, según país.
   * No pasa por GlobalPaymentRouter.route() a propósito: esa ruta exige
   * businessId (lo necesita para armar un PaymentRequest real), pero acá
   * solo queremos saber qué opciones mostrar en la UI, sin negocio
   * concreto todavía — se resuelve directo con el mismo resolver que usa
   * el Router internamente.
   */
  static getAvailableMethods(country: CountryCode): PaymentMethodCode[] {
    return PaymentMethodResolver.resolve(country);
  }
}