import React, { useEffect, useState } from "react";
import { Plus, Pencil, Ban, RotateCcw, Trash2, MapPin, Phone, Building2 } from "lucide-react";

import { getCurrentBusinessId, getBranches, createBranch, updateBranch, deleteBranch } from "../../../infrastructure/supabase/supabaseClient";
import { VimdyButton } from "../ui/VimdyButton";

const inputClass =
  "w-full h-10 rounded-xl bg-vimdy-surface border border-slate-700 px-3 text-white text-sm outline-none focus:border-cyan-500";

export function BranchManager() {
  const [branches, setBranches] = useState<
    Array<{
      id: string;
      name: string;
      address: string | null;
      phone: string | null;
      is_main: boolean;
      active: boolean;
    }>
  >([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  const [name, setName] = useState("");
  const [address, setAddress] = useState("");
  const [phone, setPhone] = useState("");

  const businessId = getCurrentBusinessId();

  async function reload() {
    if (!businessId) return;
    const all = await getBranches(businessId);
    setBranches(all);
    setLoading(false);
  }

  useEffect(() => {
    reload();
  }, [businessId]);

  function resetForm() {
    setName("");
    setAddress("");
    setPhone("");
    setEditingId(null);
    setShowForm(false);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || !businessId || saving) return;

    setSaving(true);
    setError(null);
    try {
      if (editingId) {
        await updateBranch(editingId, { name: name.trim(), address, phone });
      } else {
        await createBranch(businessId, { name: name.trim(), address, phone, is_main: branches.length === 0 });
      }
      resetForm();
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo guardar la sucursal.");
    } finally {
      setSaving(false);
    }
  }

  function startEdit(branch: { id: string; name: string; address: string | null; phone: string | null }) {
    setEditingId(branch.id);
    setName(branch.name);
    setAddress(branch.address ?? "");
    setPhone(branch.phone ?? "");
    setShowForm(true);
  }

  async function toggleActive(branch: { id: string; active: boolean }) {
    setBusyId(branch.id);
    setError(null);
    try {
      await updateBranch(branch.id, { active: !branch.active });
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo actualizar la sucursal.");
    } finally {
      setBusyId(null);
    }
  }

  async function handleDelete(branch: { id: string; is_main: boolean; name: string }) {
    if (branch.is_main) {
      setError("No se puede eliminar la sucursal principal.");
      return;
    }
    if (!window.confirm(`¿Eliminar la sucursal "${branch.name}"? Esta acción no se puede deshacer.`)) return;

    setBusyId(branch.id);
    setError(null);
    try {
      await deleteBranch(branch.id);
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo eliminar la sucursal.");
    } finally {
      setBusyId(null);
    }
  }

  async function handleSetMain(branchId: string) {
    setBusyId(branchId);
    setError(null);
    try {
      await updateBranch(branchId, { is_main: true });
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo marcar como principal.");
    } finally {
      setBusyId(null);
    }
  }

  if (!businessId) {
    return <p className="text-slate-500 text-sm">No hay un negocio activo.</p>;
  }

  return (
    <div>
      <form onSubmit={handleSubmit} className="flex flex-wrap gap-2 mb-4">
        <input
          className={inputClass}
          placeholder="Nombre de la sucursal"
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
        />
        <input
          className={inputClass}
          placeholder="Dirección"
          value={address}
          onChange={(e) => setAddress(e.target.value)}
        />
        <input
          className={inputClass}
          placeholder="Teléfono"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
        />
        <VimdyButton
          type="submit"
          disabled={!name.trim()}
          loading={saving}
          variant="primary"
          size="sm"
          icon={<Plus size={16} />}
          className="flex-shrink-0"
        >
          {editingId ? "Guardar" : "Nueva sucursal"}
        </VimdyButton>
        {showForm && (
          <VimdyButton
            type="button"
            onClick={resetForm}
            variant="secondary"
            size="sm"
            className="flex-shrink-0"
          >
            Cancelar
          </VimdyButton>
        )}
      </form>

      {error && (
        <div className="mb-3 rounded-xl border border-red-500/40 bg-red-500/10 text-red-300 text-xs px-3 py-2.5">
          {error}
        </div>
      )}

      {loading ? (
        <p className="text-slate-500 text-sm">Cargando sucursales...</p>
      ) : branches.length === 0 ? (
        <div className="flex flex-col items-center gap-2 py-8 text-slate-500">
          <Building2 size={28} />
          <p className="text-sm text-center">
            Todavía no agregas sucursales. Usa el formulario de arriba para crear la primera.
          </p>
        </div>
      ) : (
        <div className="space-y-2 max-h-80 overflow-y-auto pr-1">
          {branches.map((b) => (
            <div
              key={b.id}
              className="flex items-center justify-between gap-3 rounded-xl border border-slate-700 bg-slate-900/60 px-3 py-2.5"
            >
              <div className="min-w-0">
                <p className="text-white text-sm font-semibold truncate flex items-center gap-2">
                  {b.name}
                  {b.is_main && (
                    <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full border border-cyan-500/30 bg-cyan-500/10 text-cyan-300">
                      Principal
                    </span>
                  )}
                </p>
                <p className="text-slate-500 text-xs truncate">
                  {b.address ? (
                    <span className="flex items-center gap-1"><MapPin size={12} /> {b.address}</span>
                  ) : null}
                  {b.phone ? (
                    <span className={`flex items-center gap-1 ${b.address ? "ml-2" : ""}`}><Phone size={12} /> {b.phone}</span>
                  ) : null}
                </p>
              </div>
              <div className="flex items-center gap-2 flex-shrink-0">
                <span
                  className={`text-xs font-semibold px-2 py-0.5 rounded-full border ${
                    b.active
                      ? "text-green-400 bg-green-500/10 border-green-500/30"
                      : "text-slate-400 bg-slate-500/10 border-slate-500/30"
                  }`}
                >
                  {b.active ? "Activa" : "Inactiva"}
                </span>
                <button
                  title={b.active ? "Desactivar" : "Reactivar"}
                  aria-label={b.active ? "Desactivar sucursal" : "Reactivar sucursal"}
                  disabled={busyId === b.id}
                  onClick={() => toggleActive(b)}
                  className="text-slate-400 hover:text-white disabled:opacity-40"
                >
                  {b.active ? <Ban size={16} /> : <RotateCcw size={16} />}
                </button>
                <button
                  title="Editar"
                  aria-label="Editar sucursal"
                  disabled={busyId === b.id}
                  onClick={() => startEdit(b)}
                  className="text-slate-400 hover:text-white disabled:opacity-40"
                >
                  <Pencil size={16} />
                </button>
                {!b.is_main && (
                  <button
                    title="Marcar como principal"
                    aria-label="Marcar como principal"
                    disabled={busyId === b.id}
                    onClick={() => handleSetMain(b.id)}
                    className="text-slate-400 hover:text-cyan-300 disabled:opacity-40"
                  >
                    <Building2 size={16} />
                  </button>
                )}
                {!b.is_main && (
                  <button
                    title="Eliminar"
                    aria-label="Eliminar sucursal"
                    disabled={busyId === b.id}
                    onClick={() => handleDelete(b)}
                    className="text-vimdy-danger hover:opacity-80 disabled:opacity-40"
                  >
                    <Trash2 size={16} />
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
