// src/presentation/components/inventory/CostImpactNotice.tsx
//
// Aviso que aparece después de guardar una compra que cambió el costo de un
// insumo: dice cuánto cambió y qué platos se afectan (costo y margen antes → después).

import React from "react";
import { TrendingDown, TrendingUp, X } from "lucide-react";
import type { DishCostChange } from "../../../core/utils/recipeCostImpact";

export interface CostImpactNoticeData {
  readonly insumoName: string;
  /** Unidad en singular: "kg", "litro", "unidad". */
  readonly unitLabel: string;
  readonly costBefore: number | undefined;
  readonly costAfter: number;
  readonly changes: readonly DishCostChange[];
}

const MAX_ROWS = 6;
const percent = (value: number) => `${Math.round(value)}%`;

export function CostImpactNotice({
  data,
  formatMoneyValue,
  onClose
}: {
  data: CostImpactNoticeData;
  formatMoneyValue: (value: number) => string;
  onClose: () => void;
}) {
  const rose = data.costBefore !== undefined && data.costAfter > data.costBefore;
  const Icon = rose ? TrendingUp : TrendingDown;
  const shown = data.changes.slice(0, MAX_ROWS);
  const hidden = data.changes.length - shown.length;

  return (
    <div role="status" className="rounded-vimdy-lg border border-vimdy-accent/30 bg-vimdy-accent/5 p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-2">
          <Icon size={18} aria-hidden="true" className={rose ? "text-vimdy-warning mt-0.5" : "text-vimdy-success mt-0.5"} />
          <div>
            <p className="text-sm font-semibold text-vimdy-text">
              {data.insumoName} ahora cuesta {formatMoneyValue(data.costAfter)} por {data.unitLabel}
              {data.costBefore !== undefined && data.costBefore > 0 ? ` (antes ${formatMoneyValue(data.costBefore)})` : ""}.
            </p>
            <p className="text-xs text-vimdy-text-secondary mt-0.5">
              Ya se actualizó el costo de {data.changes.length === 1 ? "1 plato" : `${data.changes.length} platos`} que lo usan:
            </p>
          </div>
        </div>
        <button onClick={onClose} aria-label="Cerrar aviso" className="text-vimdy-text-secondary hover:text-vimdy-text">
          <X size={18} />
        </button>
      </div>

      <ul className="mt-3 divide-y divide-vimdy-border text-sm">
        {shown.map((c) => (
          <li key={`${c.dishId}-${c.label}`} className="py-2 flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
            <span className="font-medium text-vimdy-text">{c.label}</span>
            <span className="text-vimdy-text-secondary">
              Costo {formatMoneyValue(c.costBefore)} → {formatMoneyValue(c.costAfter)} · Margen {percent(c.marginBefore)} → {percent(c.marginAfter)}
              {c.losesMoney && <strong className="ml-2 text-vimdy-danger">Ahora pierdes dinero</strong>}
              {c.costUnreliable && !c.losesMoney && <span className="ml-2 text-xs text-vimdy-text-tertiary">Falta el costo de otro insumo</span>}
            </span>
          </li>
        ))}
      </ul>
      {hidden > 0 && <p className="mt-2 text-xs text-vimdy-text-tertiary">y {hidden} más.</p>}
    </div>
  );
}