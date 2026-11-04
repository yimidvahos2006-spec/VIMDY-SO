import React from "react";
import { Banknote } from "lucide-react";

import type { FloorState, FloorSummary } from "../../../core/services/floorPlan";
import { formatMoney } from "../../../core/utils/formatMoney";
import { FLOOR_STYLES } from "./floorPlanStyles";

interface Props {
  summary: FloorSummary;
  currency: string;
  focus: FloorState | null;
  onFocus: (state: FloorState | null) => void;
}

type FilterState = Extract<FloorState, "free" | "occupied" | "alert">;

const FILTERS: { state: FilterState; hint: (s: FloorSummary) => string }[] = [
  { state: "free", hint: (s) => `de ${s.active} mesas` },
  { state: "occupied", hint: (s) => `${s.occupancyPct}% de ocupación` },
  { state: "alert", hint: () => "requieren atención" }
];

export function FloorSummaryBar({ summary, currency, focus, onFocus }: Props) {
  const openAccounts = summary.occupied + summary.alert;

  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4" role="group" aria-label="Resumen del salón">
      {FILTERS.map(({ state, hint }) => {
        const style = FLOOR_STYLES[state];
        const active = focus === state;
        const Icon = style.icon;
        return (
          <button
            key={state}
            type="button"
            aria-pressed={active}
            onClick={() => onFocus(active ? null : state)}
            className={`rounded-2xl border p-4 text-left transition ${active ? style.statActive : style.stat}`}
          >
            <span className="flex items-center gap-2 text-vimdy-small font-semibold text-vimdy-text-secondary">
              <span aria-hidden className={`h-2.5 w-2.5 rounded-full ${style.dot}`} />
              <Icon size={15} aria-hidden className={style.accent} />
              {style.name}
            </span>
            <span className="mt-2 block text-3xl font-black leading-none tabular-nums text-white">
              {summary[state]}
            </span>
            <span className="mt-1.5 block text-vimdy-micro text-vimdy-text-secondary">{hint(summary)}</span>
          </button>
        );
      })}

      <div className="rounded-2xl border border-vimdy-border bg-vimdy-surface p-4">
        <span className="flex items-center gap-2 text-vimdy-small font-semibold text-vimdy-text-secondary">
          <Banknote size={15} aria-hidden className="text-vimdy-text-secondary" />
          Consumo en vivo
        </span>
        <span className="mt-2 block text-3xl font-black leading-none tabular-nums text-white" aria-live="polite">
          {formatMoney(summary.liveTotal, currency)}
        </span>
        <span className="mt-1.5 block text-vimdy-micro text-vimdy-text-secondary">
          {openAccounts === 1 ? "1 cuenta abierta" : `${openAccounts} cuentas abiertas`}
        </span>
      </div>
    </div>
  );
}