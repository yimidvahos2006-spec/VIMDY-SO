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

interface PayPalOrderApiResponse {
  id: string;
  status: string;
  create_time?: string;
  purchase_units?: {
    amount?: { currency_code?: string; value?: string };
    payments?: { captures?: { id?: string; amount?: { currency_code?: string; value?: string } }[] };
  }[];
}

interface PayPalRefundApiResponse {
  id?: string;
  status?: string;
  amount?: { currency_code?: string; value?: string };
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

  /**
   * Consulta el estado real de una orden en PayPal. A diferencia de Wompi
   * (que sí expone una API pública de consulta), PayPal exige un access
   * token OAuth que solo se puede sacar con el client secret — por eso esto
   * delega en paypal-get-order en vez de llamar a PayPal directo.
   */
  async getPayment(paymentId: string): Promise<PaymentResult> {
    const { data, error } = await supabase.functions.invoke<{ ok: true; order: PayPalOrderApiResponse }>(
      "paypal-get-order",
      { body: { orderId: paymentId } }
    );

    if (error) {
      throw new Error(await extractFunctionErrorMessage(error, "No se pudo consultar el pago en PayPal."));
    }
    if (!data?.order) {
      throw new Error("PayPalProvider: la Edge Function no devolvió la orden consultada.");
    }

    const order = data.order;
    const capture = order.purchase_units?.[0]?.payments?.captures?.[0];
    const amountInfo = capture?.amount ?? order.purchase_units?.[0]?.amount;

    return {
      id: order.id,
      provider: this.name,
      status: this.getStatus(order.status),
      amount: amountInfo ? Number(amountInfo.value) : 0,
      currency: (amountInfo?.currency_code as CurrencyCode) ?? "USD",
      createdAt: order.create_time ?? nowIso(),
      reference: order.id,
      raw: order
    };
  }

  /**
   * PayPal, a diferencia de Wompi, NO tiene un endpoint de "anular/cancelar"
   * una orden ya creada — la Orders API v2 no lo ofrece: una orden que nunca
   * se captura simplemente expira sola del lado de PayPal a las pocas horas.
   * Por eso este método NO finge cancelar algo en PayPal (eso sería
   * mostrarle al dueño del negocio un "cancelado" que en realidad nunca
   * ocurrió del lado de PayPal). En vez de eso:
   *   - Si el pago sigue 'pending' (nunca se capturó), no hay nada que
   *     cancelar en PayPal: se lanza un error explicando que solo hace
   *     falta esperar a que expire, o usar refundPayment si ya se capturó.
   *   - Si ya se capturó (approved), lo correcto es reembolsar, no
   *     "cancelar" — se lanza un error dirigiendo a refundPayment().
   */
  async cancelPayment(_paymentId: string): Promise<PaymentResult> {
    throw new Error(
      "PayPalProvider: PayPal no ofrece una API para cancelar una orden. " +
        "Si el pago aún no se capturó, no hace falta hacer nada (expira solo). " +
        "Si ya se capturó, usa refundPayment() para devolver el dinero."
    );
  }

  /**
   * Reembolsa un pago YA capturado (POST /v2/payments/captures/:id/refund).
   * Exige el client secret, así que delega en paypal-refund-transaction.
   */
  async refundPayment(request: RefundRequest): Promise<RefundResult> {
    const { data, error } = await supabase.functions.invoke<{ ok: true; refund: PayPalRefundApiResponse }>(
      "paypal-refund-transaction",
      { body: { paymentId: request.paymentId, amount: request.amount, reason: request.reason } }
    );

    if (error) {
      throw new Error(await extractFunctionErrorMessage(error, "No se pudo reembolsar el pago en PayPal."));
    }
    if (!data?.refund) {
      throw new Error("PayPalProvider: la Edge Function no devolvió el reembolso.");
    }

    // OJO: no se reutiliza getStatus() acá a propósito — esa tabla mapea
    // estados de ORDEN (donde "COMPLETED" significa "ya se cobró"), pero
    // un reembolso tiene su propio vocabulario de estados donde
    // "COMPLETED" significa "ya se devolvió el dinero". Mezclarlos haría
    // que un reembolso completado se reportara como "approved" en vez de
    // "refunded".
    const refund = data.refund;
    const refundStatus: PaymentStatus = refund.status === "PENDING" ? "pending" : "refunded";

    return {
      id: refund.id ?? generatePaymentId("pp_refund"),
      paymentId: request.paymentId,
      provider: this.name,
      status: refundStatus,
      amount: refund.amount ? Number(refund.amount.value) : request.amount ?? 0,
      createdAt: nowIso(),
      raw: refund
    };
  }

  getAvailableMethods(_country: CountryCode): PaymentMethodCode[] {
    return ["paypal", "card"];
  }

  getCurrency(country: CountryCode): CurrencyCode {
    const map: Record<string, CurrencyCode> = {
      AR: "ARS",
      CL: "CLP",
      CO: "COP",
      EC: "USD",
      ES: "EUR",
      MX: "MXN",
      PA: "USD",
      PE: "PEN",
      US: "USD",
      VE: "USD"
    };
    return map[country] ?? "USD";
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

  /**
   * Valida la firma del webhook de PayPal.
   * Por seguridad y diseño, la verificación asíncrona de firmas (que requiere consultar
   * la API oficial de PayPal /v1/notifications/verify-webhook-signature) se ejecuta
   * en la Edge Function (paypal-webhook). Este método en el cliente retorna false por
   * defecto (fail closed) para evitar el procesamiento de eventos no autorizados.
   */
  validateResponse(_payload: unknown, _signature?: string): boolean {
    return false;
  }
}