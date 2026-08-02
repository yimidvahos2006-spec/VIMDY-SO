/**
 * PayPalProvider.ts
 * ---------------------------------------------------------------------------
 * Implementación de IPaymentProvider para PayPal. Es el proveedor por
 * defecto para "todo lo demás" (cualquier país sin regla explícita).
 *
 * createPayment ya llama de verdad a paypal-checkout (Edge Function) —
 * mismo patrón que WompiProvider/MercadoPagoProvider. getPayment /
 * cancelPayment / refundPayment siguen en TODO: no fueron pedidos en esta
 * fase (solo checkout + webhook).
 */

import { supabase } from "../../../../infrastructure/supabase/supabaseClient";
import type { IPaymentProvider } from "../../interfaces/IPaymentProvider";
import type {
  CountryCode,
  CurrencyCode,
  PaymentMethodCode,
  PaymentProviderName,
  PaymentStatus
} from "../../types/payment.types";
import type {
  PaymentRequest,
  PaymentResult,
  RefundRequest,
  RefundResult
} from "../../models/PaymentModels";
import { generatePaymentId, nowIso } from "../../utils/paymentUtils";

interface PayPalCheckoutFunctionResponse {
  ok: true;
  checkoutUrl: string;
  reference: string;
}

/** Igual que en WompiProvider/MercadoPagoProvider: mensaje detallado de un error de Edge Function. */
async function extractFunctionErrorMessage(fnError: unknown, fallback: string): Promise<string> {
  const context = (fnError as { context?: Response })?.context;
  if (context && typeof context.json === "function") {
    try {
      const body = await context.json();
      if (body?.error) return body.error as string;
    } catch {
      // El body no era JSON válido; nos quedamos con el mensaje genérico.
    }
  }
  return (fnError as { message?: string })?.message ?? fallback;
}

export class PayPalProvider implements IPaymentProvider {
  readonly name: PaymentProviderName = "paypal";

  /**
   * Crea la orden real en PayPal (Orders API v2). paypal-checkout es quien
   * decide el monto real y arma el link de aprobación; quien llame a
   * VimdyPayments.pay() (UpgradeModal.tsx) debe redirigir el navegador ahí.
   * El cobro de verdad (captura) ocurre después, en paypal-webhook, cuando
   * el comprador ya aprobó — nunca en este método.
   */
  async createPayment(request: PaymentRequest): Promise<PaymentResult> {
    if (request.plan !== "monthly" && request.plan !== "yearly") {
      throw new Error(`PayPalProvider: plan no facturable por PayPal ("${request.plan}").`);
    }

    const { data, error } = await supabase.functions.invoke<PayPalCheckoutFunctionResponse>(
      "paypal-checkout",
      { body: { businessId: request.businessId, plan: request.plan } }
    );

    if (error) {
      throw new Error(await extractFunctionErrorMessage(error, "No se pudo iniciar el pago con PayPal."));
    }

    if (!data?.checkoutUrl || !data.reference) {
      throw new Error("PayPalProvider: la Edge Function no devolvió una sesión de pago válida.");
    }

    return {
      id: request.id,
      provider: this.name,
      status: "pending",
      amount: request.amount,
      currency: request.currency,
      createdAt: nowIso(),
      checkoutUrl: data.checkoutUrl,
      reference: data.reference
    };
  }

  async getPayment(paymentId: string): Promise<PaymentResult> {
    // TODO: consultar el estado real del pago en PayPal.
    return {
      id: paymentId,
      provider: this.name,
      status: "pending",
      amount: 0,
      currency: "USD",
      createdAt: nowIso()
    };
  }

  async cancelPayment(paymentId: string): Promise<PaymentResult> {
    // TODO: cancelar el pago en PayPal.
    return {
      id: paymentId,
      provider: this.name,
      status: "cancelled",
      amount: 0,
      currency: "USD",
      createdAt: nowIso()
    };
  }

  async refundPayment(request: RefundRequest): Promise<RefundResult> {
    // TODO: reembolsar en PayPal.
    return {
      id: generatePaymentId("pp_refund"),
      paymentId: request.paymentId,
      provider: this.name,
      status: "refunded",
      amount: request.amount ?? 0,
      createdAt: nowIso()
    };
  }

  getAvailableMethods(_country: CountryCode): PaymentMethodCode[] {
    return ["paypal", "card"];
  }

  getCurrency(country: CountryCode): CurrencyCode {
    return country === "ES" ? "EUR" : "USD";
  }

  getStatus(providerStatus: string): PaymentStatus {
    const map: Record<string, PaymentStatus> = {
      CREATED: "pending",
      SAVED: "pending",
      APPROVED: "approved",
      COMPLETED: "approved",
      VOIDED: "cancelled",
      DECLINED: "declined"
    };
    return map[providerStatus] ?? "error";
  }

  validateResponse(_payload: unknown, _signature?: string): boolean {
    // TODO: validar la firma del webhook de PayPal (transmission-sig) cuando se conecten las llaves.
    return true;
  }
}