import React, { useEffect, useRef, useState } from "react";
import { RefreshCw, WifiOff, CheckCircle2 } from "lucide-react";
import { useConnection } from "../../../core/store/useConnection";

/**
 * OfflineStatusBadge
 * ---------------------------------------------------------------------------
 * PASO 1.10 del plan offline: versión reutilizable del mismo estado
 * "offline elegante" que ya muestra Caja (ver PosStatusBar.tsx), pero como
 * un badge compacto para pegar junto al título de cualquier pantalla en vez
 * de una barra completa con fecha/hora/cajero.
 *
 * Usa el mismo connectionStore (ping real cada 20s contra Supabase, ver
 * connectionStore.ts) a través de useConnection — ninguna pantalla necesita
 * su propio polling, solo se suscribe.
 *
 * `pendingCount` es opcional a propósito: pantallas que todavía no tienen
 * una cola offline propia (o donde no aplica) pueden usar el badge solo
 * para "conectado/sin conexión" pasando 0 o nada.
 */
export interface OfflineStatusBadgeProps {
  /** Cuántos registros de ESTA pantalla siguen esperando sincronizarse. */
  pendingCount?: number;
  /** Texto para 1 pendiente, ej. "1 ajuste pendiente". */
  pendingLabelSingular?: string;
  /** Texto para N pendientes, ej. "{count} ajustes pendientes". Debe incluir {count}. */
  pendingLabelPlural?: string;
}

export function OfflineStatusBadge({
  pendingCount = 0,
  pendingLabelSingular = "1 cambio pendiente",
  pendingLabelPlural = "{count} cambios pendientes"
}: OfflineStatusBadgeProps) {
  const { isOnline, checkNow, checking } = useConnection();

  // Muestra "todo sincronizado" un momento cuando la cola pasa de N>0 a 0
  // (mismo comportamiento que PosStatusBar).
  const [justSynced, setJustSynced] = useState(false);
  const prevCountRef = useRef(pendingCount);

  useEffect(() => {
    if (prevCountRef.current > 0 && pendingCount === 0) {
      setJustSynced(true);
      const timeout = setTimeout(() => setJustSynced(false), 4_000);
      prevCountRef.current = pendingCount;
      return () => clearTimeout(timeout);
    }
    prevCountRef.current = pendingCount;
  }, [pendingCount]);

  const pendingLabel =
    pendingCount === 1 ? pendingLabelSingular : pendingLabelPlural.replace("{count}", String(pendingCount));

  if (!isOnline) {
    return (
      <div className="flex items-center gap-3 rounded-xl border border-vimdy-danger/30 bg-vimdy-danger/10 px-3 py-1.5 text-xs">
        <span className="flex items-center gap-2 text-vimdy-danger font-semibold">
          <WifiOff size={13} />
          Sin conexión
          {pendingCount > 0 && <span className="text-slate-400 font-normal">· {pendingLabel}</span>}
        </span>
        <button
          onClick={() => checkNow()}
          disabled={checking}
          className="flex items-center gap-1 text-slate-400 hover:text-white disabled:opacity-50 transition-colors"
        >
          <RefreshCw size={12} className={checking ? "animate-spin" : ""} />
          Reintentar
        </button>
      </div>
    );
  }

  if (pendingCount > 0) {
    return (
      <div className="flex items-center gap-2 rounded-xl border border-vimdy-warning/30 bg-vimdy-warning/10 px-3 py-1.5 text-xs text-vimdy-warning font-semibold">
        <RefreshCw size={13} className="animate-spin" />
        Sincronizando {pendingLabel}
      </div>
    );
  }

  if (justSynced) {
    return (
      <div className="flex items-center gap-2 rounded-xl border border-vimdy-success/30 bg-vimdy-success/10 px-3 py-1.5 text-xs text-vimdy-success font-semibold">
        <CheckCircle2 size={13} />
        Todo sincronizado
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-3 py-1.5 text-xs text-emerald-400 font-semibold">
      <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
      Conectado
    </div>
  );
}