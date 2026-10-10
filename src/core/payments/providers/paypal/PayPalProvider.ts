/**
 * PayPalProvider.ts
 * ---------------------------------------------------------------------------
 * Adaptador cliente de PayPal para VIMDY Payments.
 *
 * Las credenciales OAuth y las llamadas REST protegidas viven en Supabase
 * Edge Functions. El navegador solo recibe checkoutUrl/reference y consulta
 * resultados a través de funciones server-side autorizadas.
 *
 * Flujo:
 *   createPayment -> paypal-checkout -> PayPal Orders v2 -> aprobación del
 *   comprador -> paypal-webhook -> capture -> activación de suscripción.
 *
 * PayPal-Request-Id y la verificación de webhooks se mantienen del lado
 * servidor, donde también viven PAYPAL_CLIENT_SECRET y PAYPAL_WEBHOOK_ID.
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

const SUPPORTED_COUNTRIES = new Set([
  "CO",
  "MX",
  "PE",
  "CL",
  "AR",
  "ES",
  "EC",
  "PA",
  "US",
  "VE"
]);

interface PayPalCheckoutFunctionResponse {
  ok: true;
  checkoutUrl: string;
  reference: string;
  orderId?: string;
  existing?: boolean;
}

interface PayPalOrderApiResponse {
  id: string;
  status: string;
  create_time?: string;
  purchase_units?: Array<{
    amount?: {
      currency_code?: string;
      value?: string;
    };
    payments?: {
      captures?: Array<{
        id?: string;
        status?: string;
        amount?: {
          currency_code?: string;
          value?: string;
        };
      }>;
    };
  }>;
}

interface PayPalRefundApiResponse {
  id?: string;
  status?: string;
  amount?: {
    currency_code?: string;
    value?: string;
  };
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
      // La respuesta de error puede no ser JSON.
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
      "PAYPAL_INVALID_RESPONSE: checkoutUrl es obligatorio."
    );
  }

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(
      "PAYPAL_INVALID_RESPONSE: checkoutUrl no es una URL válida."
    );
  }

  if (url.protocol !== "https:") {
    throw new Error(
      "PAYPAL_INVALID_RESPONSE: checkoutUrl debe usar HTTPS."
    );
  }

  return url.toString();
}

function assertPositiveAmount(
  value: number,
  field = "amount"
): void {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(
      `PAYPAL_INVALID_${field.toUpperCase()}`
    );
  }
}

function assertCurrency(value: string): CurrencyCode {
  if (
    value === "COP" ||
    value === "MXN" ||
    value === "ARS" ||
    value === "CLP" ||
    value === "PEN" ||
    value === "USD" ||
    value === "EUR"
  ) {
    return value;
  }

  throw new Error(
    `PAYPAL_INVALID_CURRENCY: ${value}`
  );
}

export class PayPalProvider implements IPaymentProvider {
  readonly name: PaymentProviderName = "paypal";

  async createPayment(request: PaymentRequest): Promise<PaymentResult> {
    const country = request.country.trim().toUpperCase();

    if (!SUPPORTED_COUNTRIES.has(country)) {
      throw new Error(
        `PAYPAL_COUNTRY_NOT_SUPPORTED: ${country}.`
      );
    }

    if (!request.businessId?.trim()) {
      throw new Error("PAYPAL_BUSINESS_ID_REQUIRED");
    }

    if (request.plan !== "monthly" && request.plan !== "yearly") {
      throw new Error(
        `PayPalProvider: plan no facturable por PayPal ("${request.plan}").`
      );
    }

    assertPositiveAmount(request.amount);

    const expectedCurrency = this.getCurrency(country);
    if (request.currency !== expectedCurrency) {
      throw new Error(
        `PAYPAL_CURRENCY_MISMATCH: para ${country} se esperaba ${expectedCurrency} y se recibió ${request.currency}.`
      );
    }

    if (
      request.method &&
      !this.getAvailableMethods(country).includes(request.method)
    ) {
      throw new Error(
        `PAYPAL_METHOD_NOT_SUPPORTED: ${request.method}.`
      );
    }

    const { data, error } =
      await supabase.functions.invoke<PayPalCheckoutFunctionResponse>(
        "paypal-checkout",
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
          "No se pudo iniciar el pago con PayPal."
        )
      );
    }

    if (!data?.checkoutUrl || !data.reference) {
      throw new Error(
        "PAYPAL_INVALID_CHECKOUT_RESPONSE: faltan checkoutUrl o reference."
      );
    }

    return {
      id: request.id,
      provider: this.name,
      status: "pending",
      amount: request.amount,
      currency: request.currency,
      createdAt: nowIso(),
      checkoutUrl: assertHttpsUrl(data.checkoutUrl),
      reference: data.reference.trim(),
      raw: {
        orderId: data.orderId ?? null,
        existing: data.existing ?? false,
        method: request.method ?? null
      }
    };
  }

  async getPayment(paymentId: string): Promise<PaymentResult> {
    const normalizedPaymentId = paymentId?.trim();

    if (!normalizedPaymentId) {
      throw new Error("PAYPAL_PAYMENT_ID_REQUIRED");
    }

    const { data, error } = await supabase.functions.invoke<{
      ok: true;
      order: PayPalOrderApiResponse;
    }>("paypal-get-order", {
      body: {
        orderId: normalizedPaymentId
      }
    });

    if (error) {
      throw new Error(
        await extractFunctionErrorMessage(
          error,
          "No se pudo consultar el pago en PayPal."
        )
      );
    }

    if (!data?.order?.id) {
      throw new Error(
        "PAYPAL_INVALID_ORDER_RESPONSE"
      );
    }

    const order = data.order;
    const capture =
      order.purchase_units?.[0]?.payments?.captures?.[0];
    const amountInfo =
      capture?.amount ??
      order.purchase_units?.[0]?.amount;

    const amount = amountInfo
      ? Number(amountInfo.value)
      : 0;

    if (!Number.isFinite(amount) || amount < 0) {
      throw new Error(
        "PAYPAL_INVALID_ORDER_AMOUNT"
      );
    }

    const currency = amountInfo?.currency_code
      ? assertCurrency(amountInfo.currency_code)
      : "USD";

    return {
      id: order.id,
      provider: this.name,
      status: this.getStatus(order.status),
      amount,
      currency,
      createdAt: order.create_time ?? nowIso(),
      reference: order.id,
      raw: order
    };
  }

  async cancelPayment(_paymentId: string): Promise<PaymentResult> {
    throw new Error(
      "PAYPAL_CANCEL_NOT_SUPPORTED: PayPal no ofrece una operación genérica de cancelación de una orden ya creada. Las órdenes no capturadas expiran; las capturadas se gestionan mediante refundPayment()."
    );
  }

  async refundPayment(
    request: RefundRequest
  ): Promise<RefundResult> {
    const paymentId = request.paymentId?.trim();

    if (!paymentId) {
      throw new Error("PAYPAL_PAYMENT_ID_REQUIRED");
    }

    if (
      request.amount !== undefined &&
      (!Number.isFinite(request.amount) || request.amount <= 0)
    ) {
      throw new Error("PAYPAL_REFUND_AMOUNT_INVALID");
    }

    const { data, error } = await supabase.functions.invoke<{
      ok: true;
      refund: PayPalRefundApiResponse;
    }>("paypal-refund-transaction", {
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
          "No se pudo reembolsar el pago en PayPal."
        )
      );
    }

    if (!data?.refund) {
      throw new Error(
        "PAYPAL_INVALID_REFUND_RESPONSE"
      );
    }

    const refund = data.refund;
    const amount = refund.amount?.value !== undefined
      ? Number(refund.amount.value)
      : request.amount ?? 0;

    if (!Number.isFinite(amount) || amount < 0) {
      throw new Error(
        "PAYPAL_INVALID_REFUND_AMOUNT"
      );
    }

    return {
      id: refund.id ?? generatePaymentId("pp_refund"),
      paymentId,
      provider: this.name,
      status: this.getRefundStatus(refund.status),
      amount,
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

    return map[country.trim().toUpperCase()] ?? "USD";
  }

  getStatus(providerStatus: string): PaymentStatus {
    const normalized = providerStatus?.trim().toUpperCase();

    const map: Record<string, PaymentStatus> = {
      CREATED: "pending",
      SAVED: "pending",
      APPROVED: "pending",
      PAYER_ACTION_REQUIRED: "pending",
      COMPLETED: "approved",
      VOIDED: "cancelled",
      DECLINED: "declined",
      FAILED: "error"
    };

    return map[normalized] ?? "error";
  }

  private getRefundStatus(
    providerStatus?: string
  ): PaymentStatus {
    const normalized = providerStatus?.trim().toUpperCase();

    if (normalized === "PENDING") {
      return "pending";
    }

    if (normalized === "COMPLETED") {
      return "refunded";
    }

    if (normalized === "CANCELLED" || normalized === "CANCELED") {
      return "cancelled";
    }

    if (normalized === "FAILED") {
      return "error";
    }

    return "error";
  }

  /**
   * La verificación auténtica de webhooks de PayPal exige los headers del
   * webhook, el webhook_id y la verificación server-side. No se puede hacer
   * de forma segura con un booleano local en el bundle del navegador.
   */
  validateResponse(_payload: unknown, _signature?: string): boolean {
    return false;
  }
}
