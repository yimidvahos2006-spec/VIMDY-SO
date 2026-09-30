import React, { useRef, useState } from "react";
import { AlertTriangle, CheckCircle2, Lock, Loader2, Plus, Minus, ShieldCheck } from "lucide-react";
import type { Shift } from "../../../core/entities/Entities";
import type { CashMovementReasonCode } from "../../../core/caja/CajaEnterpriseTypes";
import { enterpriseCashService } from "../../../infrastructure/caja/enterpriseCashService";
import { CashDenominationCounter } from "./CashDenominationCounter";
import { translateBusinessError } from "../../../core/errors/translateBusinessError";

function formatCOP(amount: number): string {
  return `$${Math.round(amount).toLocaleString("es-CO")}`;
}

const IN_REASONS: Array<{ code: CashMovementReasonCode; label: string }> = [
  { code: "CHANGE_FUND_IN", label: "Fondo/cambio adicional" },
  { code: "OTHER_IN", label: "Otro ingreso" },
];

const OUT_REASONS: Array<{ code: CashMovementReasonCode; label: string }> = [
  { code: "EXPENSE", label: "Gasto del negocio" },
  { code: "SAFE_DROP", label: "Retiro a caja fuerte" },
  { code: "BANK_DEPOSIT", label: "Depósito bancario" },
  { code: "OTHER_OUT", label: "Otra salida" },
];

export function EnterpriseCashControls(props: {
  shift: Shift;
  totalCashIncome: number;
  totalExpense: number;
  onClosed: (shiftData: Record<string, unknown>, result: { expectedAmount: number; countedAmount: number; difference: number }) => Promise<void> | void;
  onRefresh: () => Promise<void>;
}) {
  const [denominations, setDenominations] = useState<Record<string, number>>({});
  const [closingNotes, setClosingNotes] = useState("");
  const [closing, setClosing] = useState(false);
  const [movementType, setMovementType] = useState<"IN" | "OUT">("OUT");
  const [movementAmount, setMovementAmount] = useState("");
  const [movementReason, setMovementReason] = useState<CashMovementReasonCode>("EXPENSE");
  const [movementDescription, setMovementDescription] = useState("");
  const [moving, setMoving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [closeResult, setCloseResult] = useState<{ expectedAmount: number; countedAmount: number; difference: number } | null>(null);
  const movementIdRef = useRef<string | null>(null);

  if (!props.shift.cashRegisterId) {
    return (
      <div className="rounded-2xl border border-red-500/30 bg-red-500/5 p-5 text-sm text-red-300">
        <AlertTriangle className="w-4 h-4 inline-block mr-2" />
        Este turno no tiene una caja física asignada. VIMDY bloquea el cierre hasta resolver la asignación.
      </div>
    );
  }

  const cashRegisterId = props.shift.cashRegisterId;
  const reasons = movementType === "IN" ? IN_REASONS : OUT_REASONS;

  async function handleClose(event: React.FormEvent) {
    event.preventDefault();
    setMessage(null);
    setClosing(true);
    try {
      const result = await enterpriseCashService.closeShiftWithCashCount({
        shiftId: props.shift.id,
        cashRegisterId,
        countedAmount: Object.entries(denominations).reduce((sum, [denomination, quantity]) => sum + Number(denomination) * Number(quantity), 0),
        denominations,
        notes: closingNotes || undefined,
      });
      setCloseResult({
        expectedAmount: result.expectedAmount,
        countedAmount: result.countedAmount,
        difference: result.difference,
      });
      await props.onClosed(result.shiftData, {
        expectedAmount: result.expectedAmount,
        countedAmount: result.countedAmount,
        difference: result.difference,
      });
      setDenominations({});
      setClosingNotes("");
      await props.onRefresh();
    } catch (error) {
      setMessage(translateBusinessError(error, "No se pudo cerrar el turno."));
    } finally {
      setClosing(false);
    }
  }

  async function handleMovement(event: React.FormEvent) {
    event.preventDefault();
    const amount = Number(movementAmount);
    setMessage(null);
    if (!Number.isFinite(amount) || amount <= 0) {
      setMessage("El monto debe ser mayor a cero.");
      return;
    }
    if (!movementDescription.trim()) {
      setMessage("Describe el movimiento para dejar trazabilidad.");
      return;
    }
    setMoving(true);
    movementIdRef.current ??= crypto.randomUUID();
    try {
      await enterpriseCashService.registerManualMovement({
        shiftId: props.shift.id,
        cashRegisterId,
        type: movementType,
        amount,
        reasonCode: movementReason,
        description: movementDescription,
        idempotencyKey: movementIdRef.current,
      });
      movementIdRef.current = null;
      setMovementAmount("");
      setMovementDescription("");
      setMessage("Movimiento registrado y asociado al turno actual.");
      await props.onRefresh();
    } catch (error) {
      setMessage(translateBusinessError(error, "No se pudo registrar el movimiento."));
    } finally {
      setMoving(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Metric label="Fondo inicial" value={formatCOP(props.shift.openingAmount)} />
        <Metric label="Ventas efectivo" value={formatCOP(props.totalCashIncome)} />
        <Metric label="Salidas" value={formatCOP(props.totalExpense)} />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-[1.15fr_0.85fr] gap-6">
        <div className="bg-vimdy-surface border border-slate-800 rounded-2xl p-6">
          <div className="flex items-center gap-2 mb-5">
            <ShieldCheck className="w-5 h-5 text-emerald-400" />
            <div>
              <h3 className="font-semibold text-slate-100">Arqueo ciego</h3>
              <p className="text-xs text-slate-500">Primero cuentas. Después VIMDY revela la diferencia.</p>
            </div>
          </div>
          <form onSubmit={handleClose} className="space-y-5">
            <CashDenominationCounter value={denominations} onChange={setDenominations} disabled={closing} />
            <div>
              <label className="text-xs text-slate-400 block mb-1">Nota de cierre (opcional)</label>
              <textarea
                value={closingNotes}
                onChange={(event) => setClosingNotes(event.target.value)}
                rows={2}
                disabled={closing}
                placeholder="Ej. retiro entregado a administración"
                className="w-full bg-vimdy-surface border border-slate-800 rounded-xl px-4 py-2.5 text-white outline-none focus:border-amber-500/60 resize-none"
              />
            </div>
            <button
              type="submit"
              disabled={closing}
              className="w-full flex items-center justify-center gap-2 bg-amber-500 hover:bg-amber-400 disabled:opacity-60 text-slate-950 font-semibold rounded-xl px-4 py-3"
            >
              {closing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Lock className="w-4 h-4" />}
              Cerrar y conciliar caja
            </button>
          </form>
        </div>

        <div className="bg-vimdy-surface border border-slate-800 rounded-2xl p-6">
          <div className="flex items-center gap-2 mb-5">
            <Plus className="w-5 h-5 text-slate-300" />
            <div>
              <h3 className="font-semibold text-slate-100">Movimiento controlado</h3>
              <p className="text-xs text-slate-500">Cada entrada o salida queda clasificada y trazable.</p>
            </div>
          </div>
          <form onSubmit={handleMovement} className="space-y-4">
            <div className="grid grid-cols-2 gap-2">
              <button type="button" onClick={() => { setMovementType("OUT"); setMovementReason("EXPENSE"); }} className={`rounded-xl border px-3 py-2 text-sm ${movementType === "OUT" ? "border-red-500/40 bg-red-500/10 text-red-200" : "border-slate-800 text-slate-500"}`}>
                <Minus className="w-4 h-4 inline-block mr-1" /> Salida
              </button>
              <button type="button" onClick={() => { setMovementType("IN"); setMovementReason("CHANGE_FUND_IN"); }} className={`rounded-xl border px-3 py-2 text-sm ${movementType === "IN" ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-200" : "border-slate-800 text-slate-500"}`}>
                <Plus className="w-4 h-4 inline-block mr-1" /> Entrada
              </button>
            </div>
            <select value={movementReason} onChange={(event) => setMovementReason(event.target.value as CashMovementReasonCode)} className="w-full bg-vimdy-surface border border-slate-800 rounded-xl px-4 py-2.5 text-white">
              {reasons.map((reason) => <option key={reason.code} value={reason.code}>{reason.label}</option>)}
            </select>
            <input type="number" min={0.01} step="0.01" value={movementAmount} onChange={(event) => setMovementAmount(event.target.value)} placeholder="Monto" className="w-full bg-vimdy-surface border border-slate-800 rounded-xl px-4 py-2.5 text-white" required />
            <textarea value={movementDescription} onChange={(event) => setMovementDescription(event.target.value)} rows={3} placeholder="Descripción / motivo" className="w-full bg-vimdy-surface border border-slate-800 rounded-xl px-4 py-2.5 text-white resize-none" required />
            <button type="submit" disabled={moving} className="w-full flex items-center justify-center gap-2 bg-slate-100 hover:bg-white disabled:opacity-60 text-slate-950 font-semibold rounded-xl px-4 py-3">
              {moving ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
              Registrar movimiento
            </button>
          </form>
        </div>
      </div>

      {message && <div className="rounded-xl border border-slate-700 bg-slate-900/50 px-4 py-3 text-sm text-slate-300"><AlertTriangle className="w-4 h-4 inline-block mr-2" />{message}</div>}
      {closeResult && <div className="rounded-2xl border border-emerald-500/30 bg-emerald-500/10 p-5"><div className="flex items-start gap-3"><CheckCircle2 className="w-5 h-5 text-emerald-300 mt-0.5" /><div><p className="font-semibold text-emerald-200">Cierre conciliado.</p><p className="text-sm text-emerald-300/80 mt-1">Esperado {formatCOP(closeResult.expectedAmount)} · Contado {formatCOP(closeResult.countedAmount)} · Diferencia {formatCOP(closeResult.difference)}</p></div></div></div>}
    </div>
  );
}

function Metric(props: { label: string; value: string }) {
  return <div className="bg-vimdy-surface border border-slate-800 rounded-xl p-4"><p className="text-xs text-slate-500 mb-1">{props.label}</p><p className="text-lg font-bold text-slate-100">{props.value}</p></div>;
}