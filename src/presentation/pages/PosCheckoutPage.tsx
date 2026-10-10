import { useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import { CheckCircle, XCircle, Loader2 } from "lucide-react";

import { PaymentSessionManager } from "../../core/payments/PaymentSessionManager";
import type { PaymentSession } from "../../core/payments/models/PaymentModels";
import { supabase } from "../../infrastructure/supabase/supabaseClient";

type SessionStatus =
  | "pending"
  | "approved"
  | "declined"
  | "cancelled"
  | "expired"
  | "error"
  | "not_found"
  | "amount_mismatch";

interface PaymentSessionAudit extends PaymentSession {
  saleId: string;
  cashAmount: number;
  paymentMethod: string;
  businessId: string;
  branchId: string | null;
}

interface SaleCanonicalData {
  id: string;
  business_id: string;
  branch_id: string | null;
  data: Record<string, unknown>;
}

const MAX_MONEY_DELTA = 0.005;
const POLL_MS = 3000;
const TERMINAL_SESSION_STATUSES = new Set([
  "declined",
  "cancelled",
  "expired",
  "error",
]);
const FINAL_SALE_STATUSES = new Set(["PAID", "CLOSED"]);

function money(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function readNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
}

function readText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized || null;
}

function mapStatus(status: string): SessionStatus {
  switch (status) {
    case "pending":
    case "approved":
    case "declined":
    case "cancelled":
    case "expired":
    case "error":
      return status;
    default:
      return "error";
  }
}

function formatMoney(value: number, currency = "COP"): string {
  return new Intl.NumberFormat("es-CO", {
    style: "currency",
    currency: currency || "COP",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

/**
 * Página de retorno del checkout externo.
 *
 * La autoridad del importe NO es cartStore ni paymentStore. Es la sesión
 * persistida por create_wompi_sale_payment_session_atomic(), que calcula el
 * importe externo a partir de sales.data.total. Esta página únicamente lee
 * ese resultado y comprueba que siga coincidiendo con la venta canónica.
 *
 * El pago no se marca como aprobado en pantalla hasta que tanto la sesión
 * externa como la venta estén conciliadas por backend.
 */
export function PosCheckoutPage() {
  const { sessionId } = useParams<{ sessionId: string }>();
  const [status, setStatus] = useState<SessionStatus>("pending");
  const [session, setSession] = useState<PaymentSessionAudit | null>(null);
  const [sale, setSale] = useState<SaleCanonicalData | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    const normalizedSessionId = sessionId?.trim();

    if (!normalizedSessionId) {
      setStatus("not_found");
      setErrorMsg("No se recibió el identificador de la sesión de checkout.");
      return;
    }

    let cancelled = false;
    let pollInterval: ReturnType<typeof setInterval> | null = null;

    const stopPolling = () => {
      if (pollInterval) {
        clearInterval(pollInterval);
        pollInterval = null;
      }
    };

    const loadCheckoutState = async () => {
      if (cancelled) return;

      try {
        const sessionRow = await PaymentSessionManager.get(
          normalizedSessionId
        );

        if (cancelled) return;

        if (!sessionRow) {
          setSession(null);
          setSale(null);
          setStatus("not_found");
          setErrorMsg("No se encontró la sesión de pago.");
          stopPolling();
          return;
        }

        const { data: rawSession, error: rawSessionError } = await supabase
          .from("payment_sessions")
          .select(
            "id,business_id,branch_id,sale_id,cash_amount,payment_method,provider,provider_reference,status,amount,currency,idempotency_key,metadata,created_at,updated_at,expires_at"
          )
          .eq("id", normalizedSessionId)
          .maybeSingle();

        if (rawSessionError) {
          throw rawSessionError;
        }

        if (!rawSession) {
          setStatus("not_found");
          setErrorMsg("No se encontró la sesión de pago.");
          stopPolling();
          return;
        }

        const businessId = readText(rawSession.business_id);
        const saleId = readText(rawSession.sale_id);
        const cashAmount = money(readNumber(rawSession.cash_amount) ?? 0);
        const paymentMethod =
          readText(rawSession.payment_method)?.toUpperCase() ?? "CARD";

        if (!businessId) {
          throw new Error("PAYMENT_SESSION_INVALID_BUSINESS");
        }

        if (!saleId) {
          throw new Error("PAYMENT_SESSION_HAS_NO_SALE");
        }

        const auditSession: PaymentSessionAudit = {
          ...sessionRow,
          businessId,
          branchId: readText(rawSession.branch_id),
          saleId,
          cashAmount,
          paymentMethod,
        };

        setSession(auditSession);

        const { data: saleRow, error: saleError } = await supabase
          .from("sales")
          .select("id,business_id,branch_id,data")
          .eq("id", saleId)
          .eq("business_id", businessId)
          .maybeSingle();

        if (saleError) {
          throw saleError;
        }

        if (!saleRow) {
          throw new Error("PAYMENT_SESSION_SALE_NOT_FOUND");
        }

        const canonicalSale: SaleCanonicalData = {
          id: saleRow.id,
          business_id: saleRow.business_id,
          branch_id: saleRow.branch_id,
          data:
            saleRow.data && typeof saleRow.data === "object"
              ? (saleRow.data as Record<string, unknown>)
              : {},
        };

        const canonicalTotal = readNumber(canonicalSale.data.total);

        if (canonicalTotal === null || canonicalTotal <= 0) {
          throw new Error("SALE_CANONICAL_TOTAL_INVALID");
        }

        const sessionAmount = money(sessionRow.amount);
        const expectedExternalAmount =
          paymentMethod === "MIXED"
            ? money(canonicalTotal - cashAmount)
            : money(canonicalTotal);

        if (expectedExternalAmount <= 0) {
          throw new Error("PAYMENT_SESSION_EXTERNAL_AMOUNT_INVALID");
        }

        if (
          Math.abs(sessionAmount - expectedExternalAmount) >
          MAX_MONEY_DELTA
        ) {
          setSale(canonicalSale);
          setStatus("amount_mismatch");
          setErrorMsg(
            `Monto canónico inconsistente: la venta exige ${formatMoney(
              expectedExternalAmount,
              sessionRow.currency
            )}, pero la sesión externa contiene ${formatMoney(
              sessionAmount,
              sessionRow.currency
            )}. El checkout queda bloqueado para impedir un cobro incorrecto.`
          );
          stopPolling();
          return;
        }

        const saleStatus =
          readText(canonicalSale.data.status)?.toUpperCase() ?? "";
        const sessionStatus = String(sessionRow.status).toLowerCase();

        setSale(canonicalSale);

        if (TERMINAL_SESSION_STATUSES.has(sessionStatus)) {
          setStatus(mapStatus(sessionStatus));
          setErrorMsg(null);
          stopPolling();
          return;
        }

        if (sessionStatus === "approved") {
          if (!FINAL_SALE_STATUSES.has(saleStatus)) {
            // No convertimos una aprobación externa en error permanente.
            // El webhook/finalize backend puede estar unos segundos detrás.
            // Seguimos consultando hasta que la venta llegue a PAID/CLOSED.
            setStatus("pending");
            setErrorMsg(
              "Pago aprobado por Wompi. Esperando la confirmación final de VIMDY..."
            );
            return;
          }

          setStatus("approved");
          setErrorMsg(null);
          stopPolling();
          return;
        }

        setStatus(mapStatus(sessionStatus));
        setErrorMsg(null);
      } catch (error) {
        if (cancelled) return;

        setStatus("error");
        setErrorMsg(
          error instanceof Error ? error.message : String(error)
        );
        stopPolling();
      }
    };

    void loadCheckoutState();
    pollInterval = setInterval(loadCheckoutState, POLL_MS);

    return () => {
      cancelled = true;
      stopPolling();
    };
  }, [sessionId]);

  const canonicalExternalAmount = useMemo(() => {
    if (!session || !sale) return null;

    const total = readNumber(sale.data.total);
    if (total === null) return null;

    const expected =
      session.paymentMethod === "MIXED"
        ? total - session.cashAmount
        : total;

    return expected > 0 ? money(expected) : null;
  }, [sale, session]);

  const formattedAmount = useMemo(() => {
    if (!session) return formatMoney(0);
    return formatMoney(session.amount, session.currency);
  }, [session]);

  const handleClose = () => {
    if (window.opener) {
      window.opener.postMessage(
        {
          type: "POS_CHECKOUT_RESULT",
          status,
          sessionId,
          canonicalExternalAmount,
        },
        window.location.origin
      );
    }

    window.close();
  };

  return (
    <div className="min-h-screen bg-gray-950 text-white flex items-center justify-center">
      <div className="flex flex-col items-center justify-center gap-6 p-8 max-w-md text-center">
        {status === "pending" && (
          <>
            <Loader2 className="h-12 w-12 animate-spin text-cyan-400" />
            <h1 className="text-2xl font-bold">Procesando pago</h1>
            <p className="text-gray-400">
              Estamos verificando el estado de tu pago. Por favor, no cierres
              esta ventana.
            </p>
          </>
        )}

        {status === "approved" && (
          <>
            <CheckCircle className="h-12 w-12 text-green-400" />
            <h1 className="text-2xl font-bold">Pago confirmado</h1>
            <p className="text-gray-400">
              Tu pago de {formattedAmount} ha sido procesado correctamente.
            </p>
            <button
              className="mt-4 px-6 py-2 bg-cyan-500 hover:bg-cyan-600 rounded-lg font-medium transition-colors"
              onClick={handleClose}
            >
              Cerrar
            </button>
          </>
        )}

        {status === "declined" && (
          <>
            <XCircle className="h-12 w-12 text-red-400" />
            <h1 className="text-2xl font-bold">Pago rechazado</h1>
            <p className="text-gray-400">
              El proveedor de pagos rechazó la transacción. Puedes intentarlo
              nuevamente.
            </p>
          </>
        )}

        {status === "cancelled" && (
          <>
            <XCircle className="h-12 w-12 text-yellow-400" />
            <h1 className="text-2xl font-bold">Pago cancelado</h1>
            <p className="text-gray-400">
              Has cancelado el proceso de pago. La venta no fue confirmada.
            </p>
          </>
        )}

        {status === "expired" && (
          <>
            <XCircle className="h-12 w-12 text-gray-400" />
            <h1 className="text-2xl font-bold">Sesión expirada</h1>
            <p className="text-gray-400">
              El tiempo para completar el pago ha expirado. Vuelve a iniciar
              el checkout.
            </p>
          </>
        )}

        {status === "amount_mismatch" && (
          <>
            <XCircle className="h-12 w-12 text-red-400" />
            <h1 className="text-2xl font-bold">Monto no válido</h1>
            <p className="text-gray-400">
              {errorMsg ??
                "El monto calculado por el servidor no coincide con la sesión de pago."}
            </p>
          </>
        )}

        {status === "error" && (
          <>
            <XCircle className="h-12 w-12 text-red-400" />
            <h1 className="text-2xl font-bold">Error al procesar</h1>
            <p className="text-gray-400">
              {errorMsg || "Ocurrió un error al verificar tu pago."}
            </p>
          </>
        )}

        {status === "not_found" && (
          <>
            <XCircle className="h-12 w-12 text-red-400" />
            <h1 className="text-2xl font-bold">Sesión no encontrada</h1>
            <p className="text-gray-400">
              No se encontró la sesión de pago. Verifica que la URL sea
              correcta.
            </p>
          </>
        )}
      </div>
    </div>
  );
}
