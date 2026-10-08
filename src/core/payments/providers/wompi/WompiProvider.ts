/**
 * WompiProvider.ts
 * ---------------------------------------------------------------------------
 * Adaptador cliente de Wompi para VIMDY Payments.
 *
 * Este archivo NO contiene secretos de Wompi. La llave privada, el secret de
 * integridad y la validación de webhooks viven exclusivamente en Supabase
 * Edge Functions.
 *
 * Flujo de suscripción VIMDY:
 *   WompiProvider.createPayment()
 *      -> wompi-create-checkout
 *      -> firma de integridad server-side
 *      -> Wompi Web Checkout
 *      -> wompi-webhook
 *
 * Flujo POS externo Wompi:
 *   wompi-create-pos-checkout
 *      -> create_wompi_sale_payment_session_atomic
 *      -> Wompi Web Checkout
 *      -> wompi-pos-webhook
 *
 * Los tokens de tarjeta, PSE y Nequi no se reciben aquí porque el contrato
 * actual de PaymentRequest no expone datos sensibles ni un card token. En el
 * flujo hospedado, Wompi recoge esos datos dentro de su checkout. No se debe
 * implementar tokenización de tarjeta en este archivo con una llave privada.
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
import { nowIso } from "../../utils/paymentUtils";

interface WompiCheckoutFunctionResponse {
  ok: true;
  checkoutUrl: string;
  reference: string;
  existing?: boolean;
}

interface WompiTransactionApiResponse {
  id: string;
  status: string;
  amount_in_cents: number;
  currency: string;
  created_at: string;
  reference: string;
}

interface WompiTransactionFunctionResponse {
  ok: true;
  transaction: WompiTransactionApiResponse;
}

interface FunctionErrorContext {
  context?: Response;
  message?: string;
}

const WOMPI_COUNTRY = "CO";
const WOMPI_CURRENCY: CurrencyCode = "COP";
const WOMPI_METHODS: PaymentMethodCode[] = ["pse", "nequi", "card"];
const MAX_MONEY_DELTA = 0.005;

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
        return body.detail && typeof body.detail === "string"
          ? `${body.error}: ${body.detail}`
          : body.error;
      }
    } catch {
      // La respuesta de error puede no ser JSON. Se usa el fallback.
    }
  }

  if (typeof candidate?.message === "string" && candidate.message.trim()) {
    return candidate.message;
  }

  return fallback;
}

function assertHttpsUrl(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`WOMPI_INVALID_RESPONSE: ${field} es obligatorio.`);
  }

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`WOMPI_INVALID_RESPONSE: ${field} no es una URL válida.`);
  }

  if (url.protocol !== "https:") {
    throw new Error(`WOMPI_INVALID_RESPONSE: ${field} debe usar HTTPS.`);
  }

  return url.toString();
}

function assertPositiveMoney(value: number, field: string): void {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`WOMPI_INVALID_${field.toUpperCase()}: monto inválido.`);
  }
}

export class WompiProvider implements IPaymentProvider {
  readonly name: PaymentProviderName = "wompi";

  async createPayment(request: PaymentRequest): Promise<PaymentResult> {
    if (!request.businessId?.trim()) {
      throw new Error("WOMPI_BUSINESS_ID_REQUIRED");
    }

    if (request.country.toUpperCase() !== WOMPI_COUNTRY) {
      throw new Error(
        "WOMPI_COUNTRY_NOT_SUPPORTED: Wompi en VIMDY está habilitado para Colombia."
      );
    }

    if (request.currency !== WOMPI_CURRENCY) {
      throw new Error(
        `WOMPI_CURRENCY_NOT_SUPPORTED: se esperaba ${WOMPI_CURRENCY}, se recibió ${request.currency}.`
      );
    }

    if (request.plan !== "monthly" && request.plan !== "yearly") {
      throw new Error(
        `WompiProvider: plan no facturable por Wompi ("${request.plan}").`
      );
    }

    assertPositiveMoney(request.amount, "amount");

    if (request.method && !WOMPI_METHODS.includes(request.method)) {
      throw new Error(
        `WOMPI_METHOD_NOT_SUPPORTED: ${request.method}.`
      );
    }

    const { data, error } = await supabase.functions.invoke<WompiCheckoutFunctionResponse>(
      "wompi-create-checkout",
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
          "No se pudo iniciar el pago con Wompi."
        )
      );
    }

    if (!data?.checkoutUrl || !data.reference) {
      throw new Error(
        "WOMPI_INVALID_CHECKOUT_RESPONSE: la Edge Function no devolvió checkoutUrl y reference válidos."
      );
    }

    const checkoutUrl = assertHttpsUrl(
      data.checkoutUrl,
      "checkoutUrl"
    );

    const reference = data.reference.trim();
    if (!reference) {
      throw new Error("WOMPI_INVALID_REFERENCE");
    }

    return {
      id: request.id,
      provider: this.name,
      status: "pending",
      amount: request.amount,
      currency: WOMPI_CURRENCY,
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
      throw new Error("WOMPI_PAYMENT_ID_REQUIRED");
    }

    const { data, error } = await supabase.functions.invoke<WompiTransactionFunctionResponse>(
      "wompi-get-transaction",
      {
        body: {
          transactionId: normalizedPaymentId
        }
      }
    );

    if (error) {
      throw new Error(
        await extractFunctionErrorMessage(
          error,
          `No se pudo consultar la transacción ${normalizedPaymentId} en Wompi.`
        )
      );
    }

    if (!data?.transaction) {
      throw new Error(
        `WOMPI_INVALID_TRANSACTION_RESPONSE: no se recibió la transacción ${normalizedPaymentId}.`
      );
    }

    const transaction = data.transaction;

    if (!transaction.id || !transaction.reference) {
      throw new Error("WOMPI_INVALID_TRANSACTION_RESPONSE: faltan id o reference.");
    }

    if (!Number.isFinite(transaction.amount_in_cents) || transaction.amount_in_cents < 0) {
      throw new Error("WOMPI_INVALID_TRANSACTION_RESPONSE: amount_in_cents inválido.");
    }

    if (transaction.currency !== WOMPI_CURRENCY) {
      throw new Error(
        `WOMPI_CURRENCY_MISMATCH: Wompi devolvió ${transaction.currency}.`
      );
    }

    return {
      id: transaction.id,
      provider: this.name,
      status: this.getStatus(transaction.status),
      amount: transaction.amount_in_cents / 100,
      currency: WOMPI_CURRENCY,
      createdAt: transaction.created_at || nowIso(),
      reference: transaction.reference,
      raw: transaction
    };
  }

  async cancelPayment(paymentId: string): Promise<PaymentResult> {
    const normalizedPaymentId = paymentId?.trim();

    if (!normalizedPaymentId) {
      throw new Error("WOMPI_PAYMENT_ID_REQUIRED");
    }

    const { data, error } = await supabase.functions.invoke<WompiTransactionFunctionResponse>(
      "wompi-void-transaction",
      {
        body: {
          transactionId: normalizedPaymentId
        }
      }
    );

    if (error) {
      throw new Error(
        await extractFunctionErrorMessage(
          error,
          "No se pudo anular el pago en Wompi."
        )
      );
    }

    if (!data?.transaction) {
      throw new Error(
        "WOMPI_INVALID_VOID_RESPONSE: la Edge Function no devolvió la transacción anulada."
      );
    }

    return this.mapTransaction(data.transaction);
  }

  async refundPayment(request: RefundRequest): Promise<RefundResult> {
    const paymentId = request.paymentId?.trim();

    if (!paymentId) {
      throw new Error("WOMPI_PAYMENT_ID_REQUIRED");
    }

    if (
      request.amount !== undefined &&
      (!Number.isFinite(request.amount) || request.amount <= 0)
    ) {
      throw new Error("WOMPI_REFUND_AMOUNT_INVALID");
    }

    const { data, error } = await supabase.functions.invoke<WompiTransactionFunctionResponse>(
      "wompi-refund-transaction",
      {
        body: {
          transactionId: paymentId,
          amount: request.amount,
          reason: request.reason
        }
      }
    );

    if (error) {
      throw new Error(
        await extractFunctionErrorMessage(
          error,
          "No se pudo reembolsar el pago en Wompi."
        )
      );
    }

    if (!data?.transaction) {
      throw new Error(
        "WOMPI_INVALID_REFUND_RESPONSE: la Edge Function no devolvió la transacción reembolsada."
      );
    }

    const transaction = data.transaction;

    return {
      id: transaction.id,
      paymentId,
      provider: this.name,
      status: this.getRefundStatus(transaction.status),
      amount: transaction.amount_in_cents / 100,
      createdAt: transaction.created_at || nowIso(),
      raw: transaction
    };
  }

  getAvailableMethods(_country: CountryCode): PaymentMethodCode[] {
    return [...WOMPI_METHODS];
  }

  getCurrency(_country: CountryCode): CurrencyCode {
    return WOMPI_CURRENCY;
  }

  getStatus(providerStatus: string): PaymentStatus {
    const normalized = providerStatus?.trim().toUpperCase();

    const map: Record<string, PaymentStatus> = {
      PENDING: "pending",
      APPROVED: "approved",
      DECLINED: "declined",
      VOIDED: "cancelled",
      ERROR: "error",
      FAILED: "error"
    };

    return map[normalized] ?? "error";
  }

  private getRefundStatus(providerStatus: string): PaymentStatus {
    const normalized = providerStatus?.trim().toUpperCase();

    if (normalized === "PENDING") return "pending";
    if (normalized === "APPROVED") return "refunded";
    if (normalized === "VOIDED") return "cancelled";
    if (normalized === "DECLINED") return "declined";

    return "error";
  }

  private mapTransaction(
    transaction: WompiTransactionApiResponse
  ): PaymentResult {
    if (!transaction?.id) {
      throw new Error("WOMPI_INVALID_TRANSACTION_RESPONSE");
    }

    if (
      !Number.isFinite(transaction.amount_in_cents) ||
      transaction.amount_in_cents < 0
    ) {
      throw new Error("WOMPI_INVALID_TRANSACTION_AMOUNT");
    }

    if (transaction.currency !== WOMPI_CURRENCY) {
      throw new Error("WOMPI_CURRENCY_MISMATCH");
    }

    return {
      id: transaction.id,
      provider: this.name,
      status: this.getStatus(transaction.status),
      amount: transaction.amount_in_cents / 100,
      currency: WOMPI_CURRENCY,
      createdAt: transaction.created_at || nowIso(),
      reference: transaction.reference,
      raw: transaction
    };
  }

  /**
   * Webhooks reales se validan server-side con WOMPI_EVENTS_SECRET.
   * El navegador no posee ese secreto y por eso este método falla cerrado.
   */
  validateResponse(_payload: unknown, _signature?: string): boolean {
    return false;
  }
}
