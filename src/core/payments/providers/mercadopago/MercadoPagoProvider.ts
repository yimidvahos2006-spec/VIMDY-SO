/**
 * MercadoPagoProvider.ts
 * ---------------------------------------------------------------------------
 * Adaptador cliente de Mercado Pago para VIMDY Payments.
 *
 * Las credenciales privadas y la creación de preferencias viven en la Edge
 * Function `mercadopago-checkout`. Este provider nunca contiene el Access
 * Token privado de Mercado Pago.
 *
 * Para tarjeta, MercadoPago.js puede generar un CardToken en el frontend,
 * pero el contrato actual de PaymentRequest no expone datos de tarjeta ni
 * token. El flujo activo de VIMDY es Checkout Pro hospedado, por lo que el
 * token de tarjeta, cuando aplique, se procesa dentro del checkout o en un
 * flujo específico de Checkout API futuro; no se inventa un campo nuevo en
 * PaymentRequest aquí.
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

const MERCADOPAGO_METHODS_MAP: Record<string, PaymentMethodCode[]> = {
  MX: ["mercadopago_wallet", "bank_transfer", "card"]
};

const DEFAULT_METHODS: PaymentMethodCode[] = [
  "mercadopago_wallet",
  "card"
];

const MERCADOPAGO_CURRENCY_MAP: Record<string, CurrencyCode> = {
  MX: "MXN",
  AR: "ARS",
  CL: "CLP",
  PE: "PEN",
  EC: "USD"
};

const SUPPORTED_COUNTRIES = new Set([
  "CO",
  "AR",
  "CL",
  "MX",
  "PE"
]);

interface MercadoPagoCheckoutFunctionResponse {
  ok: true;
  checkoutUrl: string;
  reference: string;
  existing?: boolean;
}

interface MercadoPagoPaymentApiResponse {
  id: number | string;
  status: string;
  transaction_amount?: number;
  currency_id?: string;
  date_created?: string;
  reference_id?: string;
  external_reference?: string;
  [key: string]: unknown;
}

interface MercadoPagoRefundApiResponse {
  id?: string | number;
  status?: string;
  amount?: number;
  currency_id?: string;
  [key: string]: unknown;
}

interface FunctionErrorContext {
  context?: Response;
  message?: string;
}

async function extractFunctionErrorMessage(
  fnError: unknown,
  fallback: string
): Promise<string> {
  const candidate = fnError as FunctionErrorContext | null;
  const context = candidate?.context;

  if (context && typeof context.json === "function") {
    try {
      const body = (await context.json()) as {
        error?: unknown;
        detail?: unknown;
      };

      if (typeof body.error === "string" && body.error.trim()) {
        return typeof body.detail === "string" && body.detail.trim()
          ? `${body.error}: ${body.detail}`
          : body.error;
      }
    } catch {
      // Se usa el mensaje del SDK si la respuesta no es JSON.
    }
  }

  if (typeof candidate?.message === "string" && candidate.message.trim()) {
    return candidate.message;
  }

  return fallback;
}

function assertHttpsUrl(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(
      "MERCADOPAGO_INVALID_RESPONSE: checkoutUrl es obligatorio."
    );
  }

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(
      "MERCADOPAGO_INVALID_RESPONSE: checkoutUrl no es una URL válida."
    );
  }

  if (url.protocol !== "https:") {
    throw new Error(
      "MERCADOPAGO_INVALID_RESPONSE: checkoutUrl debe usar HTTPS."
    );
  }

  return url.toString();
}

function validatePositiveAmount(
  value: number,
  field = "amount"
): void {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(
      `MERCADOPAGO_INVALID_${field.toUpperCase()}`
    );
  }
}

export class MercadoPagoProvider implements IPaymentProvider {
  readonly name: PaymentProviderName = "mercadopago";

  async createPayment(request: PaymentRequest): Promise<PaymentResult> {
    const country = request.country.trim().toUpperCase();

    if (!SUPPORTED_COUNTRIES.has(country)) {
      throw new Error(
        `MERCADOPAGO_COUNTRY_NOT_SUPPORTED: ${country}.`
      );
    }

    if (request.plan !== "monthly" && request.plan !== "yearly") {
      throw new Error(
        `MercadoPagoProvider: plan no facturable ("${request.plan}").`
      );
    }

    if (!request.businessId?.trim()) {
      throw new Error("MERCADOPAGO_BUSINESS_ID_REQUIRED");
    }

    validatePositiveAmount(request.amount);

    const expectedCurrency = this.getCurrency(country);
    if (request.currency !== expectedCurrency) {
      throw new Error(
        `MERCADOPAGO_CURRENCY_MISMATCH: para ${country} se esperaba ${expectedCurrency} y se recibió ${request.currency}.`
      );
    }

    if (
      request.method &&
      !this.getAvailableMethods(country).includes(request.method)
    ) {
      throw new Error(
        `MERCADOPAGO_METHOD_NOT_SUPPORTED: ${request.method}.`
      );
    }

    const { data, error } =
      await supabase.functions.invoke<MercadoPagoCheckoutFunctionResponse>(
        "mercadopago-checkout",
        {
          body: {
            businessId: request.businessId,
            plan: request.plan
          }
        }
      );

    if (error) {
      throw new Error(
        await extractFunctionErrorMessage(
          error,
          "No se pudo iniciar el pago con Mercado Pago."
        )
      );
    }

    if (!data?.checkoutUrl || !data.reference) {
      throw new Error(
        "MERCADOPAGO_INVALID_CHECKOUT_RESPONSE: faltan checkoutUrl o reference."
      );
    }

    const checkoutUrl = assertHttpsUrl(data.checkoutUrl);
    const reference = data.reference.trim();

    if (!reference) {
      throw new Error(
        "MERCADOPAGO_INVALID_REFERENCE"
      );
    }

    return {
      id: request.id,
      provider: this.name,
      status: "pending",
      amount: request.amount,
      currency: request.currency,
      createdAt: nowIso(),
      checkoutUrl,
      reference,
      raw: {
        existing: data.existing ?? false,
        method: request.method ?? null
      }
    };
  }

  async getPayment(paymentId: string): Promise<PaymentResult> {
    const normalizedPaymentId = paymentId?.trim();

    if (!normalizedPaymentId) {
      throw new Error("MERCADOPAGO_PAYMENT_ID_REQUIRED");
    }

    const { data, error } =
      await supabase.functions.invoke<{
        ok: true;
        payment: MercadoPagoPaymentApiResponse;
      }>("mercadopago-get-transaction", {
        body: { paymentId: normalizedPaymentId }
      });

    if (error) {
      throw new Error(
        await extractFunctionErrorMessage(
          error,
          "No se pudo consultar el pago en Mercado Pago."
        )
      );
    }

    if (!data?.payment) {
      throw new Error(
        "MERCADOPAGO_INVALID_PAYMENT_RESPONSE"
      );
    }

    return this.mapPayment(data.payment, normalizedPaymentId);
  }

  async cancelPayment(paymentId: string): Promise<PaymentResult> {
    const normalizedPaymentId = paymentId?.trim();

    if (!normalizedPaymentId) {
      throw new Error("MERCADOPAGO_PAYMENT_ID_REQUIRED");
    }

    const { data, error } =
      await supabase.functions.invoke<{
        ok: true;
        payment: MercadoPagoPaymentApiResponse;
      }>("mercadopago-cancel", {
        body: { paymentId: normalizedPaymentId }
      });

    if (error) {
      throw new Error(
        await extractFunctionErrorMessage(
          error,
          "No se pudo cancelar el pago en Mercado Pago."
        )
      );
    }

    if (!data?.payment) {
      throw new Error(
        "MERCADOPAGO_INVALID_CANCEL_RESPONSE"
      );
    }

    return this.mapPayment(data.payment, normalizedPaymentId);
  }

  async refundPayment(
    request: RefundRequest
  ): Promise<RefundResult> {
    const paymentId = request.paymentId?.trim();

    if (!paymentId) {
      throw new Error("MERCADOPAGO_PAYMENT_ID_REQUIRED");
    }

    if (
      request.amount !== undefined &&
      (!Number.isFinite(request.amount) || request.amount <= 0)
    ) {
      throw new Error(
        "MERCADOPAGO_REFUND_AMOUNT_INVALID"
      );
    }

    const { data, error } =
      await supabase.functions.invoke<{
        ok: true;
        refund: MercadoPagoRefundApiResponse;
      }>("mercadopago-refund", {
        body: {
          paymentId,
          amount: request.amount,
          reason: request.reason
        }
      });

    if (error) {
      throw new Error(
        await extractFunctionErrorMessage(
          error,
          "No se pudo reembolsar el pago en Mercado Pago."
        )
      );
    }

    if (!data?.refund) {
      throw new Error(
        "MERCADOPAGO_INVALID_REFUND_RESPONSE"
      );
    }

    const refund = data.refund;

    if (
      refund.amount !== undefined &&
      (!Number.isFinite(refund.amount) || refund.amount < 0)
    ) {
      throw new Error(
        "MERCADOPAGO_INVALID_REFUND_AMOUNT"
      );
    }

    return {
      id: refund.id?.toString() ?? generatePaymentId("mp_refund"),
      paymentId,
      provider: this.name,
      status: this.getRefundStatus(refund.status ?? "pending"),
      amount: refund.amount ?? request.amount ?? 0,
      createdAt: nowIso(),
      raw: refund
    };
  }

  getAvailableMethods(
    country: CountryCode
  ): PaymentMethodCode[] {
    const normalizedCountry = country.trim().toUpperCase();
    return [
      ...(MERCADOPAGO_METHODS_MAP[normalizedCountry] ??
        DEFAULT_METHODS)
    ];
  }

  getCurrency(country: CountryCode): CurrencyCode {
    const normalizedCountry = country.trim().toUpperCase();
    return MERCADOPAGO_CURRENCY_MAP[normalizedCountry] ?? "USD";
  }

  getStatus(providerStatus: string): PaymentStatus {
    const normalized = providerStatus?.trim().toLowerCase();

    const map: Record<string, PaymentStatus> = {
      pending: "pending",
      in_process: "pending",
      action_required: "pending",
      created: "pending",
      authorized: "approved",
      approved: "approved",
      processed: "approved",
      accredited: "approved",
      rejected: "declined",
      cancelled: "cancelled",
      canceled: "cancelled",
      expired: "expired",
      refunded: "refunded",
      charged_back: "refunded",
      error: "error"
    };

    return map[normalized] ?? "error";
  }

  private getRefundStatus(status: string): PaymentStatus {
    const normalized = status.trim().toLowerCase();

    if (["pending", "in_process"].includes(normalized)) {
      return "pending";
    }

    if (["approved", "processed", "completed", "refunded"].includes(normalized)) {
      return "refunded";
    }

    if (["cancelled", "canceled"].includes(normalized)) {
      return "cancelled";
    }

    if (["rejected", "failed", "error"].includes(normalized)) {
      return "error";
    }

    return "error";
  }

  private mapPayment(
    payment: MercadoPagoPaymentApiResponse,
    fallbackId: string
  ): PaymentResult {
    const id = payment.id?.toString() ?? fallbackId;
    const amount = Number(payment.transaction_amount ?? 0);

    if (!Number.isFinite(amount) || amount < 0) {
      throw new Error(
        "MERCADOPAGO_INVALID_PAYMENT_AMOUNT"
      );
    }

    const currency =
      (payment.currency_id as CurrencyCode | undefined) ??
      "USD";

    return {
      id,
      provider: this.name,
      status: this.getStatus(payment.status),
      amount,
      currency,
      createdAt: payment.date_created ?? nowIso(),
      reference:
        payment.reference_id ??
        payment.external_reference ??
        fallbackId,
      raw: payment
    };
  }

  /**
   * La firma x-signature de Mercado Pago se valida server-side con el
   * webhook secret. Este provider corre en el navegador y por diseño falla
   * cerrado.
   */
  validateResponse(_payload: unknown, _signature?: string): boolean {
    return false;
  }
}
