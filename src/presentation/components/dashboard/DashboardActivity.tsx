import React, { useEffect, useState } from "react";
import { Radio, Inbox, Crown } from "lucide-react";

import { useOperationsFeed, FeedEvent } from "../../../hooks/useOperationsFeed";
import { useWaiterLeaderboard } from "../../../hooks/useWaiterLeaderboard";
import { useTranslation } from "../../../core/i18n/useTranslation";
import type { TranslationKey } from "../../../core/i18n/dictionaries";
import { Skeleton } from "../ui/Skeleton";

function formatRelativeTime(timestamp: number, now: number, t: (key: TranslationKey, vars?: Record<string, string | number>) => string): string {
  const seconds = Math.max(0, Math.floor((now - timestamp) / 1000));

  if (seconds < 5) return t("dashboard.activity.justNow");
  if (seconds < 60) return t("dashboard.activity.secondsAgo", { seconds });

  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return t("dashboard.activity.minutesAgo", { minutes });

  const hours = Math.floor(minutes / 60);
  return t("dashboard.activity.hoursAgo", { hours });
}

function FeedRow({ event, now }: { event: FeedEvent; now: number }) {
  const { t } = useTranslation();
  return (
    <div className="flex items-center justify-between rounded-vimdy-lg border border-vimdy-border bg-vimdy-surface p-5 hover:border-vimdy-accent/50 transition-colors duration-vimdy-normal animate-in fade-in slide-in-from-top-2">
      <div className="flex items-center gap-5">
        <div
          className="w-14 h-14 rounded-vimdy-md flex items-center justify-center text-2xl shrink-0"
          style={{ background: `${event.color}20` }}
        >
          {event.emoji}
        </div>

        <div>
          <h3 className="text-vimdy-text font-bold">{event.title}</h3>
          <p className="text-vimdy-text-secondary text-sm">{event.message}</p>
        </div>
      </div>

      <span className="text-vimdy-accent text-sm whitespace-nowrap ml-4">
        {formatRelativeTime(event.timestamp, now, t)}
      </span>
    </div>
  );
}

/**
 * "Mesero del día": ranking por ventas de hoy, con corona para el
 * primero. A propósito solo aparece si hay MÁS DE UN mesero activo — con
 * uno solo, un ranking no dice nada útil y solo estorba en pantalla.
 */
function WaiterLeaderboardCard() {
  const { entries, totalActiveWaiters, loading } = useWaiterLeaderboard();
  const { t } = useTranslation();

  // Fase 3 (5.3 — estados de carga): antes `loading` se trataba igual que
  // "no hay datos" (return null) — la tarjeta simplemente no aparecía
  // mientras cargaba, sin avisar nada. Ahora sí se distingue: mientras
  // carga se muestra un Skeleton; solo cuando YA se sabe que no hay
  // suficientes datos (1 o menos meseros activos, sin entradas) se oculta
  // del todo, que sigue siendo el comportamiento correcto para ese caso.
  if (loading) {
    return (
      <div className="rounded-vimdy-lg border border-vimdy-border bg-vimdy-surface p-5 mb-4 space-y-3">
        <Skeleton className="h-4 w-40" />
        <Skeleton className="h-14 w-full" />
      </div>
    );
  }

  if (totalActiveWaiters <= 1 || entries.length === 0) {
    return null;
  }

  const top3 = entries.slice(0, 3);
  const medalColor = ["text-vimdy-gold", "text-vimdy-silver", "text-vimdy-bronze"];

  return (
    <div className="rounded-vimdy-lg border border-vimdy-border bg-vimdy-surface p-5 mb-4">
      <div className="flex items-center gap-2 mb-4">
        <Crown size={18} className="text-vimdy-gold" />
        <h3 className="text-vimdy-text font-bold">{t("dashboard.activity.waiterOfDay")}</h3>
      </div>
      <div className="space-y-2">
        {top3.map((entry, index) => (
          <div
            key={entry.waiterId}
            className="flex items-center justify-between rounded-vimdy-md bg-vimdy-surface-hover px-4 py-2.5"
          >
            <div className="flex items-center gap-3">
              {index === 0 ? (
                <Crown size={18} className={medalColor[0]} />
              ) : (
                <span className={`w-[18px] text-center font-bold text-sm ${medalColor[index]}`}>
                  {index + 1}
                </span>
              )}
              <span className="text-vimdy-text font-semibold">{entry.waiterName}</span>
            </div>
            <span className="text-vimdy-accent font-bold text-sm">
              {Math.round(entry.total).toLocaleString("es-CO")}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * Contenido del widget "Actividad reciente". Ya se muestra dentro de
 * DashboardWidget (que aporta tarjeta + título), así que aquí solo va
 * el indicador "En vivo" y la lista — sin tarjeta ni título propios,
 * para no duplicar el marco.
 */
export function DashboardActivity() {
  const events = useOperationsFeed();
  const { t } = useTranslation();

  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div>
      <WaiterLeaderboardCard />

      <div className="flex items-center justify-end gap-2 text-vimdy-accent mb-5">
        <Radio size={18} className="animate-pulse" />
        <span className="text-xs font-semibold uppercase tracking-wide">{t("dashboard.activity.live")}</span>
      </div>

      {events.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-3 py-16 text-vimdy-text-secondary">
          <Inbox size={36} />
          <p className="text-sm">{t("dashboard.activity.empty")}</p>
        </div>
      ) : (
        <div className="space-y-4">
          {events.map(event => (
            <FeedRow key={event.id} event={event} now={now} />
          ))}
        </div>
      )}
    </div>
  );
}