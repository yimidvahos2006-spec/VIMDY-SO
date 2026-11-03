import React, { useEffect } from "react";
import { BadgeCheck, X, Link2 } from "lucide-react";

import type { IncomingPayment } from "../../../hooks/usePaymentRadar";
import { formatMoney } from "../../../core/utils/formatMoney";
import { companyConfigStore } from "../../../core/store/companyConfigStore";
import { useTranslation } from "../../../core/i18n/useTranslation";

// Timbre de notificación generado con Web Audio API (sin archivos MP3).
// Se reutiliza un solo AudioContext: crear uno por alerta termina bloqueado
// por el navegador. Dos notas rápidas (D5 -> A5) con caída suave, tipo caja.
let audioCtx: AudioContext | null = null;

function playNotificationChime(): void {
  try {
    const Ctor: typeof AudioContext | undefined =
      window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;
    audioCtx = audioCtx ?? new Ctor();
    const ctx = audioCtx;
    // Si el navegador lo dejó "suspended" (política de autoplay), se reanuda.
    if (ctx.state === "suspended") void ctx.resume();

    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.setValueAtTime(587.33, now); // D5
    osc.frequency.setValueAtTime(880, now + 0.1); // A5
    gain.gain.setValueAtTime(0.2, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.5);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.5);
  } catch (error) {
    // Sin sonido no pasa nada: la alerta visual igual aparece.
    console.warn("[PaymentRadarAlert] Audio no disponible:", error);
  }
}

interface PaymentRadarAlertProps {
  /** Transferencia detectada; si es null no se dibuja nada. */
  payment: IncomingPayment | null;
  /** Cuántas transferencias más esperan detrás de esta. */
  queued?: number;
  /** Total de la venta en curso, para avisar si el monto no coincide. */
  saleTotal?: number;
  /** true mientras se está cobrando/vinculando (bloquea los botones). */
  busy?: boolean;
  onLink: (payment: IncomingPayment) => void;
  onIgnore: (payment: IncomingPayment) => void;
}

/**
 * Radar Antifraude VIMDY — "El Chulo Verde".
 * Tarjeta flotante Dark Mode con acento esmeralda neón que aparece sola en
 * la caja cuando entra una transferencia real (Nequi, Bancolombia,
 * Daviplata, Bre-B). El cajero decide: vincularla a la venta actual o
 * ignorarla.
 */
export function PaymentRadarAlert({
  payment,
  queued = 0,
  saleTotal = 0,
  busy = false,
  onLink,
  onIgnore
}: PaymentRadarAlertProps) {
  const { language } = useTranslation();

  // Suena una vez por cada transferencia nueva (por id, no por re-render).
  const paymentId = payment?.id ?? null;
  useEffect(() => {
    if (paymentId) playNotificationChime();
  }, [paymentId]);

  if (!payment) return null;

  const currency = companyConfigStore.get().currency;
  const hasSale = saleTotal > 0;
  const matches = hasSale && Math.abs(payment.amount - saleTotal) < 0.005;
  const short = hasSale && payment.amount < saleTotal - 0.005;
  const over = hasSale && payment.amount > saleTotal + 0.005;

  const isWompi = payment.source === "wompi";
  const title = isWompi ? "Pago Wompi verificado" : "Transferencia verificada";

  let hint = "Sin venta en curso: agrega productos para vincular este pago.";
  let hintClass = "text-vimdy-text-secondary";
  if (matches) {
    hint = "El monto coincide exactamente: se cerrará la venta, se descuenta el inventario y se imprime el ticket.";
    hintClass = "text-emerald-300";
  } else if (short) {
    hint = `Faltan ${formatMoney(saleTotal - payment.amount, currency, language)}: el monto debe ser exacto para vincular.`;
    hintClass = "text-vimdy-warning";
  } else if (over) {
    hint = `Excede la venta en ${formatMoney(payment.amount - saleTotal, currency, language)}: el monto debe ser exacto para vincular.`;
    hintClass = "text-vimdy-warning";
  }

  return (
    <div
      role="alert"
      aria-live="assertive"
      className="fixed top-4 right-4 z-[60] w-[calc(100vw-2rem)] max-w-sm animate-vimdy-fade-in"
    >
      <div className="relative overflow-hidden rounded-2xl border border-emerald-400/60 bg-black/95 p-5 shadow-[0_0_32px_rgba(16,185,129,0.45)] backdrop-blur">
        {/* Resplandor esmeralda superior */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -top-16 left-1/2 h-32 w-56 -translate-x-1/2 rounded-full bg-emerald-500/25 blur-3xl"
        />

        <div className="relative flex items-start gap-3">
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full border border-emerald-400/70 bg-emerald-500/15 shadow-[0_0_18px_rgba(52,211,153,0.6)]">
            <BadgeCheck size={28} className="text-emerald-400" />
          </div>

          <div className="min-w-0 flex-1">
            <p className="text-[11px] font-bold uppercase tracking-[0.25em] text-emerald-400">
              {title}
            </p>
            <p className="mt-1 text-3xl font-black leading-tight tabular-nums text-emerald-300 drop-shadow-[0_0_10px_rgba(52,211,153,0.55)]">
              {formatMoney(payment.amount, currency, language)}
            </p>
          </div>

          {queued > 0 && (
            <span className="shrink-0 rounded-full border border-emerald-400/40 bg-emerald-500/10 px-2 py-0.5 text-[11px] font-bold text-emerald-300">
              +{queued}
            </span>
          )}
        </div>

        <dl className="relative mt-4 space-y-1.5 text-vimdy-small">
          <div className="flex items-baseline justify-between gap-3">
            <dt className="text-vimdy-text-secondary">{isWompi ? "Medio" : "Banco"}</dt>
            <dd className="font-semibold text-vimdy-text">{payment.bankName}</dd>
          </div>
          <div className="flex items-baseline justify-between gap-3">
            <dt className="text-vimdy-text-secondary">Remitente</dt>
            <dd className="truncate font-semibold text-vimdy-text">{payment.senderName}</dd>
          </div>
        </dl>

        <p className={`relative mt-3 text-vimdy-micro ${hintClass}`}>{hint}</p>

        <div className="relative mt-4 grid grid-cols-[1fr_auto] gap-2">
          <button
            type="button"
            disabled={busy || !matches}
            onClick={() => onLink(payment)}
            className="flex h-11 items-center justify-center gap-2 rounded-xl border border-emerald-300/70 bg-emerald-500 px-4 text-sm font-black uppercase tracking-wide text-black shadow-[0_0_20px_rgba(16,185,129,0.55)] transition hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-40 disabled:shadow-none"
          >
            <Link2 size={18} />
            {busy ? "Cerrando venta..." : "Vincular y Cerrar Venta"}
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => onIgnore(payment)}
            className="flex h-11 items-center justify-center gap-1.5 rounded-xl border border-vimdy-border bg-vimdy-surface px-4 text-sm font-semibold text-vimdy-text-secondary transition hover:border-vimdy-text-tertiary hover:text-vimdy-text disabled:cursor-not-allowed disabled:opacity-40"
          >
            <X size={16} />
            Ignorar
          </button>
        </div>
      </div>
    </div>
  );
}