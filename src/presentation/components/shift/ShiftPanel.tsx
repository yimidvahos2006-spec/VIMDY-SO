import React, { useCallback, useEffect, useState } from "react";
import {
  Loader2,
  Lock,
  Unlock,
  Wallet,
  TrendingUp,
  TrendingDown,
  AlertTriangle,
  CheckCircle2,
  History
} from "lucide-react";

import { container } from "../../../infrastructure/di/CompositionRoot";
import { useAuth } from "../../context/AuthContext";
import type { Shift } from "../../../core/entities/Entities";
import { SalesHistoryPanel } from "./SalesHistoryPanel";
import { notificationStore } from "../../../core/store/notificationStore";
import { translateBusinessError } from "../../../core/errors/translateBusinessError";

function formatCOP(amount: number): string {
  return `$${Math.round(amount).toLocaleString("es-CO")}`;
}

type ShiftSummary = {
  shift: Shift;
  totalIncome: number;
  totalExpense: number;
  totalCashIncome: number;
  incomeByMethod: Record<string, number>;
  expectedAmount: number;
};

const PAYMENT_METHOD_LABELS: Record<string, string> = {
  CARD: "Tarjeta",
  TRANSFER: "Transferencia",
  QR: "QR",
  MIXED: "Mixto (parte tarjeta/transferencia)"
};

/**
 * Pantalla real de apertura/cierre/arqueo de turno.
 * Reemplaza el CashModule anterior (que leía de cashRegisterStore, un
 * store falso desconectado de las ventas). Todo aquí lee y escribe
 * directamente sobre container.shiftEngine / container.cashEngine, que
 * son los mismos motores que SalesEngine usa al cobrar en el POS.
 */
export function ShiftPanel() {
  const { user } = useAuth();

  const [loading, setLoading] = useState(true);
  const [summary, setSummary] = useState<ShiftSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showHistory, setShowHistory] = useState(false);

  const [openingAmount, setOpeningAmount] = useState("");
  const [openingNotes, setOpeningNotes] = useState("");
  const [opening, setOpening] = useState(false);

  const [countedAmount, setCountedAmount] = useState("");
  const [closingNotes, setClosingNotes] = useState("");
  const [closing, setClosing] = useState(false);
  const [closeResult, setCloseResult] = useState<Shift | null>(null);

  const [movementType, setMovementType] = useState<"OUT" | "IN">("OUT");
  const [movementAmount, setMovementAmount] = useState("");
  const [movementReason, setMovementReason] = useState("");
  const [registeringMovement, setRegisteringMovement] = useState(false);
  const [showMovementForm, setShowMovementForm] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const current = await container.shiftEngine.getCurrentShift();

      if (!current) {
        setSummary(null);
        setLoading(false);
        return;
      }

      const shiftSummary = await container.shiftEngine.getShiftSummary(current.id);
      setSummary(shiftSummary);
      setLoading(false);
    } catch (err) {
      setError(translateBusinessError(err, "Error cargando el turno."));
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();

    // El turno no emite eventos por cada venta (SalesEngine solo llama
    // CashEngine.registerIncome directamente), así que refrescamos por
    // polling mientras haya un turno abierto para que lo esperado en
    // caja se mantenga al día con lo que se está vendiendo en POS.
    const interval = setInterval(refresh, 4000);
    return () => clearInterval(interval);
  }, [refresh]);

  async function handleOpenShift(event: React.FormEvent) {
    event.preventDefault();
    setError(null);

    const amount = Number(openingAmount);

    if (!user) {
      setError("No hay una sesión activa.");
      return;
    }

    if (Number.isNaN(amount) || amount < 0) {
      setError("El fondo inicial debe ser un número válido.");
      return;
    }

    setOpening(true);

    try {
      await container.shiftEngine.openShift(user.id, amount, openingNotes || undefined);
      notificationStore.addCashOpen(
        `${user.name} abrió turno con fondo inicial de ${formatCOP(amount)}.`,
        `CAJA_ABIERTA:${user.id}:${Date.now()}`
      );
      setOpeningAmount("");
      setOpeningNotes("");
      await refresh();
    } catch (err) {
      setError(translateBusinessError(err, "No se pudo abrir el turno."));
    } finally {
      setOpening(false);
    }
  }

  async function handleCloseShift(event: React.FormEvent) {
    event.preventDefault();
    setError(null);

    if (!summary) return;

    const counted = Number(countedAmount);

    if (Number.isNaN(counted) || counted < 0) {
      setError("El monto contado debe ser un número válido.");
      return;
    }

    setClosing(true);

    try {
      const closed = await container.shiftEngine.closeShift(
        summary.shift.id,
        counted,
        closingNotes || undefined
      );
      setCloseResult(closed);
      setCountedAmount("");
      setClosingNotes("");
      await refresh();
    } catch (err) {
      setError(translateBusinessError(err, "No se pudo cerrar el turno."));
    } finally {
      setClosing(false);
    }
  }

  async function handleRegisterMovement(event: React.FormEvent) {
    event.preventDefault();
    setError(null);

    const amount = Number(movementAmount);

    if (Number.isNaN(amount) || amount <= 0) {
      setError("El monto del movimiento debe ser mayor a cero.");
      return;
    }

    if (!movementReason.trim()) {
      setError("Escribe el motivo del movimiento (ej: retiro para el banco, compra de insumos).");
      return;
    }

    setRegisteringMovement(true);

    try {
      if (movementType === "OUT") {
        await container.cashEngine.registerExpense(amount, movementReason.trim());
      } else {
        await container.cashEngine.registerIncome(amount, movementReason.trim(), "CASH");
      }
      setMovementAmount("");
      setMovementReason("");
      setShowMovementForm(false);
      await refresh();
    } catch (err) {
      setError(translateBusinessError(err, "No se pudo registrar el movimiento."));
    } finally {
      setRegisteringMovement(false);
    }
  }

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center text-slate-400">
        <Loader2 className="w-6 h-6 animate-spin mr-2" />
        Cargando turno...
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto p-6 space-y-6">
      {error && (
        <div className="flex items-center gap-2 bg-red-500/10 border border-red-500/30 text-red-400 rounded-xl px-4 py-3 text-sm">
          <AlertTriangle className="w-4 h-4 shrink-0" />
          {error}
        </div>
      )}

      {closeResult && (
        <div className="flex items-start gap-3 bg-emerald-500/10 border border-emerald-500/30 text-emerald-300 rounded-xl px-4 py-3 text-sm">
          <CheckCircle2 className="w-5 h-5 shrink-0 mt-0.5" />
          <div>
            <p className="font-semibold">Turno cerrado correctamente.</p>
            <p className="text-emerald-400/80 mt-1">
              Esperado: {formatCOP(closeResult.expectedAmount ?? 0)} · Contado:{" "}
              {formatCOP(closeResult.countedAmount ?? 0)} · Diferencia:{" "}
              <span className={(closeResult.difference ?? 0) < 0 ? "text-red-400" : "text-emerald-300"}>
                {formatCOP(closeResult.difference ?? 0)}
              </span>
            </p>
          </div>
        </div>
      )}

      {!summary ? (
        <OpenShiftForm
          amount={openingAmount}
          notes={openingNotes}
          onAmountChange={setOpeningAmount}
          onNotesChange={setOpeningNotes}
          onSubmit={handleOpenShift}
          submitting={opening}
        />
      ) : (
        <>
          <OpenShiftSummaryView
            summary={summary}
            countedAmount={countedAmount}
            closingNotes={closingNotes}
            onCountedChange={setCountedAmount}
            onNotesChange={setClosingNotes}
            onSubmit={handleCloseShift}
            submitting={closing}
          />

          <ManualMovementCard
            show={showMovementForm}
            onToggle={() => setShowMovementForm((v) => !v)}
            type={movementType}
            amount={movementAmount}
            reason={movementReason}
            onTypeChange={setMovementType}
            onAmountChange={setMovementAmount}
            onReasonChange={setMovementReason}
            onSubmit={handleRegisterMovement}
            submitting={registeringMovement}
          />
        </>
      )}

      <button
        onClick={() => setShowHistory((v) => !v)}
        className="flex items-center gap-2 text-slate-400 hover:text-slate-200 text-sm transition-colors"
      >
        <History className="w-4 h-4" />
        {showHistory ? "Ocultar historial de turnos" : "Ver historial de turnos"}
      </button>

      {showHistory && <SalesHistoryPanel />}
    </div>
  );
}

function OpenShiftForm(props: {
  amount: string;
  notes: string;
  onAmountChange: (v: string) => void;
  onNotesChange: (v: string) => void;
  onSubmit: (e: React.FormEvent) => void;
  submitting: boolean;
}) {
  return (
    <div className="bg-vimdy-surface border border-slate-800 rounded-2xl p-6 max-w-md">
      <div className="flex items-center gap-2 text-slate-200 mb-1">
        <Lock className="w-5 h-5 text-amber-400" />
        <h2 className="text-lg font-semibold">La caja está cerrada</h2>
      </div>
      <p className="text-slate-500 text-sm mb-5">
        Abre un turno con el fondo inicial en efectivo para empezar a vender.
      </p>

      <form onSubmit={props.onSubmit} className="space-y-4">
        <div>
          <label className="text-xs text-slate-400 block mb-1">Fondo inicial</label>
          <input
            type="number"
            min={0}
            step="0.01"
            value={props.amount}
            onChange={(e) => props.onAmountChange(e.target.value)}
            placeholder="0"
            className="w-full bg-vimdy-surface border border-slate-800 rounded-xl px-4 py-2.5 text-white outline-none focus:border-emerald-500/60"
            required
          />
        </div>

        <div>
          <label className="text-xs text-slate-400 block mb-1">Notas (opcional)</label>
          <input
            type="text"
            value={props.notes}
            onChange={(e) => props.onNotesChange(e.target.value)}
            placeholder="Ej: turno de la mañana"
            className="w-full bg-vimdy-surface border border-slate-800 rounded-xl px-4 py-2.5 text-white outline-none focus:border-emerald-500/60"
          />
        </div>

        <button
          type="submit"
          disabled={props.submitting}
          className="w-full flex items-center justify-center gap-2 bg-emerald-500 hover:bg-emerald-400 disabled:opacity-60 text-slate-950 font-semibold rounded-xl px-4 py-2.5 transition-colors"
        >
          {props.submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Unlock className="w-4 h-4" />}
          Abrir turno
        </button>
      </form>
    </div>
  );
}

function OpenShiftSummaryView(props: {
  summary: ShiftSummary;
  countedAmount: string;
  closingNotes: string;
  onCountedChange: (v: string) => void;
  onNotesChange: (v: string) => void;
  onSubmit: (e: React.FormEvent) => void;
  submitting: boolean;
}) {
  const { summary } = props;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[1fr_360px] gap-6">
      {/* Resumen en vivo */}
      <div className="bg-vimdy-surface border border-slate-800 rounded-2xl p-6">
        <div className="flex items-center justify-between mb-5">
          <div className="flex items-center gap-2 text-emerald-400">
            <Unlock className="w-5 h-5" />
            <h2 className="text-lg font-semibold text-slate-100">Turno abierto</h2>
          </div>
          <span className="text-xs text-slate-500">
            Desde {new Date(summary.shift.openedAt).toLocaleTimeString("es-CO")}
          </span>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <StatCard
            icon={<Wallet className="w-4 h-4 text-slate-400" />}
            label="Fondo inicial"
            value={formatCOP(summary.shift.openingAmount)}
          />
          <StatCard
            icon={<TrendingUp className="w-4 h-4 text-emerald-400" />}
            label="Ventas en efectivo"
            value={formatCOP(summary.totalCashIncome)}
            tone="emerald"
          />
          <StatCard
            icon={<TrendingDown className="w-4 h-4 text-red-400" />}
            label="Egresos / retiros"
            value={formatCOP(summary.totalExpense)}
            tone="red"
          />
          <StatCard
            icon={<Wallet className="w-4 h-4 text-cyan-400" />}
            label="Esperado en caja"
            value={formatCOP(summary.expectedAmount)}
            tone="cyan"
          />
        </div>

        {Object.entries(summary.incomeByMethod).filter(([method]) => method !== "CASH").length > 0 && (
          <div className="mt-4 pt-4 border-t border-slate-800">
            <p className="text-xs text-slate-500 mb-2">
              Otras ventas del turno (no cuentan para el efectivo del cajón):
            </p>
            <div className="flex flex-wrap gap-2">
              {Object.entries(summary.incomeByMethod)
                .filter(([method]) => method !== "CASH")
                .map(([method, amount]) => (
                  <span
                    key={method}
                    className="text-xs px-2.5 py-1 rounded-lg bg-slate-800/70 border border-slate-700 text-slate-300"
                  >
                    {PAYMENT_METHOD_LABELS[method] ?? method}: {formatCOP(amount)}
                  </span>
                ))}
            </div>
          </div>
        )}

        {summary.shift.openingNotes && (
          <p className="text-xs text-slate-500 mt-4">Nota de apertura: {summary.shift.openingNotes}</p>
        )}

        <p className="text-xs text-slate-600 mt-4">
          Estos números se actualizan automáticamente con cada venta cobrada en Venta rápida. Solo el
          efectivo cuenta para "Esperado en caja" — tarjeta, transferencia y QR no pasan por el cajón.
        </p>
      </div>

      {/* Cierre de turno */}
      <div className="bg-vimdy-surface border border-slate-800 rounded-2xl p-6 h-fit">
        <div className="flex items-center gap-2 text-slate-200 mb-4">
          <Lock className="w-5 h-5 text-amber-400" />
          <h3 className="font-semibold">Cerrar turno</h3>
        </div>

        <form onSubmit={props.onSubmit} className="space-y-4">
          <div>
            <label className="text-xs text-slate-400 block mb-1">Monto contado en caja</label>
            <input
              type="number"
              min={0}
              step="0.01"
              value={props.countedAmount}
              onChange={(e) => props.onCountedChange(e.target.value)}
              placeholder="0"
              className="w-full bg-vimdy-surface border border-slate-800 rounded-xl px-4 py-2.5 text-white outline-none focus:border-amber-500/60"
              required
            />
          </div>

          <div>
            <label className="text-xs text-slate-400 block mb-1">Notas de cierre (opcional)</label>
            <input
              type="text"
              value={props.closingNotes}
              onChange={(e) => props.onNotesChange(e.target.value)}
              className="w-full bg-vimdy-surface border border-slate-800 rounded-xl px-4 py-2.5 text-white outline-none focus:border-amber-500/60"
            />
          </div>

          <button
            type="submit"
            disabled={props.submitting}
            className="w-full flex items-center justify-center gap-2 bg-amber-500 hover:bg-amber-400 disabled:opacity-60 text-slate-950 font-semibold rounded-xl px-4 py-2.5 transition-colors"
          >
            {props.submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Lock className="w-4 h-4" />}
            Cerrar turno
          </button>
        </form>
      </div>
    </div>
  );
}

function ManualMovementCard(props: {
  show: boolean;
  onToggle: () => void;
  type: "OUT" | "IN";
  amount: string;
  reason: string;
  onTypeChange: (v: "OUT" | "IN") => void;
  onAmountChange: (v: string) => void;
  onReasonChange: (v: string) => void;
  onSubmit: (e: React.FormEvent) => void;
  submitting: boolean;
}) {
  if (!props.show) {
    return (
      <button
        onClick={props.onToggle}
        className="flex items-center gap-2 text-slate-400 hover:text-slate-200 text-sm transition-colors"
      >
        <Wallet className="w-4 h-4" />
        Registrar retiro o ingreso manual de efectivo
      </button>
    );
  }

  return (
    <div className="bg-vimdy-surface border border-slate-800 rounded-2xl p-6 max-w-md">
      <div className="flex items-center justify-between mb-4">
        <h3 className="font-semibold text-slate-200">Movimiento manual de efectivo</h3>
        <button onClick={props.onToggle} className="text-xs text-slate-500 hover:text-slate-300">
          Cancelar
        </button>
      </div>

      <form onSubmit={props.onSubmit} className="space-y-4">
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => props.onTypeChange("OUT")}
            className={`flex-1 rounded-xl px-4 py-2 text-sm font-medium border ${
              props.type === "OUT"
                ? "bg-red-500/10 border-red-500/40 text-red-300"
                : "border-slate-800 text-slate-500"
            }`}
          >
            Retiro / gasto
          </button>
          <button
            type="button"
            onClick={() => props.onTypeChange("IN")}
            className={`flex-1 rounded-xl px-4 py-2 text-sm font-medium border ${
              props.type === "IN"
                ? "bg-emerald-500/10 border-emerald-500/40 text-emerald-300"
                : "border-slate-800 text-slate-500"
            }`}
          >
            Ingreso extra
          </button>
        </div>

        <div>
          <label className="text-xs text-slate-400 block mb-1">Monto</label>
          <input
            type="number"
            min={0}
            step="0.01"
            value={props.amount}
            onChange={(e) => props.onAmountChange(e.target.value)}
            placeholder="0"
            className="w-full bg-vimdy-surface border border-slate-800 rounded-xl px-4 py-2.5 text-white outline-none focus:border-emerald-500/60"
            required
          />
        </div>

        <div>
          <label className="text-xs text-slate-400 block mb-1">Motivo (obligatorio)</label>
          <input
            type="text"
            value={props.reason}
            onChange={(e) => props.onReasonChange(e.target.value)}
            placeholder="Ej: retiro para el banco, compra de hielo"
            className="w-full bg-vimdy-surface border border-slate-800 rounded-xl px-4 py-2.5 text-white outline-none focus:border-emerald-500/60"
            required
          />
        </div>

        <button
          type="submit"
          disabled={props.submitting}
          className="w-full flex items-center justify-center gap-2 bg-slate-100 hover:bg-white disabled:opacity-60 text-slate-950 font-semibold rounded-xl px-4 py-2.5 transition-colors"
        >
          {props.submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
          Registrar movimiento
        </button>
      </form>
    </div>
  );
}

function StatCard(props: { icon: React.ReactNode; label: string; value: string; tone?: "emerald" | "red" | "cyan" }) {
  const toneClass =
    props.tone === "emerald"
      ? "text-emerald-400"
      : props.tone === "red"
      ? "text-red-400"
      : props.tone === "cyan"
      ? "text-cyan-400"
      : "text-slate-100";

  return (
    <div className="bg-vimdy-surface border border-slate-800 rounded-xl p-4">
      <div className="flex items-center gap-2 text-slate-500 text-xs mb-2">
        {props.icon}
        {props.label}
      </div>
      <p className={`text-xl font-bold ${toneClass}`}>{props.value}</p>
    </div>
  );
}