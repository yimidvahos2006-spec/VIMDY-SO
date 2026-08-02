/**
 * WompiProvider.ts
 * ---------------------------------------------------------------------------
 * Implementación de IPaymentProvider para Wompi (Colombia).
 * Nadie fuera de payments/ debe importar esta clase directamente: siempre
 * se accede a través de PaymentFactory / GlobalPaymentRouter / VimdyPayments.
 *
 * MISIÓN 3 — integración real con la API oficial de Wompi. Ninguna llave
 * privada vive aquí (este archivo corre en el navegador): las llaves
 * privadas (integridad, eventos) viven SOLO como secrets de las Edge
 * Functions. Este archivo únicamente:
 *   1) Le pide a wompi-create-checkout (Edge Function) que arme una sesión
 *      de pago real y devuelva la URL del Web Checkout de Wompi, ya
 *      firmada — nunca construye esa URL ni esa firma por su cuenta.
 *   2) Consulta el estado de una transacción directamente contra la API
 *      pública de Wompi (GET /v1/transactions/:id no requiere ninguna
 *      llave — es pública por diseño, ver docs.wompi.co).
 *   3) Para cancelar/reembolsar (operaciones que sí exigen la llave
 *      privada del comercio) delega en sus propias Edge Functions.
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

/** Clave pública de Wompi — segura de exponer en el navegador por diseño (igual que la anon key de Supabase). */
const WOMPI_PUBLIC_KEY = import.meta.env.VITE_WOMPI_PUBLIC_KEY as string | undefined;

/** Wompi resuelve sandbox/producción por el prefijo de la llave pública, nunca por una variable aparte que se pueda desincronizar. */
function resolveWompiApiBase(): string {
  const isSandbox = WOMPI_PUBLIC_KEY?.startsWith("pub_test_") ?? false;
  return isSandbox ? "https://sandbox.wompi.co/v1" : "https://production.wompi.co/v1";
}

/** Extrae el mensaje detallado de un error de Edge Function, igual que en subscriptionContext.ts -> activatePlan(). */
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

interface WompiCheckoutFunctionResponse {
  ok: true;
  checkoutUrl: string;
  reference: string;
}

interface WompiTransactionApiResponse {
  data: {
    id: string;
    status: string;
    amount_in_cents: number;
    currency: string;
    created_at: string;
    reference: string;
  };
}

export class WompiProvider implements IPaymentProvider {
  readonly name: PaymentProviderName = "wompi";

  /**
   * Crea la sesión de pago real. NUNCA cobra directamente ni construye la
   * URL de Wompi acá: eso exige la firma de integridad, que solo la Edge
   * Function wompi-create-checkout puede calcular (tiene el secret).
   * El resultado trae `checkoutUrl`: quien llame a VimdyPayments.pay()
   * (UpgradeModal.tsx) debe redirigir el navegador ahí para completar el
   * pago en el Web Checkout hospedado por Wompi.
   */
  async createPayment(request: PaymentRequest): Promise<PaymentResult> {
    if (request.plan !== "monthly" && request.plan !== "yearly") {
      throw new Error(`WompiProvider: plan no facturable por Wompi ("${request.plan}").`);
    }

    const { data, error } = await supabase.functions.invoke<WompiCheckoutFunctionResponse>(
      "wompi-create-checkout",
      { body: { businessId: request.businessId, plan: request.plan } }
    );

    if (error) {
      throw new Error(await extractFunctionErrorMessage(error, "No se pudo iniciar el pago con Wompi."));
    }

    if (!data?.checkoutUrl || !data.reference) {
      throw new Error("WompiProvider: la Edge Function no devolvió una sesión de pago válida.");
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
   * Consulta el estado REAL de una transacción en Wompi. Este endpoint
   * (GET /v1/transactions/:id) es público por diseño — no necesita llave
   * alguna — así que sí puede llamarse directo desde el navegador. Se usa,
   * por ejemplo, al volver del redirect-url del checkout para mostrarle al
   * usuario el resultado mientras el webhook confirma el plan por detrás.
   */
  async getPayment(paymentId: string): Promise<PaymentResult> {
    const response = await fetch(`${resolveWompiApiBase()}/transactions/${paymentId}`);

    if (!response.ok) {
      throw new Error(`WompiProvider: no se pudo consultar la transacción "${paymentId}" (HTTP ${response.status}).`);
    }

    const body = (await response.json()) as WompiTransactionApiResponse;
    const transaction = body.data;

    return {
      id: transaction.id,
      provider: this.name,
      status: this.getStatus(transaction.status),
      amount: transaction.amount_in_cents / 100,
      currency: transaction.currency as CurrencyCode,
      createdAt: transaction.created_at,
      reference: transaction.reference,
      raw: transaction
    };
  }

  /**
   * Anular una transacción exige la llave PRIVADA del comercio (POST
   * /v1/transactions/:id/void con Authorization: Bearer <private_key>),
   * así que jamás puede hacerse desde el navegador. Delega en su propia
   * Edge Function, igual que wompi-create-checkout.
   */
  async cancelPayment(paymentId: string): Promise<PaymentResult> {
    const { data, error } = await supabase.functions.invoke<{ ok: true; transaction: WompiTransactionApiResponse["data"] }>(
      "wompi-void-transaction",
      { body: { transactionId: paymentId } }
    );

    if (error) {
      throw new Error(await extractFunctionErrorMessage(error, "No se pudo anular el pago en Wompi."));
    }

    if (!data?.transaction) {
      throw new Error("WompiProvider: la Edge Function no devolvió la transacción anulada.");
    }

    const transaction = data.transaction;
    return {
      id: transaction.id,
      provider: this.name,
      status: this.getStatus(transaction.status),
      amount: transaction.amount_in_cents / 100,
      currency: transaction.currency as CurrencyCode,
      createdAt: transaction.created_at,
      reference: transaction.reference,
      raw: transaction
    };
  }

  /**
   * Wompi no tiene un endpoint de "reembolso" propio para transacciones ya
   * capturadas por PSE/tarjeta desde la API pública: los reembolsos de
   * comercio se gestionan con la llave privada. Se centraliza igual en una
   * Edge Function dedicada para no exponer esa llave.
   */
  async refundPayment(request: RefundRequest): Promise<RefundResult> {
    const { data, error } = await supabase.functions.invoke<{ ok: true; transaction: WompiTransactionApiResponse["data"] }>(
      "wompi-refund-transaction",
      { body: { transactionId: request.paymentId, amount: request.amount, reason: request.reason } }
    );

    if (error) {
      throw new Error(await extractFunctionErrorMessage(error, "No se pudo reembolsar el pago en Wompi."));
    }

    if (!data?.transaction) {
      throw new Error("WompiProvider: la Edge Function no devolvió la transacción reembolsada.");
    }

    const transaction = data.transaction;
    return {
      id: transaction.id,
      paymentId: request.paymentId,
      provider: this.name,
      status: this.getStatus(transaction.status),
      amount: transaction.amount_in_cents / 100,
      createdAt: transaction.created_at,
      raw: transaction
    };
  }

  getAvailableMethods(_country: CountryCode): PaymentMethodCode[] {
    return ["pse", "nequi", "card"];
  }

  getCurrency(_country: CountryCode): CurrencyCode {
    return "COP";
  }

  getStatus(providerStatus: string): PaymentStatus {
    const map: Record<string, PaymentStatus> = {
      PENDING: "pending",
      APPROVED: "approved",
      DECLINED: "declined",
      VOIDED: "cancelled",
      ERROR: "error"
    };
    return map[providerStatus] ?? "error";
  }

  /**
   * La validación real de un webhook de Wompi exige el "events secret"
   * (distinto de la llave de integridad), que tampoco puede vivir en el
   * navegador. Por diseño, este método SIEMPRE falla cerrado (devuelve
   * false) cuando corre en el cliente — la validación de verdad ocurre en
   * la Edge Function wompi-webhook, que tiene su propia copia de esta
   * lógica con el secret disponible como variable de entorno de servidor.
   * Se deja implementado (no como placeholder que confía a ciegas) para
   * que quede explícito que este archivo nunca es la fuente de verdad de
   * un webhook.
   */
  validateResponse(_payload: unknown, _signature?: string): boolean {
    return false;
  }
}