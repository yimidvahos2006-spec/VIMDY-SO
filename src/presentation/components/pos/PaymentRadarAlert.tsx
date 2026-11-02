import React from "react";
import { BadgeCheck, X, Link2 } from "lucide-react";

import type { IncomingPayment } from "../../../hooks/usePaymentRadar";
import { formatMoney } from "../../../core/utils/formatMoney";
import { companyConfigStore } from "../../../core/store/companyConfigStore";
import { useTranslation } from "../../../core/i18n/useTranslation";

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

  if (!payment) return null;

  const currency = companyConfigStore.get().currency;
  const hasSale = saleTotal > 0;
  const matches = hasSale && Math.abs(payment.amount - saleTotal) < 0.005;
  const short = hasSale && payment.amount < saleTotal - 0.005;
  const over = hasSale && payment.amount > saleTotal + 0.005;

  let hint = "Sin venta en curso: agrega productos para vincular este pago.";
  let hintClass = "text-vimdy-text-secondary";
  if (matches) {
    hint = "El monto coincide exactamente con la venta actual.";
    hintClass = "text-emerald-300";
  } else if (short) {
    hint = `Faltan ${formatMoney(saleTotal - payment.amount, currency, language)} para cubrir la venta.`;
    hintClass = "text-vimdy-warning";
  } else if (over) {
    hint = `Excede la venta en ${formatMoney(payment.amount - saleTotal, currency, language)}.`;
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
              Transferencia recibida
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
            <dt className="text-vimdy-text-secondary">Banco</dt>
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
            disabled={busy || !hasSale}
            onClick={() => onLink(payment)}
            className="flex h-11 items-center justify-center gap-2 rounded-xl border border-emerald-300/70 bg-emerald-500 px-4 text-sm font-black uppercase tracking-wide text-black shadow-[0_0_20px_rgba(16,185,129,0.55)] transition hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-40 disabled:shadow-none"
          >
            <Link2 size={18} />
            {busy ? "Procesando..." : "Vincular y cerrar"}
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