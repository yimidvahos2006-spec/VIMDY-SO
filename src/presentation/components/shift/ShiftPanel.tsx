import { useCallback, useEffect, useState } from "react";
import type { FormEvent } from "react";
import { AlertTriangle, CheckCircle2, History, Loader2, Lock, Unlock } from "lucide-react";

import type { Shift, CashRegister } from "../../../core/entities/Entities";
import { container } from "../../../infrastructure/di/CompositionRoot";
import { useAuth } from "../../context/AuthContext";
import { notificationStore } from "../../../core/store/notificationStore";
import { translateBusinessError } from "../../../core/errors/translateBusinessError";
import { dailyReportDeliveryService } from "../../../infrastructure/supabase/dailyReportDeliveryService";
import { cashRegisterStore } from "../../../core/store/cashRegisterStore";
import {
  getCurrentBusinessId,
  getCurrentBranchId,
} from "../../../infrastructure/supabase/supabaseClient";
import { CashRegisterManagementCard } from "./CashRegisterManagementCard";
import { EnterpriseCashControls } from "./EnterpriseCashControls";
import { CashRegisterTransferCard } from "./CashRegisterTransferCard";
import { SalesHistoryPanel } from "./SalesHistoryPanel";

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

type CloseResult = {
  expectedAmount: number;
  countedAmount: number;
  difference: number;
};

/**
 * Pantalla empresarial de apertura/cierre de caja.
 *
 * Seguridad importante:
 * - La resolución del turno siempre lleva negocio + sucursal implícitos del
 *   contexto y, cuando existe sesión, también user.id y caja seleccionada.
 * - No se adopta silenciosamente un turno legado sin cashRegisterId.
 * - El cierre físico se hace únicamente mediante el flujo Enterprise V4.
 */
export function ShiftPanel() {
  const { user, role } = useAuth();
  const [loading, setLoading] = useState(true);
  const [summary, setSummary] = useState<ShiftSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const [openingAmount, setOpeningAmount] = useState("");
  const [openingNotes, setOpeningNotes] = useState("");
  const [opening, setOpening] = useState(false);
  const [openResult, setOpenResult] = useState<{ shift: Shift; amount: number } | null>(null);
  const [closeResult, setCloseResult] = useState<CloseResult | null>(null);
  const [registers, setRegisters] = useState<CashRegister[]>([]);
  const [cashRegisterId, setCashRegisterId] = useState<string>(cashRegisterStore.getSelectedId() ?? "");

  const refresh = useCallback(async () => {
    if (!user) {
      setSummary(null);
      setLoading(false);
      return;
    }

    try {
      setError(null);
      const businessId = getCurrentBusinessId();
      const branchId = getCurrentBranchId();

      if (!businessId || !branchId) {
        throw new Error("NO_BUSINESS_CONTEXT");
      }

      const loadedRegisters = await container.cashRegisterEngine.get().listActive(businessId, branchId);
      setRegisters(loadedRegisters);

      let selectedRegisterId = cashRegisterId || cashRegisterStore.getSelectedId() || "";
      if (!selectedRegisterId && loadedRegisters.length === 1) {
        selectedRegisterId = loadedRegisters[0].id;
        setCashRegisterId(selectedRegisterId);
        cashRegisterStore.setSelected(businessId, branchId, selectedRegisterId);
      }

      // CRÍTICO: nunca resolver el turno actual sin el usuario autenticado.
      // Si hay una caja seleccionada, también se exige esa caja exacta.
      const current = await container.shiftEngine.get().getCurrentShift(
        user.id,
        selectedRegisterId || undefined,
      );

      if (!current) {
        setSummary(null);
        setLoading(false);
        return;
      }

      if (!current.cashRegisterId) {
        throw new Error("CAJA_CASH_REGISTER_REQUIRED_FOR_CLOSE");
      }

      if (selectedRegisterId && current.cashRegisterId !== selectedRegisterId) {
        throw new Error("SHIFT_REGISTER_CONTEXT_MISMATCH");
      }

      if (current.cashRegisterId !== cashRegisterId) {
        setCashRegisterId(current.cashRegisterId);
        cashRegisterStore.setSelected(businessId, branchId, current.cashRegisterId);
      }

      const shiftSummary = await container.shiftEngine.get().getShiftSummary(current.id);
      setSummary(shiftSummary);
    } catch (err) {
      setError(translateBusinessError(err, "Error cargando el turno."));
      setSummary(null);
    } finally {
      setLoading(false);
    }
  }, [cashRegisterId, user]);

  useEffect(() => {
    void refresh();
    const interval = window.setInterval(() => void refresh(), 4000);
    return () => window.clearInterval(interval);
  }, [refresh]);

  async function handleOpenShift(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setCloseResult(null);
    setOpenResult(null);

    if (!user) {
      setError("No hay una sesión activa.");
      return;
    }

    const amount = Number(openingAmount);
    if (!Number.isFinite(amount) || amount < 0) {
      setError("El fondo inicial debe ser un número válido.");
      return;
    }

    const businessId = getCurrentBusinessId();
    const branchId = getCurrentBranchId();
    if (!businessId || !branchId) {
      setError("Selecciona un negocio y una sucursal antes de abrir caja.");
      return;
    }

    setOpening(true);
    try {
      if (cashRegisterId) {
        cashRegisterStore.setSelected(businessId, branchId, cashRegisterId);
      }

      const opened = await container.shiftEngine.get().openShift(
        user.id,
        amount,
        openingNotes.trim() || undefined,
        cashRegisterId || undefined,
      );

      notificationStore.addCashOpen(
        `${user.name} abrió turno con fondo inicial de ${formatCOP(amount)}.`,
        `CAJA_ABIERTA:${user.id}:${opened.id}`,
      );

      setOpenResult({ shift: opened, amount });
      setOpeningAmount("");
      setOpeningNotes("");
      if (opened.cashRegisterId) {
        setCashRegisterId(opened.cashRegisterId);
        cashRegisterStore.setSelected(businessId, branchId, opened.cashRegisterId);
      }
      await refresh();
    } catch (err) {
      setError(translateBusinessError(err, "No se pudo abrir el turno."));
    } finally {
      setOpening(false);
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
            <p className="font-semibold">Turno cerrado y conciliado.</p>
            <p className="text-emerald-400/80 mt-1">
              Esperado: {formatCOP(closeResult.expectedAmount)} · Contado: {formatCOP(closeResult.countedAmount)} · Diferencia:{" "}
              <span className={closeResult.difference < 0 ? "text-red-400" : "text-emerald-300"}>
                {formatCOP(closeResult.difference)}
              </span>
            </p>
            <p className="text-emerald-400/60 mt-1 text-xs">
              VIMDY dejó programado el reporte de cierre y lo enviará por los canales configurados.
            </p>
          </div>
        </div>
      )}

      {openResult && (
        <div className="flex items-start gap-3 bg-emerald-500/10 border border-emerald-500/30 text-emerald-300 rounded-xl px-4 py-3 text-sm">
          <CheckCircle2 className="w-5 h-5 shrink-0 mt-0.5" />
          <div>
            <p className="font-semibold">Turno abierto correctamente.</p>
            <p className="text-emerald-400/80 mt-1">Fondo inicial: {formatCOP(openResult.amount)}</p>
          </div>
        </div>
      )}

      {role?.name === "ADMIN" && registers.length > 0 && (
        <CashRegisterManagementCard registers={registers} onChanged={refresh} />
      )}

      {!summary ? (
        <OpenShiftForm
          amount={openingAmount}
          notes={openingNotes}
          onAmountChange={setOpeningAmount}
          onNotesChange={setOpeningNotes}
          onSubmit={handleOpenShift}
          submitting={opening}
          registers={registers}
          cashRegisterId={cashRegisterId}
          onCashRegisterChange={(value) => {
            setCashRegisterId(value);
            setOpenResult(null);
            const businessId = getCurrentBusinessId();
            const branchId = getCurrentBranchId();
            if (businessId && branchId && value) {
              cashRegisterStore.setSelected(businessId, branchId, value);
            }
          }}
        />
      ) : (
        <>
          <EnterpriseCashControls
            shift={summary.shift}
            totalCashIncome={summary.totalCashIncome}
            totalExpense={summary.totalExpense}
            onClosed={async (_shiftData, result) => {
              const businessId = getCurrentBusinessId();
              const branchId = getCurrentBranchId();
              setCloseResult(result);

              if (businessId && branchId) {
                // La creación del job ya ocurrió dentro de close_shift_atomic().
                // Este kick solo acelera el envío cuando hay conexión.
                await dailyReportDeliveryService.kick({
                  businessId,
                  branchId,
                  shiftId: summary.shift.id,
                });
              }
            }}
            onRefresh={refresh}
          />

          <CashRegisterTransferCard
            registers={registers}
            currentShift={summary.shift}
            currentRole={role?.name}
            onChanged={refresh}
          />
        </>
      )}

      <button
        type="button"
        onClick={() => setShowHistory((value) => !value)}
        className="inline-flex items-center gap-2 text-slate-400 hover:text-slate-200 text-sm transition-colors"
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
  onAmountChange: (value: string) => void;
  onNotesChange: (value: string) => void;
  onSubmit: (event: FormEvent) => void;
  submitting: boolean;
  registers: CashRegister[];
  cashRegisterId: string;
  onCashRegisterChange: (value: string) => void;
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
        {props.registers.length > 1 && (
          <div>
            <label className="text-xs text-slate-400 block mb-1">Caja física</label>
            <select
              value={props.cashRegisterId}
              onChange={(event) => props.onCashRegisterChange(event.target.value)}
              className="w-full bg-vimdy-surface border border-slate-800 rounded-xl px-4 py-2.5 text-white outline-none focus:border-emerald-500/60"
              required
            >
              <option value="">Selecciona una caja</option>
              {props.registers.map((register) => (
                <option key={register.id} value={register.id}>
                  {register.name} · {register.code}
                </option>
              ))}
            </select>
          </div>
        )}

        <div>
          <label className="text-xs text-slate-400 block mb-1">Fondo inicial</label>
          <input
            type="number"
            min={0}
            step="0.01"
            value={props.amount}
            onChange={(event) => props.onAmountChange(event.target.value)}
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
            onChange={(event) => props.onNotesChange(event.target.value)}
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