import { useNavigate } from "react-router-dom";
import { BrainCircuit } from "lucide-react";

import { VimdyButton } from "../ui/VimdyButton";
import { useBusinessSnapshot } from "../../../hooks/useBusinessSnapshot";
import { useTranslation } from "../../../core/i18n/useTranslation";
import { buildManagerPriorities, priorityTitle, PRIORITY_COLOR_CLASS } from "./managerPriorities";

/**
 * GerenteInteligente — Bloque 3 (VIMDY Experience 1.0, Dashboard V3, Paso 1.1)
 * ---------------------------------------------------------------------------
 * Antes esta tarjeta también hacía de saludo (Bloque 1) y de "Resumen de
 * hoy" con 8 datos (que ahora vive repartido entre el Bloque 1 y el
 * Bloque 2, sin repetirse). Ahora este bloque tiene una sola función:
 * mostrar únicamente recomendaciones accionables, cada una con su título,
 * su explicación y su botón de acción hacia la pantalla exacta donde se
 * resuelve — nunca un botón genérico.
 *
 * Se renderiza fijo en Dashboard.tsx, fuera del sistema de widgets: no se
 * puede mover ni ocultar. Los datos salen de useBusinessSnapshot, el mismo
 * BusinessSnapshot real que ya usan el Copiloto y las alertas automáticas.
 */
export function GerenteInteligente() {
  const navigate = useNavigate();
  const { snapshot, hasEnoughData } = useBusinessSnapshot();
  const { t } = useTranslation();

  const priorities = snapshot ? buildManagerPriorities(snapshot, t) : [];

  return (
    <div className="col-span-12 rounded-vimdy-2xl border border-vimdy-accent/20 bg-vimdy-surface shadow-vimdy-lg overflow-hidden">
      <div className="px-6 py-6 sm:px-8 sm:py-8">
        <div className="flex items-center gap-4 mb-5">
          <div className="w-12 h-12 rounded-vimdy-lg bg-vimdy-accent/15 flex items-center justify-center shrink-0">
            <BrainCircuit size={24} className="text-vimdy-accent" />
          </div>
          <div>
            <p className="text-xs font-bold tracking-widest text-vimdy-accent uppercase">{t("dashboard.gerente.title")}</p>
            <p className="text-sm text-vimdy-text-secondary">{t("dashboard.gerente.subtitle")}</p>
          </div>
        </div>

        {!snapshot ? (
          <div className="rounded-vimdy-lg border border-vimdy-border bg-vimdy-background/40 px-5 py-6 text-sm text-vimdy-text-tertiary">
            {t("dashboard.gerente.analyzing")}
          </div>
        ) : !hasEnoughData ? (
          <div className="rounded-vimdy-lg border border-vimdy-border bg-vimdy-background/40 px-5 py-6 text-sm text-vimdy-text-secondary">
            <p>{t("dashboard.gerente.notEnoughData1")}</p>
            <p className="mt-1">{t("dashboard.gerente.notEnoughData2")}</p>
          </div>
        ) : priorities.length === 0 ? (
          <div className="rounded-vimdy-lg border border-vimdy-success/30 bg-vimdy-success/10 px-5 py-6 text-sm text-vimdy-success">
            {t("dashboard.gerente.allGood")}
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {priorities.map((priority) => {
              const colorClass = PRIORITY_COLOR_CLASS[priority.color];
              return (
                <div
                  key={priority.key}
                  className={`flex flex-col sm:flex-row sm:items-center gap-3 sm:gap-4 rounded-vimdy-lg border ${colorClass.border} ${colorClass.bg} px-5 py-4`}
                >
                  <div className="flex-1">
                    <p className={`text-xs font-bold uppercase tracking-wide ${colorClass.text}`}>
                      {priority.icon} {priorityTitle(priority, t)}
                    </p>
                    <p className="mt-1 text-sm sm:text-base font-medium text-vimdy-text">
                      {priority.message}
                    </p>
                  </div>
                  <VimdyButton
                    onClick={() => navigate(priority.route)}
                    variant="secondary"
                    size="sm"
                    className="shrink-0 self-start sm:self-auto"
                  >
                    {priority.actionLabel} →
                  </VimdyButton>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}