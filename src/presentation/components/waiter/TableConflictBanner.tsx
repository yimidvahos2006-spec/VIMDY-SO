import React from "react";
import { AlertTriangle } from "lucide-react";
import type { BlockedTable } from "../../../core/offline/tableConflictRules";
import { useTranslation } from "../../../core/i18n/useTranslation";

/**
 * TableConflictBanner (offline mesas, Paso 4)
 * ---------------------------------------------------------------------------
 * Aviso visual para el mesero cuando una mesa tuvo un conflicto de
 * significado al sincronizar (se cobró, se cerró en caja, se reabrió...).
 *
 * A propósito NO tiene botones de resolver, descartar ni reintentar: el
 * mesero nunca resuelve conflictos. Las operaciones quedan retenidas en la
 * cola y las audita Caja/Admin. Solo las mesas bloqueadas se listan; el resto
 * sigue funcionando.
 */
export function TableConflictBanner({ blocked }: { blocked: readonly BlockedTable[] }) {
  const { t } = useTranslation();
  if (blocked.length === 0) return null;

  const tables = blocked.map((entry) => entry.tableName).join(", ");

  return (
    <div
      role="alert"
      data-testid="table-conflict-banner"
      className="mb-6 flex items-start gap-3 rounded-2xl border border-amber-500/40 bg-amber-500/10 p-4 text-amber-100"
    >
      <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-400" aria-hidden="true" />
      <div className="min-w-0">
        <p className="font-bold">
          {t(blocked.length === 1 ? "waiter.conflict.titleSingular" : "waiter.conflict.titlePlural", { tables })}
        </p>
        <p className="mt-1 text-sm text-amber-100/80">{t("waiter.conflict.body")}</p>
      </div>
    </div>
  );
}