import { supabase } from "../../infrastructure/supabase/supabaseClient";
import { PaymentSessionManager } from "../payments/PaymentSessionManager";

/**
 * tableWompiCheckout
 * ---------------------------------------------------------------------------
 * Cobro digital de una MESA con Wompi (tarjeta, transferencia, QR).
 *
 * Reutiliza la misma infraestructura que ya existe en el servidor para el POS:
 *
 *   1. La venta de la mesa se crea como PENDING_PAYMENT (TableEngine).
 *   2. Edge Function `wompi-create-pos-checkout` crea la sesión de pago
 *      (RPC create_wompi_sale_payment_session_atomic) y devuelve la URL firmada
 *      del Web Checkout de Wompi. El monto sale de la venta en la base de
 *      datos, nunca de este archivo.
 *   3. El cliente paga en Wompi. El webhook `wompi-pos-webhook` valida la firma
 *      y llama finalize_wompi_sale_payment_atomic, que registra el pago, pasa
 *      la venta a PAID y el trigger de mesas la libera.
 *   4. Este módulo solo CONSULTA el estado de la sesión. Nunca marca nada como
 *      cobrado desde el navegador.
 */

export type TableDigitalMethod = "CARD" | "TRANSFER" | "QR";

export type TableWompiState =
  | "pending"
  | "approved"
  | "declined"
  | "cancelled"
  | "expired"
  | "error";

export interface TableWompiCheckout {
  readonly sessionId: string;
  readonly checkoutUrl: string;
  readonly amount: number;
  /** Número de intento con el que quedó creada la sesión (para reintentos). */
  readonly attempt: number;
}

interface CheckoutFunctionResponse {
  ok?: boolean;
  sessionId?: string;
  checkoutUrl?: string;
  reference?: string;
  amount?: number;
  externalAmount?: number;
  error?: string;
  detail?: string;
}

const MAX_MONEY_DELTA = 0.005;
const MAX_ATTEMPTS_PER_START = 4;

const TERMINAL_STATES: ReadonlySet<TableWompiState> = new Set([
  "declined",
  "cancelled",
  "expired",
  "error"
]);

export function isTerminalTableWompiState(state: TableWompiState): boolean {
  return TERMINAL_STATES.has(state);
}

function normalizeState(status: unknown): TableWompiState {
  const value = String(status ?? "").toLowerCase();
  switch (value) {
    case "pending":
    case "approved":
    case "declined":
    case "cancelled":
    case "expired":
    case "error":
      return value;
    default:
      // refunded / partially_refunded / desconocido: no es un pago nuevo en curso.
      return "error";
  }
}

async function readFunctionError(error: unknown): Promise<Error> {
  const candidate = error as { context?: Response; message?: string } | null;
  const context = candidate?.context;

  if (context && typeof context.json === "function") {
    try {
      const body = (await context.json()) as { error?: unknown; detail?: unknown };
      if (typeof body.error === "string" && body.error.trim()) {
        const code = body.error.trim();
        const detail =
          typeof body.detail === "string" && body.detail.trim()
            ? body.detail.trim()
            : "";
        return new Error(detail ? `${code}: ${detail}` : code);
      }
    } catch {
      // La respuesta de error puede no ser JSON; se usa el mensaje genérico.
    }
  }

  return new Error(
    candidate?.message?.trim() || "WOMPI_CHECKOUT_FAILED: no se pudo iniciar el pago."
  );
}

/** Estado actual de una sesión de pago de Wompi (solo lectura). */
export async function getTableWompiState(sessionId: string): Promise<TableWompiState> {
  const session = await PaymentSessionManager.get(sessionId);

  if (!session) {
    return "error";
  }

  const state = normalizeState(session.status);

  if (
    state === "pending" &&
    session.expiresAt &&
    new Date(session.expiresAt).getTime() <= Date.now()
  ) {
    return "expired";
  }

  return state;
}

/**
 * Crea (o recupera) la sesión de pago de Wompi para una venta de mesa.
 *
 * La llave de idempotencia incluye el método y el número de intento: mientras
 * la sesión siga pendiente se reutiliza la MISMA (no se crean dos cobros
 * posibles para la misma venta); solo si quedó rechazada, cancelada o vencida
 * se abre una nueva.
 */
export async function startTableWompiCheckout(params: {
  saleId: string;
  method: TableDigitalMethod;
  /** Total oficial de la venta (el de la base de datos). */
  amount: number;
  shiftId?: string;
  cashRegisterId?: string;
  attempt?: number;
}): Promise<TableWompiCheckout> {
  if (!Number.isFinite(params.amount) || params.amount <= 0) {
    throw new Error("INVALID_AMOUNT: el total de la mesa no es válido.");
  }

  let attempt = params.attempt ?? 0;

  for (let tries = 0; tries < MAX_ATTEMPTS_PER_START; tries++, attempt++) {
    const { data, error } = await supabase.functions.invoke<CheckoutFunctionResponse>(
      "wompi-create-pos-checkout",
      {
        body: {
          saleId: params.saleId,
          paymentMethod: params.method,
          cashAmount: 0,
          externalAmount: params.amount,
          idempotencyKey: `table-wompi:${params.saleId}:${params.method}:${attempt}`,
          shiftId: params.shiftId ?? null,
          cashRegisterId: params.cashRegisterId ?? null
        }
      }
    );

    if (error) {
      throw await readFunctionError(error);
    }

    if (!data?.ok || !data.sessionId || !data.checkoutUrl) {
      throw new Error(
        `WOMPI_INVALID_CHECKOUT_RESPONSE: ${data?.error ?? "la respuesta no trae sesión ni URL de pago"}`
      );
    }

    let url: URL;
    try {
      url = new URL(data.checkoutUrl);
    } catch {
      throw new Error("WOMPI_INVALID_CHECKOUT_RESPONSE: la URL de pago no es válida.");
    }

    if (url.protocol !== "https:") {
      throw new Error("WOMPI_INVALID_CHECKOUT_RESPONSE: la URL de pago debe usar HTTPS.");
    }

    const serverAmount = Number(data.externalAmount ?? data.amount);
    if (
      !Number.isFinite(serverAmount) ||
      Math.abs(serverAmount - params.amount) > MAX_MONEY_DELTA
    ) {
      throw new Error(
        "WOMPI_AMOUNT_MISMATCH: el monto de la sesión de pago no coincide con el total de la venta."
      );
    }

    const state = await getTableWompiState(data.sessionId);

    // Sesión de un intento anterior que ya terminó mal: se abre una nueva.
    if (isTerminalTableWompiState(state)) {
      continue;
    }

    return {
      sessionId: data.sessionId,
      checkoutUrl: url.toString(),
      amount: serverAmount,
      attempt
    };
  }

  throw new Error("WOMPI_CHECKOUT_FAILED: no se pudo abrir una sesión de pago nueva. Intenta de nuevo.");
}