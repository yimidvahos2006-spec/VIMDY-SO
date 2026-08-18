/**
 * MercadoPagoProvider.ts
 * ---------------------------------------------------------------------------
 * Implementación de IPaymentProvider para Mercado Pago (AR, BR, CL, PE, UY,
 * EC, MX). Nadie fuera de payments/ debe importar esta clase directamente.
 *
 * createPayment ya llama de verdad a mercadopago-checkout (Edge Function) —
 * mismo patrón que WompiProvider: ninguna llave privada vive acá, este
 * archivo corre en el navegador. getPayment/cancelPayment/refundPayment
 * siguen en TODO: no fueron pedidos en esta fase (solo checkout + webhook).
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

/** Mercado Pago opera en varios países, cada uno con su propia moneda. */
const MERCADOPAGO_CURRENCY_MAP: Record<string, CurrencyCode> = {
  MX: "MXN",
  AR: "ARS",
  CL: "CLP",
  PE: "PEN",
  EC: "USD"
};

/** México tiene transferencia bancaria además de wallet y tarjeta. */
const MERCADOPAGO_METHODS_MAP: Record<string, PaymentMethodCode[]> = {
  MX: ["mercadopago_wallet", "bank_transfer", "card"]
};

const DEFAULT_METHODS: PaymentMethodCode[] = ["mercadopago_wallet", "card"];

interface MercadoPagoCheckoutFunctionResponse {
  ok: true;
  checkoutUrl: string;
  reference: string;
}

/** Igual que en WompiProvider: extrae el mensaje detallado de un error de Edge Function. */
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
  return (fnError as { message?: string })?.message?? fallback;
}

export class MercadoPagoProvider implements IPaymentProvider {
  readonly name: PaymentProviderName = "mercadopago";

  /**
   * Crea la preferencia real de Mercado Pago. mercadopago-checkout es quien
   * decide el monto real (a partir del país/moneda guardados en Supabase, no
   * de lo que mande el navegador) y arma la URL del Checkout Pro. Quien
   * llame a VimdyPayments.pay() (UpgradeModal.tsx) debe redirigir el
   * navegador a `checkoutUrl` para completar el pago.
   */
  async createPayment(request: PaymentRequest): Promise<PaymentResult> {
    if (request.plan!== "monthly" && request.plan!== "yearly") {
      throw new Error(`MercadoPagoProvider: plan no facturable por Mercado Pago ("${request.plan}").`);
    }

    const { data, error } = await supabase.functions.invoke<MercadoPagoCheckoutFunctionResponse>(
      "mercadopago-checkout",
      { body: { businessId: request.businessId, plan: request.plan } }
    );

    if (error) {
      throw new Error(await extractFunctionErrorMessage(error, "No se pudo iniciar el pago con Mercado Pago."));
    }

    if (!data?.checkoutUrl ||!data.reference) {
      throw new Error("MercadoPagoProvider: la Edge Function no devolvió una sesión de pago válida.");
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
    const { data, error } = await supabase.functions.invoke<{ ok: true; payment: any }>(
      "mercadopago-get-transaction",
      { body: { paymentId } }
    );

    if (error) {
      throw new Error(await extractFunctionErrorMessage(error, "No se pudo consultar el pago en Mercado Pago."));
    }
    if (!data?.payment) {
      throw new Error("MercadoPagoProvider: la Edge Function no devolvió el pago consultado.");
    }

    const payment = data.payment;
    return {
      id: payment.id ?? paymentId,
      provider: this.name,
      status: this.getStatus(payment.status),
      amount: Number(payment.transaction_amount ?? 0),
      currency: (payment.currency_id as CurrencyCode) ?? "USD",
      createdAt: payment.date_created ?? nowIso(),
      reference: payment.reference_id ?? paymentId,
      raw: payment
    };
  }

  async cancelPayment(paymentId: string): Promise<PaymentResult> {
    const { data, error } = await supabase.functions.invoke<{ ok: true; payment: any }>(
      "mercadopago-cancel",
      { body: { paymentId } }
    );

    if (error) {
      throw new Error(await extractFunctionErrorMessage(error, "No se pudo cancelar el pago en Mercado Pago."));
    }
    if (!data?.payment) {
      throw new Error("MercadoPagoProvider: la Edge Function no devolvió la cancelación.");
    }

    const payment = data.payment;
    return {
      id: payment.id ?? paymentId,
      provider: this.name,
      status: this.getStatus(payment.status),
      amount: Number(payment.transaction_amount ?? 0),
      currency: (payment.currency_id as CurrencyCode) ?? "USD",
      createdAt: payment.date_created ?? nowIso(),
      reference: payment.reference_id ?? paymentId,
      raw: payment
    };
  }

  async refundPayment(request: RefundRequest): Promise<RefundResult> {
    const { data, error } = await supabase.functions.invoke<{ ok: true; refund: { id?: string; status?: string; amount?: number; source?: any } }>(
      "mercadopago-refund",
      { body: { paymentId: request.paymentId, amount: request.amount, reason: request.reason } }
    );

    if (error) {
      throw new Error(await extractFunctionErrorMessage(error, "No se pudo reembolsar el pago en Mercado Pago."));
    }
    if (!data?.refund) {
      throw new Error("MercadoPagoProvider: la Edge Function no devolvió el reembolso.");
    }

    const refund = data.refund;
    const refundStatus = this.getStatus(refund.status ?? "pending");

    return {
      id: refund.id ?? generatePaymentId("mp_refund"),
      paymentId: request.paymentId,
      provider: this.name,
      status: refundStatus,
      amount: refund.amount ?? request.amount ?? 0,
      createdAt: nowIso(),
      raw: refund
    };
  }

  getAvailableMethods(country: CountryCode): PaymentMethodCode[] {
    return MERCADOPAGO_METHODS_MAP[country]?? DEFAULT_METHODS;
  }

  getCurrency(country: CountryCode): CurrencyCode {
    return MERCADOPAGO_CURRENCY_MAP[country]?? "USD";
  }

  getStatus(providerStatus: string): PaymentStatus {
    const map: Record<string, PaymentStatus> = {
      pending: "pending",
      in_process: "pending",
      approved: "approved",
      authorized: "approved",
      completed: "approved",
      rejected: "declined",
      cancelled: "cancelled",
      refunded: "refunded"
    };
    return map[providerStatus]?? "error";
  }

  /**
   * Valida la firma del webhook de Mercado Pago (x-signature).
   * Por seguridad, en el navegador donde no hay claves secretas, este método
   * devuelve false. En entornos con acceso al secret (como tests o servidor),
   * realiza la verificación HMAC-SHA256 según la especificación oficial.
   */
  validateResponse(payload: unknown, signature?: string): boolean {
    if (!signature) return false;

    const secret = typeof import.meta !== "undefined" ? import.meta.env.MERCADOPAGO_WEBHOOK_SECRET : undefined;

    if (!secret) {
      return false;
    }

    try {
      const parts = Object.fromEntries(
        signature.split(",").map((part) => {
          const [key, value] = part.split("=");
          return [key?.trim(), value?.trim()];
        })
      );
      const ts = parts["ts"];
      const v1 = parts["v1"];
      if (!ts || !v1) return false;

      const typedPayload = payload as { id?: string; requestId?: string; dataId?: string; "request-id"?: string };
      const dataId = typedPayload.dataId || typedPayload.id || "";
      const requestId = typedPayload.requestId || typedPayload["request-id"] || "";

      if (!dataId || !requestId) return false;

      const manifest = `id:${dataId.toLowerCase()};request-id:${requestId};ts:${ts};`;

      if (typeof require !== "undefined" || (typeof process !== "undefined" && process.versions && process.versions.node)) {
        const crypto = require("crypto");
        const expected = crypto.createHmac("sha256", secret).update(manifest).digest("hex");
        if (expected !== v1) {
          throw new Error("Invalid signature");
        }
        return true;
      }

      return false;
    } catch {
      return false;
    }
  }
}