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

     await PaymentSessionManager.create({
      provider: request.provider,
      currency: request.currency,
      amount: request.amount,
      businessId: request.businessId,
      metadata: { origin: "vimdy_payments", plan: request.plan, businessType: request.businessType }
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

  /** Reembolsa un pago, total o parcial. Delega en el proveedor correspondiente. */
  static async refundPayment(provider: PaymentProviderName, request: RefundRequest): Promise<RefundResult> {
    return PaymentFactory.create(provider).refundPayment(request);
  }

  /**
   * Solicita un reembolso para un pago externo (suscripción) de forma atómica
   * en servidor mediante la RPC `request_subscription_refund_atomic()`.
   * Garantiza idempotencia y validaciones server-side.
   */
  static async requestExternalRefund(params: {
    subscriptionPaymentId: string;
    amount?: number;
    idempotencyKey: string;
    reason: string;
    actorId: string;
  }): Promise<{ success: boolean; idempotent: boolean; refund: any }> {
    const { supabase } = await import("../../infrastructure/supabase/supabaseClient");
    const { data, error } = await supabase.rpc("request_subscription_refund_atomic", {
      p_subscription_payment_id: params.subscriptionPaymentId,
      p_amount: params.amount ?? null,
      p_idempotency_key: params.idempotencyKey,
      p_reason: params.reason,
      p_actor_id: params.actorId,
    });

    if (error) {
      throw new Error(`EXTERNAL_REFUND_REQUEST_FAILED: ${error.message}`);
    }

    const row = data?.[0];
    if (!row) {
      throw new Error("EXTERNAL_REFUND_REQUEST_FAILED: la RPC no devolvió resultado.");
    }

    return {
      success: row.success ?? true,
      idempotent: row.idempotent ?? false,
      refund: row.refund ?? null,
    };
  }

  /**
   * Confirma o rechaza un reembolso externo mediante la RPC
   * `settle_subscription_refund_atomic()`. Solo service_role puede llamarla.
   */
  static async settleExternalRefund(params: {
    refundId: string;
    status: "pending" | "confirmed" | "failed";
    providerReference?: string | null;
  }): Promise<{ success: boolean; idempotent: boolean; status: string }> {
    const { supabase } = await import("../../infrastructure/supabase/supabaseClient");
    const { data, error } = await supabase.rpc("settle_subscription_refund_atomic", {
      p_refund_id: params.refundId,
      p_status: params.status,
      p_provider_reference: params.providerReference ?? null,
    });

    if (error) {
      throw new Error(`EXTERNAL_REFUND_SETTLE_FAILED: ${error.message}`);
    }

    const row = data?.[0];
    if (!row) {
      throw new Error("EXTERNAL_REFUND_SETTLE_FAILED: la RPC no devolvió resultado.");
    }

    return {
      success: row.success ?? true,
      idempotent: row.idempotent ?? false,
      status: row.status ?? params.status,
    };
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