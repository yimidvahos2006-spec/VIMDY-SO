import React, { useEffect, useMemo, useState } from "react";
import { ArrowRightLeft, Loader2, ShieldCheck } from "lucide-react";
import type { CashRegister, Shift } from "../../../core/entities/Entities";
import { enterpriseCashService } from "../../../infrastructure/caja/enterpriseCashService";
import { translateBusinessError } from "../../../core/errors/translateBusinessError";

function formatCOP(amount: number): string {
  return `$${Math.round(amount).toLocaleString("es-CO")}`;
}

export function CashRegisterTransferCard(props: {
  registers: CashRegister[];
  currentShift: Shift;
  currentRole?: string;
  onChanged: () => Promise<void>;
}) {
  const [destinationRegisterId, setDestinationRegisterId] = useState("");
  const [destinationShiftId, setDestinationShiftId] = useState("");
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [loadingShifts, setLoadingShifts] = useState(true);
  const [message, setMessage] = useState<string | null>(null);
  const [openShifts, setOpenShifts] = useState<Array<{ id: string; cashRegisterId: string; cashierId: string; openedAt: Date }>>([]);

  const availableDestinations = useMemo(
    () => props.registers.filter((register) => register.id !== props.currentShift.cashRegisterId && register.active),
    [props.registers, props.currentShift.cashRegisterId],
  );

  const destinationShifts = useMemo(
    () => openShifts.filter((shift) => shift.cashRegisterId === destinationRegisterId),
    [openShifts, destinationRegisterId],
  );

  useEffect(() => {
    if (props.currentRole !== "ADMIN" && props.currentRole !== "GERENTE") return;
    setLoadingShifts(true);
    void enterpriseCashService.listOpenShifts()
      .then(setOpenShifts)
      .catch((error) => setMessage(translateBusinessError(error, "No se pudieron cargar los turnos destino.")))
      .finally(() => setLoadingShifts(false));
  }, [props.currentRole, props.currentShift.id, props.registers.length]);

  if (props.currentRole !== "ADMIN" && props.currentRole !== "GERENTE") return null;
  if (!props.currentShift.cashRegisterId || availableDestinations.length === 0) return null;
  const fromCashRegisterId = props.currentShift.cashRegisterId;

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setMessage(null);
    const numericAmount = Number(amount);
    if (!destinationRegisterId || !destinationShiftId) {
      setMessage("Selecciona la caja destino y el turno abierto.");
      return;
    }
    if (!Number.isFinite(numericAmount) || numericAmount <= 0) {
      setMessage("El monto debe ser mayor a cero.");
      return;
    }
    if (!reason.trim()) {
      setMessage("Escribe el motivo de la transferencia.");
      return;
    }
    setSubmitting(true);
    try {
      const result = await enterpriseCashService.transferBetweenRegisters({
        fromCashRegisterId,
        toCashRegisterId: destinationRegisterId,
        fromShiftId: props.currentShift.id,
        toShiftId: destinationShiftId,
        amount: numericAmount,
        reason,
      });
      setMessage(`Transferencia registrada por ${formatCOP(result.amount)}.`);
      setAmount("");
      setReason("");
      await props.onChanged();
    } catch (error) {
      setMessage(translateBusinessError(error, "No se pudo transferir efectivo."));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="bg-vimdy-surface border border-slate-800 rounded-2xl p-6">
      <div className="flex items-start gap-3 mb-5">
        <div className="p-2 rounded-xl bg-slate-800"><ArrowRightLeft className="w-5 h-5 text-slate-200" /></div>
        <div><h3 className="font-semibold text-slate-100">Transferir efectivo entre cajas</h3><p className="text-xs text-slate-500 mt-1">Solo administración o gerencia. Ambas cajas deben tener turno abierto.</p></div>
        <ShieldCheck className="w-4 h-4 text-emerald-400 ml-auto" />
      </div>
      <form onSubmit={submit} className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <select value={destinationRegisterId} onChange={(event) => { setDestinationRegisterId(event.target.value); setDestinationShiftId(""); }} disabled={loadingShifts} className="bg-vimdy-surface border border-slate-800 rounded-xl px-4 py-2.5 text-white">
          <option value="">Caja destino</option>
          {availableDestinations.map((register) => <option key={register.id} value={register.id}>{register.name} · {register.code}</option>)}
        </select>
        <select value={destinationShiftId} onChange={(event) => setDestinationShiftId(event.target.value)} disabled={loadingShifts || destinationShifts.length === 0} className="bg-vimdy-surface border border-slate-800 rounded-xl px-4 py-2.5 text-white">
          <option value="">Turno destino abierto</option>
          {destinationShifts.map((shift) => <option key={shift.id} value={shift.id}>{shift.id.slice(0, 8)} · {new Date(shift.openedAt).toLocaleTimeString("es-CO")}</option>)}
        </select>
        <input type="number" min={0.01} step="0.01" value={amount} onChange={(event) => setAmount(event.target.value)} placeholder="Monto" className="bg-vimdy-surface border border-slate-800 rounded-xl px-4 py-2.5 text-white" required />
        <input value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Motivo" className="bg-vimdy-surface border border-slate-800 rounded-xl px-4 py-2.5 text-white" required />
        <button type="submit" disabled={submitting || loadingShifts || destinationShifts.length === 0} className="md:col-span-2 inline-flex items-center justify-center gap-2 bg-slate-100 hover:bg-white disabled:opacity-60 text-slate-950 font-semibold rounded-xl px-4 py-3">
          {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <ArrowRightLeft className="w-4 h-4" />} Transferir efectivo
        </button>
      </form>
      {message && <p className="text-sm text-slate-400 mt-3">{message}</p>}
    </div>
  );
}