import React, { useState } from "react";
import { UserCircle2, Users, Plus, X } from "lucide-react";

import { Waiter } from "../../../core/entities/Entities";
import { container } from "../../../infrastructure/di/CompositionRoot";
import { EmptyState } from "../ui/EmptyState";
import { useWaiterPhotoVisibility } from "../../../core/store/waiterSettingsStore";

interface Props {
  waiters: Waiter[];
  onSelect: (waiter: Waiter) => void;
}

export function WaiterSelect({ waiters, onSelect }: Props) {
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [newName, setNewName] = useState("");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { showPhotos } = useWaiterPhotoVisibility();

  async function handleCreate(event: React.FormEvent) {
    event.preventDefault();
    if (!newName.trim() || creating) return;

    setCreating(true);
    setError(null);
    try {
      await container.waiterEngine.get().create({ name: newName.trim() });
      setNewName("");
      setShowCreateForm(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo agregar el mesero.");
    } finally {
      setCreating(false);
    }
  }

  if (waiters.length === 0) {
    return (
      <EmptyState
        icon={<Users size={28} />}
        title="Todavía no has agregado meseros."
        description='Ve a Configuración → Meseros y agrega los nombres de tu equipo. Aparecerán aquí como tarjetas para que cada uno toque la suya.'
      />
    );
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <p className="text-slate-400 text-lg">Toca tu nombre para empezar.</p>
        <button
          onClick={() => setShowCreateForm(true)}
          className="w-12 h-12 rounded-full bg-vimdy-accent hover:bg-vimdy-accent-hover text-white flex items-center justify-center transition shadow-lg shadow-vimdy-accent/20"
        >
          <Plus size={24} />
        </button>
      </div>

      {showCreateForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="w-full max-w-md rounded-2xl border border-vimdy-border bg-vimdy-surface p-6 shadow-2xl">
            <div className="flex items-center justify-between mb-5">
              <h3 className="text-vimdy-text text-lg font-bold">Nuevo mesero</h3>
              <button
                onClick={() => { setShowCreateForm(false); setError(null); }}
                className="w-8 h-8 rounded-lg flex items-center justify-center text-vimdy-text-secondary hover:bg-vimdy-background hover:text-vimdy-text transition"
              >
                <X size={18} />
              </button>
            </div>
            <form onSubmit={handleCreate}>
              <input
                autoFocus
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="Nombre del mesero"
                className="w-full h-11 px-3 rounded-vimdy-sm bg-vimdy-surface border border-vimdy-border text-vimdy-text text-sm placeholder:text-vimdy-text-tertiary focus:outline-none focus:border-vimdy-accent mb-4"
                onKeyDown={(e) => {
                  if (e.key === "Escape") {
                    setShowCreateForm(false);
                    setError(null);
                  }
                }}
              />
              {error && (
                <div className="mb-3 rounded-xl border border-red-500/40 bg-red-500/10 text-red-300 text-xs px-3 py-2.5">
                  {error}
                </div>
              )}
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => { setShowCreateForm(false); setError(null); }}
                  className="px-4 py-2 rounded-vimdy-sm border border-vimdy-border text-vimdy-text-secondary hover:text-vimdy-text text-sm font-medium transition"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={!newName.trim() || creating}
                  className="px-4 py-2 rounded-vimdy-sm bg-vimdy-accent text-white hover:bg-vimdy-accent-hover disabled:opacity-40 text-sm font-medium transition"
                >
                  {creating ? "Creando..." : "Crear"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
        {waiters.map(waiter => (
          <button
            key={waiter.id}
            onClick={() => onSelect(waiter)}
            className="flex flex-col items-center justify-center gap-3 bg-vimdy-surface rounded-2xl border border-slate-800 hover:border-cyan-500 hover:bg-slate-800/60 transition-all p-6"
          >
            {showPhotos && waiter.photoUrl ? (
              <img
                src={waiter.photoUrl}
                alt={waiter.name}
                className="w-20 h-20 rounded-full object-cover border-2 border-slate-700 shadow-lg"
              />
            ) : (
              <UserCircle2 size={40} className="text-cyan-400" />
            )}
            <span className="text-white text-lg font-bold text-center">
              {waiter.name}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
