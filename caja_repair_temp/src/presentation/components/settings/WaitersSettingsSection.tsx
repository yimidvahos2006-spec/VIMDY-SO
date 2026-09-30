import React, { useEffect, useState, useRef } from "react";
import { UserPlus, Trash2, Ban, RotateCcw, Users as UsersIcon, Camera, ImageOff } from "lucide-react";

import { container } from "../../../infrastructure/di/CompositionRoot";
import { Waiter } from "../../../core/entities/Entities";
import { useVimdyEvent } from "../../../hooks/useVimdyCore";
import { VimdyButton } from "../ui/VimdyButton";
import { useWaiterPhotoVisibility } from "../../../core/store/waiterSettingsStore";

const inputClass =
  "w-full h-10 rounded-xl bg-vimdy-surface border border-slate-700 px-3 text-white text-sm outline-none focus:border-cyan-500";

export function WaitersSettingsSection() {
  const [waiters, setWaiters] = useState<Waiter[]>([]);
  const [loading, setLoading] = useState(true);
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { showPhotos, toggle: toggleShowPhotos } = useWaiterPhotoVisibility();

  async function reload() {
    const all = await container.waiterEngine.get().listAll();
    setWaiters(all);
    setLoading(false);
  }

  useEffect(() => {
    reload();
  }, []);

  useVimdyEvent("waiter", () => {
    reload();
  });

  function handlePhotoSelect(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0] ?? null;
    setPhotoFile(file);
    if (file) {
      const reader = new FileReader();
      reader.onload = () => setPhotoPreview(reader.result as string);
      reader.readAsDataURL(file);
    } else {
      setPhotoPreview(null);
    }
  }

  async function handleAdd(event: React.FormEvent) {
    event.preventDefault();
    if (!name.trim() || saving) return;

    setSaving(true);
    setError(null);
    try {
      let photoUrl: string | undefined;
      if (photoFile) {
        photoUrl = await new Promise<string | undefined>((resolve) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result as string);
          reader.onerror = () => resolve(undefined);
          reader.readAsDataURL(photoFile);
        });
      }

      await container.waiterEngine.get().create({ name: name.trim(), photoUrl });
      setName("");
      setPhotoFile(null);
      setPhotoPreview(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo agregar el mesero.");
    } finally {
      setSaving(false);
    }
  }

  async function handleRemovePhoto(waiter: Waiter) {
    setBusyId(waiter.id);
    setError(null);
    try {
      await container.waiterEngine.get().updatePhoto(waiter.id, undefined);
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo quitar la foto.");
    } finally {
      setBusyId(null);
    }
  }

  async function handleSetPhoto(waiter: Waiter, file: File) {
    setBusyId(waiter.id);
    setError(null);
    try {
      const photoUrl = await new Promise<string | undefined>((resolve) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = () => resolve(undefined);
        reader.readAsDataURL(file);
      });
      await container.waiterEngine.get().updatePhoto(waiter.id, photoUrl);
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo actualizar la foto.");
    } finally {
      setBusyId(null);
    }
  }

  async function toggleActive(waiter: Waiter) {
    setBusyId(waiter.id);
    setError(null);
    try {
      await container.waiterEngine.get().setActive(waiter.id, !waiter.active);
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
      await container.waiterEngine.get().delete(waiter.id);
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
        <label className="relative cursor-pointer inline-flex items-center justify-center w-10 h-10 rounded-xl border border-slate-700 hover:border-cyan-500 transition text-slate-400 hover:text-white">
          <Camera size={18} />
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={handlePhotoSelect}
          />
        </label>
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

      {photoPreview && (
        <div className="flex items-center gap-2 mb-3 text-xs text-slate-400">
          <img src={photoPreview} alt="Preview" className="w-8 h-8 rounded-full object-cover border border-slate-600" />
          <span>Foto lista para guardar</span>
          <button
            type="button"
            onClick={() => { setPhotoFile(null); setPhotoPreview(null); if (fileInputRef.current) fileInputRef.current.value = ""; }}
            className="text-vimdy-danger hover:opacity-80"
          >
            <ImageOff size={14} />
          </button>
        </div>
      )}

      <div className="flex items-center justify-between mb-3">
        <span className="text-slate-400 text-xs font-semibold uppercase tracking-wide">Mostrar fotos en tarjetas</span>
        <button
          onClick={toggleShowPhotos}
          className={`relative inline-flex h-6 w-11 items-center rounded-full transition ${
            showPhotos ? "bg-vimdy-accent" : "bg-slate-700"
          }`}
        >
          <span
            className={`inline-block h-4 w-4 rounded-full bg-white transition-transform ${
              showPhotos ? "translate-x-6" : "translate-x-1"
            }`}
          />
        </button>
      </div>

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
              <div className="flex items-center gap-3 min-w-0">
                {w.photoUrl ? (
                  <img
                    src={w.photoUrl}
                    alt={w.name}
                    className="w-9 h-9 rounded-full object-cover border border-slate-600 shrink-0"
                  />
                ) : (
                  <div className="w-9 h-9 rounded-full border border-slate-700 bg-slate-800 flex items-center justify-center text-slate-500 shrink-0">
                    <UsersIcon size={16} />
                  </div>
                )}
                <p className="text-white text-sm font-semibold truncate">{w.name}</p>
              </div>
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
                <label className="cursor-pointer inline-flex items-center justify-center w-8 h-8 rounded-lg border border-slate-700 hover:border-cyan-500 transition text-slate-400 hover:text-white disabled:opacity-40">
                  <Camera size={14} />
                  <input
                    type="file"
                    accept="image/*"
                    className="hidden"
                    disabled={busyId === w.id}
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) handleSetPhoto(w, file);
                    }}
                  />
                </label>
                {w.photoUrl && (
                  <button
                    title="Quitar foto"
                    aria-label="Quitar foto"
                    disabled={busyId === w.id}
                    onClick={() => handleRemovePhoto(w)}
                    className="text-vimdy-danger hover:opacity-80 disabled:opacity-40 inline-flex items-center justify-center w-8 h-8"
                  >
                    <ImageOff size={14} />
                  </button>
                )}
                <button
                  title={w.active ? "Desactivar" : "Reactivar"}
                  aria-label={w.active ? "Desactivar mesero" : "Reactivar mesero"}
                  disabled={busyId === w.id}
                  onClick={() => toggleActive(w)}
                  className="text-slate-400 hover:text-white disabled:opacity-40 inline-flex items-center justify-center w-8 h-8"
                >
                  {w.active ? <Ban size={16} /> : <RotateCcw size={16} />}
                </button>
                <button
                  title="Eliminar"
                  aria-label="Eliminar mesero"
                  disabled={busyId === w.id}
                  onClick={() => handleDelete(w)}
                  className="text-vimdy-danger hover:opacity-80 disabled:opacity-40 inline-flex items-center justify-center w-8 h-8"
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
