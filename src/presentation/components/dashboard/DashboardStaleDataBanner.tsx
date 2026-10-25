import { useState, useSyncExternalStore } from "react";
import { CloudOff, RefreshCw } from "lucide-react";

import { useTranslation } from "../../../core/i18n/useTranslation";
import { dashboardSyncStatusStore } from "../../../core/store/dashboardSyncStatusStore";
import { useConnection } from "../../../core/store/useConnection";

/**
 * Aviso de datos desactualizados.
 *
 * Si la red falla DESPUÉS de una carga buena, el Dashboard conserva los números
 * (mejor que borrarlos) pero deja claro que son los de la última sincronización
 * y no los de este instante. Aparece cuando:
 *   - ya hubo al menos una sincronización exitosa, y además
 *   - la última reconciliación falló, o no hay conexión real con el servidor.
 * Desaparece solo cuando una sincronización nueva termina bien.
 */
export function DashboardStaleDataBanner() {
  const { language } = useTranslation();
  const sync = useSyncExternalStore(
    dashboardSyncStatusStore.subscribe,
    dashboardSyncStatusStore.getSnapshot,
    dashboardSyncStatusStore.getSnapshot,
  );
  const { isOnline, checkNow } = useConnection();
  const [retrying, setRetrying] = useState(false);

  if (!sync.lastSyncedAt) return null;
  if (sync.state !== "error" && isOnline) return null;

  const locale = language === "en" ? "en-US" : language === "pt" ? "pt-BR" : "es-CO";
  const time = sync.lastSyncedAt.toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" });
  const sameDay = sync.lastSyncedAt.toDateString() === new Date().toDateString();
  const when = sameDay
    ? time
    : `${sync.lastSyncedAt.toLocaleDateString(locale, { day: "2-digit", month: "short" })} ${time}`;

  const title = language === "en"
    ? "Outdated data"
    : language === "pt"
      ? "Dados desatualizados"
      : "Datos desactualizados";
  const body = language === "en"
    ? `We could not update the dashboard. The numbers shown are from the last sync (${when}) and may not reflect sales or changes made since then.`
    : language === "pt"
      ? `Não foi possível atualizar o dashboard. Os números exibidos são da última sincronização (${when}) e podem não refletir vendas ou mudanças feitas depois.`
      : `No pudimos actualizar el dashboard. Los números mostrados son de la última sincronización (${when}) y pueden no reflejar ventas o cambios hechos después.`;
  const retryLabel = language === "en" ? "Retry now" : language === "pt" ? "Tentar agora" : "Reintentar ahora";

  async function handleRetry() {
    if (retrying) return;
    setRetrying(true);
    try {
      await checkNow();
      dashboardSyncStatusStore.retry();
    } finally {
      // Pequeña pausa para que el botón no parpadee si la respuesta es instantánea.
      window.setTimeout(() => setRetrying(false), 800);
    }
  }

  return (
    <div
      role="alert"
      className="flex flex-col gap-3 rounded-vimdy-xl border border-vimdy-warning/40 bg-vimdy-warning/10 px-4 py-3 sm:flex-row sm:items-center sm:justify-between"
    >
      <div className="flex min-w-0 items-start gap-3">
        <CloudOff size={20} className="mt-0.5 shrink-0 text-vimdy-warning" aria-hidden="true" />
        <div className="min-w-0">
          <p className="text-sm font-semibold text-vimdy-text">{title}</p>
          <p className="text-sm text-vimdy-text-secondary">{body}</p>
        </div>
      </div>
      <button
        type="button"
        onClick={handleRetry}
        disabled={retrying}
        className="inline-flex shrink-0 items-center justify-center gap-2 rounded-vimdy-lg border border-vimdy-warning/50 px-3 py-2 text-sm font-semibold text-vimdy-text transition-colors hover:bg-vimdy-warning/15 disabled:opacity-60"
      >
        <RefreshCw size={15} className={retrying ? "animate-spin" : ""} aria-hidden="true" />
        {retryLabel}
      </button>
    </div>
  );
}

export default DashboardStaleDataBanner;