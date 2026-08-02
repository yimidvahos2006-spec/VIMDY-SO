import React, { useEffect, useState } from "react";
import { UserPlus, Trash2, Ban, RotateCcw, Users as UsersIcon } from "lucide-react";

import { container } from "../../../infrastructure/di/CompositionRoot";
import { Waiter } from "../../../core/entities/Entities";
import { useVimdyEvent } from "../../../hooks/useVimdyCore";
import { VimdyButton } from "../ui/VimdyButton";

const inputClass =
  "w-full h-10 rounded-xl bg-vimdy-surface border border-slate-700 px-3 text-white text-sm outline-none focus:border-cyan-500";

/**
 * Configuración > Meseros. Agrega/edita/quita nombres de meseros
 * "ligeros" (sin correo, sin contraseña) — son los que aparecen como
 * tarjetas en la pantalla Meseros, para que cada uno toque su nombre en
 * vez de iniciar sesión. Distinto de "Usuarios y roles" (esos sí tienen
 * login y permisos, para cajero/admin/cocina).
 */
export function WaitersSettingsSection() {
  const [waiters, setWaiters] = useState<Waiter[]>([]);
  const [loading, setLoading] = useState(true);
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  async function reload() {
    const all = await container.waiterEngine.listAll();
    setWaiters(all);
    setLoading(false);
  }

  useEffect(() => {
    reload();
  }, []);

  useVimdyEvent("waiter", () => {
    reload();
  });

  async function handleAdd(event: React.FormEvent) {
    event.preventDefault();
    if (!name.trim() || saving) return;

    setSaving(true);
    setError(null);
    try {
      await container.waiterEngine.create({ name: name.trim() });
      setName("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo agregar el mesero.");
    } finally {
      setSaving(false);
    }
  }

  async function toggleActive(waiter: Waiter) {
    setBusyId(waiter.id);
    setError(null);
    try {
      await container.waiterEngine.setActive(waiter.id, !waiter.active);
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo actualizar el mesero.");
    } finally {
      setBusyId(null);
    }
  }

  async function handleDelete(waiter: Waiter) {
    if (!window.confirm(`¿Quitar a "${waiter.name}" de la lista de meseros?`)) return;

    setBusyId(waiter.id);
    setError(null);
    try {
      await container.waiterEngine.delete(waiter.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo eliminar el mesero.");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div>
      <form onSubmit={handleAdd} className="flex gap-2 mb-4">
        <input
          className={inputClass}
          placeholder="Nombre del mesero"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <VimdyButton
          type="submit"
          disabled={!name.trim()}
          loading={saving}
          variant="primary"
          size="sm"
          icon={<UserPlus size={16} />}
          className="flex-shrink-0"
        >
          Agregar
        </VimdyButton>
      </form>

      {error && (
        <div className="mb-3 rounded-xl border border-red-500/40 bg-red-500/10 text-red-300 text-xs px-3 py-2.5">
          {error}
        </div>
      )}

      {loading ? (
        <p className="text-slate-500 text-sm">Cargando...</p>
      ) : waiters.length === 0 ? (
        <div className="flex flex-col items-center gap-2 py-8 text-slate-500">
          <UsersIcon size={28} />
          <p className="text-sm text-center">
            Todavía no agregas meseros. Aparecerán como tarjetas en la
            pantalla Meseros.
          </p>
        </div>
      ) : (
        <div className="space-y-2 max-h-80 overflow-y-auto pr-1">
          {waiters.map((w) => (
            <div
              key={w.id}
              className="flex items-center justify-between gap-3 rounded-xl border border-slate-700 bg-slate-900/60 px-3 py-2.5"
            >
              <p className="text-white text-sm font-semibold truncate">{w.name}</p>
              <div className="flex items-center gap-2 flex-shrink-0">
                <span
                  className={`text-xs font-semibold px-2 py-0.5 rounded-full border ${
                    w.active
                      ? "text-green-400 bg-green-500/10 border-green-500/30"
                      : "text-slate-400 bg-slate-500/10 border-slate-500/30"
                  }`}
                >
                  {w.active ? "Activo" : "Inactivo"}
                </span>
                <button
                  title={w.active ? "Desactivar" : "Reactivar"}
                  aria-label={w.active ? "Desactivar mesero" : "Reactivar mesero"}
                  disabled={busyId === w.id}
                  onClick={() => toggleActive(w)}
                  className="text-slate-400 hover:text-white disabled:opacity-40"
                >
                  {w.active ? <Ban size={16} /> : <RotateCcw size={16} />}
                </button>
                <button
                  title="Eliminar"
                  aria-label="Eliminar mesero"
                  disabled={busyId === w.id}
                  onClick={() => handleDelete(w)}
                  className="text-vimdy-danger hover:opacity-80 disabled:opacity-40"
                >
                  <Trash2 size={16} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}