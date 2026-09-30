import React, { useState } from "react";
import { Loader2, Plus, ShieldCheck, Trash2 } from "lucide-react";

import type { CashRegister } from "../../../core/entities/Entities";
import { container } from "../../../infrastructure/di/CompositionRoot";
import { translateBusinessError } from "../../../core/errors/translateBusinessError";
import { getCurrentBranchId, getCurrentBusinessId } from "../../../infrastructure/supabase/supabaseClient";

export function CashRegisterManagementCard(props: {
  registers: CashRegister[];
  onChanged: () => Promise<void>;
}) {
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [saving, setSaving] = useState(false);
  const [actionId, setActionId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleCreate(event: React.FormEvent) {
    event.preventDefault();
    setError(null);

    const businessId = getCurrentBusinessId();
    const branchId = getCurrentBranchId();
    if (!businessId || !branchId) {
      setError("No hay una empresa o sucursal activa.");
      return;
    }

    setSaving(true);
    try {
      await container.cashRegisterEngine.get().create({
        businessId,
        branchId,
        name,
        code
      });
      setName("");
      setCode("");
      await props.onChanged();
    } catch (err) {
      setError(translateBusinessError(err, "No se pudo crear la caja física."));
    } finally {
      setSaving(false);
    }
  }

  async function handleDeactivate(register: CashRegister) {
    if (!window.confirm(`¿Desactivar ${register.name} (${register.code})? La caja no se borrará y su historial permanecerá intacto.`)) {
      return;
    }

    const businessId = getCurrentBusinessId();
    const branchId = getCurrentBranchId();
    if (!businessId || !branchId) {
      setError("No hay una empresa o sucursal activa.");
      return;
    }

    setError(null);
    setActionId(register.id);
    try {
      await container.cashRegisterEngine.get().deactivate(register.id, businessId, branchId);
      await props.onChanged();
    } catch (err) {
      setError(translateBusinessError(err, "No se pudo desactivar la caja física."));
    } finally {
      setActionId(null);
    }
  }

  return (
    <section className="bg-vimdy-surface border border-slate-800 rounded-2xl p-6">
      <div className="flex items-start justify-between gap-4 mb-5">
        <div>
          <div className="flex items-center gap-2 text-slate-100">
            <ShieldCheck className="w-5 h-5 text-cyan-400" />
            <h3 className="font-semibold">Cajas físicas</h3>
          </div>
          <p className="text-xs text-slate-500 mt-1">
            Administra las cajas de esta sucursal. Cada una puede tener su propio turno y su propio arqueo.
          </p>
        </div>
        <span className="text-xs text-slate-500">{props.registers.length} activas</span>
      </div>

      {error && (
        <div className="mb-4 rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">
          {error}
        </div>
      )}

      <div className="space-y-2 mb-5">
        {props.registers.map((register) => (
          <div
            key={register.id}
            className="flex items-center justify-between gap-3 rounded-xl border border-slate-800 bg-slate-950/30 px-3 py-3"
          >
            <div className="min-w-0">
              <p className="text-sm font-medium text-slate-100 truncate">{register.name}</p>
              <p className="text-xs text-slate-500">Código: {register.code}</p>
            </div>
            <button
              type="button"
              onClick={() => void handleDeactivate(register)}
              disabled={props.registers.length <= 1 || actionId === register.id}
              title={props.registers.length <= 1 ? "Debe quedar al menos una caja activa." : "Desactivar caja"}
              className="inline-flex items-center justify-center rounded-lg border border-red-500/30 px-2.5 py-2 text-red-300 hover:bg-red-500/10 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {actionId === register.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
            </button>
          </div>
        ))}
      </div>

      <form onSubmit={handleCreate} className="grid grid-cols-1 sm:grid-cols-[1fr_140px_auto] gap-2">
        <input
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="Nombre de la nueva caja"
          className="bg-vimdy-surface border border-slate-800 rounded-xl px-3 py-2.5 text-sm text-white outline-none focus:border-cyan-500/60"
          disabled={saving}
          required
        />
        <input
          value={code}
          onChange={(event) => setCode(event.target.value.toUpperCase())}
          placeholder="CAJA-02"
          maxLength={32}
          className="bg-vimdy-surface border border-slate-800 rounded-xl px-3 py-2.5 text-sm text-white uppercase outline-none focus:border-cyan-500/60"
          disabled={saving}
          required
        />
        <button
          type="submit"
          disabled={saving}
          className="inline-flex items-center justify-center gap-2 rounded-xl bg-cyan-400 px-4 py-2.5 text-sm font-semibold text-slate-950 hover:bg-cyan-300 disabled:opacity-60"
        >
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
          Crear caja
        </button>
      </form>
    </section>
  );
}
