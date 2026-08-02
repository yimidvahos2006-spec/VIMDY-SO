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
  BR: "BRL",
  CL: "CLP",
  PE: "PEN",
  UY: "UYU",
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
  return (fnError as { message?: string })?.message ?? fallback;
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
    if (request.plan !== "monthly" && request.plan !== "yearly") {
      throw new Error(`MercadoPagoProvider: plan no facturable por Mercado Pago ("${request.plan}").`);
    }

    const { data, error } = await supabase.functions.invoke<MercadoPagoCheckoutFunctionResponse>(
      "mercadopago-checkout",
      { body: { businessId: request.businessId, plan: request.plan } }
    );

    if (error) {
      throw new Error(await extractFunctionErrorMessage(error, "No se pudo iniciar el pago con Mercado Pago."));
    }

    if (!data?.checkoutUrl || !data.reference) {
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
    // TODO: consultar el estado real del pago en Mercado Pago.
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
    // TODO: cancelar el pago en Mercado Pago.
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
    // TODO: reembolsar en Mercado Pago.
    return {
      id: generatePaymentId("mp_refund"),
      paymentId: request.paymentId,
      provider: this.name,
      status: "refunded",
      amount: request.amount ?? 0,
      createdAt: nowIso()
    };
  }

  getAvailableMethods(country: CountryCode): PaymentMethodCode[] {
    return MERCADOPAGO_METHODS_MAP[country] ?? DEFAULT_METHODS;
  }

  getCurrency(country: CountryCode): CurrencyCode {
    return MERCADOPAGO_CURRENCY_MAP[country] ?? "USD";
  }

  getStatus(providerStatus: string): PaymentStatus {
    const map: Record<string, PaymentStatus> = {
      pending: "pending",
      in_process: "pending",
      approved: "approved",
      authorized: "approved",
      rejected: "declined",
      cancelled: "cancelled",
      refunded: "refunded"
    };
    return map[providerStatus] ?? "error";
  }

  validateResponse(_payload: unknown, _signature?: string): boolean {
    // TODO: validar la firma x-signature de Mercado Pago cuando se conecten las llaves.
    return true;
  }
}