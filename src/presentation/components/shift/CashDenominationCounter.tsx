import type { ElementType } from "react";
import { Banknote, Coins, RotateCcw } from "lucide-react";
import { COP_BILL_DENOMINATIONS, COP_COIN_DENOMINATIONS, calculateDenominationTotal, normalizeDenominationCounts } from "../../../core/caja/cashDenominations";

function formatCOP(amount: number): string {
  return `$${Math.round(amount).toLocaleString("es-CO")}`;
}

export function CashDenominationCounter(props: {
  value: Record<string, number>;
  onChange: (next: Record<string, number>) => void;
  disabled?: boolean;
}) {
  const setQuantity = (denomination: number, value: string) => {
    const quantity = value === "" ? 0 : Number(value);
    if (!Number.isInteger(quantity) || quantity < 0) return;
    props.onChange(normalizeDenominationCounts({ ...props.value, [denomination]: quantity }));
  };

  const total = calculateDenominationTotal(props.value);
  const renderGroup = (title: string, Icon: ElementType, denominations: readonly number[]) => (
    <div>
      <div className="flex items-center gap-2 text-slate-300 text-sm font-medium mb-3">
        <Icon className="w-4 h-4" />
        {title}
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
        {denominations.map((denomination) => (
          <label key={denomination} className="rounded-xl border border-slate-800 bg-slate-950/30 p-3">
            <span className="block text-xs text-slate-500">{formatCOP(denomination)}</span>
            <input
              type="number"
              min={0}
              step={1}
              inputMode="numeric"
              value={props.value[String(denomination)] ?? ""}
              onChange={(event) => setQuantity(denomination, event.target.value)}
              disabled={props.disabled}
              className="mt-1 w-full bg-transparent text-white font-semibold outline-none"
              placeholder="0"
            />
          </label>
        ))}
      </div>
    </div>
  );

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-4 rounded-xl border border-amber-500/20 bg-amber-500/5 px-4 py-3">
        <div>
          <p className="text-sm font-semibold text-slate-100">Conte el efectivo físico</p>
          <p className="text-xs text-slate-500 mt-0.5">El esperado del sistema no se muestra antes de enviar el arqueo.</p>
        </div>
        <button
          type="button"
          onClick={() => props.onChange({})}
          disabled={props.disabled}
          className="inline-flex items-center gap-2 text-xs text-slate-400 hover:text-slate-200 disabled:opacity-50"
        >
          <RotateCcw className="w-3.5 h-3.5" />
          Limpiar
        </button>
      </div>

      {renderGroup("Billetes", Banknote, COP_BILL_DENOMINATIONS)}
      {renderGroup("Monedas", Coins, COP_COIN_DENOMINATIONS)}

      <div className="rounded-2xl border border-slate-700 bg-slate-900/50 p-4 flex items-center justify-between">
        <span className="text-sm text-slate-400">Total contado</span>
        <span className="text-2xl font-bold text-slate-100">{formatCOP(total)}</span>
      </div>
    </div>
  );
}
