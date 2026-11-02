import { useCallback, useEffect, useRef, useState } from "react";

import { supabase } from "../infrastructure/supabase/supabaseClient";
import { useAuth } from "../presentation/context/AuthContext";

/* ===========================================================================
   usePaymentRadar — Radar Antifraude VIMDY
   ---------------------------------------------------------------------------
   Escucha en tiempo real los INSERT de `incoming_payments` (transferencias
   Nequi / Bancolombia / Daviplata / Bre-B detectadas por el backend) del
   negocio activo y los deja en una cola para que la caja los muestre uno a
   uno en <PaymentRadarAlert />.

   - Filtra por business_id (el "store_id" de VIMDY) igual que realtimeSync.ts.
   - Al montar, también trae los pagos pendientes recientes: si la caja se
     recarga o la tablet pierde señal un momento, no se pierde la alerta.
   - Cada pago se muestra una sola vez (dedupe por id).
=========================================================================== */

export type IncomingPaymentStatus = "pending" | "linked" | "ignored";

export interface IncomingPayment {
  id: string;
  businessId: string;
  bankName: string;
  amount: number;
  senderName: string;
  rawMessage: string;
  createdAt: string;
  status: IncomingPaymentStatus;
}

interface IncomingPaymentRow {
  id: string;
  business_id: string;
  bank_name: string;
  amount: number | string;
  sender_name: string | null;
  raw_message: string | null;
  created_at: string;
  status?: IncomingPaymentStatus | null;
}

/** Pagos pendientes más viejos que esto ya no se muestran como alerta de caja. */
const RECENT_WINDOW_MS = 15 * 60 * 1000;

function mapRow(row: IncomingPaymentRow): IncomingPayment {
  return {
    id: row.id,
    businessId: row.business_id,
    bankName: row.bank_name,
    amount: Number(row.amount),
    senderName: row.sender_name?.trim() || "Remitente desconocido",
    rawMessage: row.raw_message ?? "",
    createdAt: row.created_at,
    status: row.status ?? "pending"
  };
}

export interface UsePaymentRadarResult {
  /** Pago que se está mostrando ahora (el más antiguo sin resolver) o null. */
  current: IncomingPayment | null;
  /** Cuántos más esperan detrás del actual. */
  queued: number;
  /** true cuando el canal en vivo está conectado. */
  connected: boolean;
  /** Marca el pago como vinculado a una venta y lo quita de la cola. */
  markLinked: (paymentId: string, saleId: string) => Promise<void>;
  /** Marca el pago como ignorado y lo quita de la cola. */
  markIgnored: (paymentId: string) => Promise<void>;
}

export function usePaymentRadar(): UsePaymentRadarResult {
  const { businessId, user } = useAuth();
  const [queue, setQueue] = useState<IncomingPayment[]>([]);
  const [connected, setConnected] = useState(false);

  // Ids ya vistos: evita duplicar si llega por Realtime y por la carga inicial.
  const seenIds = useRef(new Set<string>());

  const enqueue = useCallback((payment: IncomingPayment) => {
    if (payment.status !== "pending") return;
    if (seenIds.current.has(payment.id)) return;
    seenIds.current.add(payment.id);
    setQueue((prev) => [...prev, payment]);
  }, []);

  const removeFromQueue = useCallback((paymentId: string) => {
    setQueue((prev) => prev.filter((payment) => payment.id !== paymentId));
  }, []);

  useEffect(() => {
    seenIds.current = new Set();
    setQueue([]);
    setConnected(false);

    if (!businessId) return;

    let cancelled = false;

    // 1) Pendientes recientes (por si la caja se abrió después del pago).
    async function loadRecentPending(currentBusinessId: string) {
      const since = new Date(Date.now() - RECENT_WINDOW_MS).toISOString();
      const { data, error } = await supabase
        .from("incoming_payments")
        .select("id, business_id, bank_name, amount, sender_name, raw_message, created_at, status")
        .eq("business_id", currentBusinessId)
        .eq("status", "pending")
        .gte("created_at", since)
        .order("created_at", { ascending: true });

      if (cancelled) return;
      if (error) {
        console.error("[usePaymentRadar] No se pudieron cargar los pagos pendientes:", error.message);
        return;
      }
      (data as IncomingPaymentRow[] | null)?.forEach((row) => enqueue(mapRow(row)));
    }

    // 2) Escucha en vivo. Nombre único por intento (ver comentario en
    //    realtimeSync.ts: reusar el nombre de un canal que aún se cierra
    //    provoca "cannot add postgres_changes callbacks after subscribe()").
    const channel = supabase
      .channel(`payment-radar-${businessId}-${Date.now()}`)
      .on(
        "postgres_changes" as any,
        {
          event: "INSERT",
          schema: "public",
          table: "incoming_payments",
          filter: `business_id=eq.${businessId}`
        },
        (payload: { new: IncomingPaymentRow }) => {
          if (cancelled || !payload?.new) return;
          enqueue(mapRow(payload.new));
        }
      )
      .subscribe((status: string) => {
        if (cancelled) return;
        const isLive = status === "SUBSCRIBED";
        setConnected(isLive);
        // Al (re)conectar se pudo perder algo mientras no había señal.
        if (isLive) void loadRecentPending(businessId);
      });

    return () => {
      cancelled = true;
      void supabase.removeChannel(channel);
    };
  }, [businessId, enqueue]);

  const resolve = useCallback(
    async (paymentId: string, patch: { status: "linked" | "ignored"; linked_sale_id?: string }) => {
      // Se quita de la pantalla de inmediato; si el servidor falla se avisa en consola
      // (el pago vuelve a aparecer en la próxima carga porque sigue 'pending').
      removeFromQueue(paymentId);

      const { error } = await supabase
        .from("incoming_payments")
        .update({
          ...patch,
          resolved_by: user?.id ?? null,
          resolved_at: new Date().toISOString()
        })
        .eq("id", paymentId)
        .eq("status", "pending");

      if (error) {
        console.error("[usePaymentRadar] No se pudo actualizar el pago:", error.message);
      }
    },
    [removeFromQueue, user?.id]
  );

  const markLinked = useCallback(
    (paymentId: string, saleId: string) => resolve(paymentId, { status: "linked", linked_sale_id: saleId }),
    [resolve]
  );

  const markIgnored = useCallback(
    (paymentId: string) => resolve(paymentId, { status: "ignored" }),
    [resolve]
  );

  return {
    current: queue[0] ?? null,
    queued: Math.max(queue.length - 1, 0),
    connected,
    markLinked,
    markIgnored
  };
}