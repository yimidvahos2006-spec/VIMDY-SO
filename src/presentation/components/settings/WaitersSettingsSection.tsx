import React, { useEffect, useRef, useState } from "react";
import {
  UserPlus,
  Trash2,
  Ban,
  RotateCcw,
  Users as UsersIcon,
  Camera,
  ImageOff,
  Pencil,
  Check,
  X
} from "lucide-react";

import { container } from "../../../infrastructure/di/CompositionRoot";
import { Waiter } from "../../../core/entities/Entities";
import { useVimdyEvent } from "../../../hooks/useVimdyCore";
import { VimdyButton } from "../ui/VimdyButton";
import { useWaiterPhotoVisibility } from "../../../core/store/waiterSettingsStore";
import { confirmDialog } from "../../../core/store/confirmStore";
import { translateBusinessError } from "../../../core/errors/translateBusinessError";
import { WAITERS_MANAGE_PERMISSION } from "../../../core/config/staffRoles";
import { WAITER_NAME_MAX_LENGTH } from "../../../core/utils/waiterProfile";
import { prepareWaiterPhoto } from "../../utils/waiterPhoto";
import { useAuth } from "../../context/AuthContext";

const inputClass =
  "w-full h-10 rounded-xl bg-vimdy-surface border border-slate-700 px-3 text-white text-sm outline-none focus:border-cyan-500";

export function WaitersSettingsSection() {
  const { can } = useAuth();
  // Mismo criterio que el servidor (Paso 1): solo el administrador escribe en `waiters`.
  const canManage = can(WAITERS_MANAGE_PERMISSION);

  const [waiters, setWaiters] = useState<Waiter[]>([]);
  const [loading, setLoading] = useState(true);
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const {
    showPhotos,
    loaded: photoSettingLoaded,
    saving: savingPhotoSetting,
    error: photoSettingError,
    toggle: toggleShowPhotos
  } = useWaiterPhotoVisibility();

  async function reload() {
    const all = await container.waiterEngine.get().listAll();
    setWaiters(all);
    setLoading(false);
  }

  useEffect(() => {
    reload().catch((err) => {
      setError(translateBusinessError(err, "No se pudo cargar la lista de meseros."));
      setLoading(false);
    });
  }, []);

  useVimdyEvent("waiter", () => {
    reload().catch(() => undefined);
  });

  function clearPendingPhoto() {
    setPhotoFile(null);
    setPhotoPreview(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  async function handlePhotoSelect(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0] ?? null;
    setError(null);
    if (!file) {
      clearPendingPhoto();
      return;
    }
    try {
      // Se comprime desde ya: la vista previa es exactamente lo que se guardará.
      const compressed = await prepareWaiterPhoto(file);
      setPhotoFile(file);
      setPhotoPreview(compressed);
    } catch (err) {
      clearPendingPhoto();
      setError(translateBusinessError(err, "No se pudo leer la foto."));
    }
  }

  async function handleAdd(event: React.FormEvent) {
    event.preventDefault();
    if (!canManage || !name.trim() || saving) return;

    setSaving(true);
    setError(null);
    try {
      await container.waiterEngine
        .get()
        .create({ name: name.trim(), photoUrl: photoPreview ?? undefined });
      setName("");
      clearPendingPhoto();
    } catch (err) {
      setError(translateBusinessError(err, "No se pudo agregar el mesero."));
    } finally {
      setSaving(false);
    }
  }

  async function runForWaiter(waiter: Waiter, fallback: string, action: () => Promise<unknown>) {
    setBusyId(waiter.id);
    setError(null);
    try {
      await action();
      return true;
    } catch (err) {
      setError(translateBusinessError(err, fallback));
      return false;
    } finally {
      setBusyId(null);
    }
  }

  function handleRemovePhoto(waiter: Waiter) {
    return runForWaiter(waiter, "No se pudo quitar la foto.", () =>
      container.waiterEngine.get().updatePhoto(waiter.id, undefined)
    );
  }

  function handleSetPhoto(waiter: Waiter, file: File) {
    return runForWaiter(waiter, "No se pudo actualizar la foto.", async () => {
      const photoUrl = await prepareWaiterPhoto(file);
      await container.waiterEngine.get().updatePhoto(waiter.id, photoUrl);
    });
  }

  function toggleActive(waiter: Waiter) {
    return runForWaiter(waiter, "No se pudo actualizar el mesero.", () =>
      container.waiterEngine.get().setActive(waiter.id, !waiter.active)
    );
  }

  function startRename(waiter: Waiter) {
    setEditingId(waiter.id);
    setEditingName(waiter.name);
    setError(null);
  }

  function cancelRename() {
    setEditingId(null);
    setEditingName("");
  }

  async function saveRename(waiter: Waiter) {
    const ok = await runForWaiter(waiter, "No se pudo cambiar el nombre.", () =>
      container.waiterEngine.get().rename(waiter.id, editingName)
    );
    if (ok) cancelRename();
  }

  async function handleDelete(waiter: Waiter) {
    const accepted = await confirmDialog({
      title: "Quitar mesero",
      message: `¿Quitar a "${waiter.name}" de la lista de meseros?`,
      confirmLabel: "Quitar",
      danger: true
    });
    if (!accepted) return;

    await runForWaiter(waiter, "No se pudo eliminar el mesero.", () =>
      container.waiterEngine.get().delete(waiter.id)
    );
  }

  const photoToggleDisabled = !canManage || !photoSettingLoaded || savingPhotoSetting;

  return (
    <div>
      {!canManage && (
        <div className="mb-3 rounded-xl border border-slate-700 bg-slate-900/60 text-slate-400 text-xs px-3 py-2.5">
          Solo el administrador puede agregar, cambiar o quitar meseros. Aquí puedes ver la lista.
        </div>
      )}

      {canManage && (
        <form onSubmit={handleAdd} className="flex gap-2 mb-4">
          <input
            className={inputClass}
            placeholder="Nombre del mesero"
            value={name}
            maxLength={WAITER_NAME_MAX_LENGTH}
            onChange={(e) => setName(e.target.value)}
          />
          <label
            title="Elegir foto"
            className="relative cursor-pointer inline-flex items-center justify-center w-10 h-10 shrink-0 rounded-xl border border-slate-700 hover:border-cyan-500 transition text-slate-400 hover:text-white"
          >
            <Camera size={18} />
            <input
              ref={fileInputRef}
              type="file"
              accept="image/png,image/jpeg,image/webp,image/gif"
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
      )}

      {canManage && photoPreview && photoFile && (
        <div className="flex items-center gap-2 mb-3 text-xs text-slate-400">
          <img src={photoPreview} alt="Vista previa" className="w-8 h-8 rounded-full object-cover border border-slate-600" />
          <span>Foto lista para guardar</span>
          <button
            type="button"
            title="Descartar foto"
            aria-label="Descartar foto"
            onClick={clearPendingPhoto}
            className="text-vimdy-danger hover:opacity-80"
          >
            <ImageOff size={14} />
          </button>
        </div>
      )}

      <div className="mb-3">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <span className="text-slate-400 text-xs font-semibold uppercase tracking-wide">
              Mostrar fotos en tarjetas
            </span>
            <p className="text-slate-500 text-xs mt-0.5">
              Se aplica a todos los dispositivos del negocio.
            </p>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={showPhotos}
            aria-label="Mostrar fotos en tarjetas"
            disabled={photoToggleDisabled}
            onClick={() => void toggleShowPhotos()}
            className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition disabled:opacity-50 ${
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
        {photoSettingError && (
          <p role="alert" className="mt-2 text-xs text-red-300">
            {photoSettingError}
          </p>
        )}
      </div>

      {error && (
        <div
          role="alert"
          className="mb-3 rounded-xl border border-red-500/40 bg-red-500/10 text-red-300 text-xs px-3 py-2.5"
        >
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
          {waiters.map((w) => {
            const editing = editingId === w.id;
            const busy = busyId === w.id;
            return (
              <div
                key={w.id}
                className="flex items-center justify-between gap-3 rounded-xl border border-slate-700 bg-slate-900/60 px-3 py-2.5"
              >
                <div className="flex items-center gap-3 min-w-0 flex-1">
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
                  {editing ? (
                    <input
                      autoFocus
                      className={`${inputClass} h-9`}
                      value={editingName}
                      maxLength={WAITER_NAME_MAX_LENGTH}
                      aria-label={`Nuevo nombre para ${w.name}`}
                      onChange={(e) => setEditingName(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          void saveRename(w);
                        }
                        if (e.key === "Escape") cancelRename();
                      }}
                    />
                  ) : (
                    <p className="text-white text-sm font-semibold truncate">{w.name}</p>
                  )}
                </div>

                {canManage && (
                  <div className="flex items-center gap-1 flex-shrink-0">
                    {editing ? (
                      <>
                        <button
                          title="Guardar nombre"
                          aria-label="Guardar nombre"
                          disabled={busy || !editingName.trim()}
                          onClick={() => void saveRename(w)}
                          className="text-green-400 hover:opacity-80 disabled:opacity-40 inline-flex items-center justify-center w-8 h-8"
                        >
                          <Check size={16} />
                        </button>
                        <button
                          title="Cancelar"
                          aria-label="Cancelar cambio de nombre"
                          disabled={busy}
                          onClick={cancelRename}
                          className="text-slate-400 hover:text-white disabled:opacity-40 inline-flex items-center justify-center w-8 h-8"
                        >
                          <X size={16} />
                        </button>
                      </>
                    ) : (
                      <>
                        <span
                          className={`hidden sm:inline text-xs font-semibold px-2 py-0.5 rounded-full border ${
                            w.active
                              ? "text-green-400 bg-green-500/10 border-green-500/30"
                              : "text-slate-400 bg-slate-500/10 border-slate-500/30"
                          }`}
                        >
                          {w.active ? "Activo" : "Inactivo"}
                        </span>
                        <button
                          title="Cambiar nombre"
                          aria-label={`Cambiar nombre de ${w.name}`}
                          disabled={busy}
                          onClick={() => startRename(w)}
                          className="text-slate-400 hover:text-white disabled:opacity-40 inline-flex items-center justify-center w-8 h-8"
                        >
                          <Pencil size={14} />
                        </button>
                        <label
                          title="Cambiar foto"
                          className="cursor-pointer inline-flex items-center justify-center w-8 h-8 rounded-lg border border-slate-700 hover:border-cyan-500 transition text-slate-400 hover:text-white"
                        >
                          <Camera size={14} />
                          <input
                            type="file"
                            accept="image/png,image/jpeg,image/webp,image/gif"
                            className="hidden"
                            disabled={busy}
                            onChange={(e) => {
                              const file = e.target.files?.[0];
                              e.target.value = "";
                              if (file) void handleSetPhoto(w, file);
                            }}
                          />
                        </label>
                        {w.photoUrl && (
                          <button
                            title="Quitar foto"
                            aria-label="Quitar foto"
                            disabled={busy}
                            onClick={() => void handleRemovePhoto(w)}
                            className="text-vimdy-danger hover:opacity-80 disabled:opacity-40 inline-flex items-center justify-center w-8 h-8"
                          >
                            <ImageOff size={14} />
                          </button>
                        )}
                        <button
                          title={w.active ? "Desactivar" : "Reactivar"}
                          aria-label={w.active ? "Desactivar mesero" : "Reactivar mesero"}
                          disabled={busy}
                          onClick={() => void toggleActive(w)}
                          className="text-slate-400 hover:text-white disabled:opacity-40 inline-flex items-center justify-center w-8 h-8"
                        >
                          {w.active ? <Ban size={16} /> : <RotateCcw size={16} />}
                        </button>
                        <button
                          title="Eliminar"
                          aria-label="Eliminar mesero"
                          disabled={busy}
                          onClick={() => void handleDelete(w)}
                          className="text-vimdy-danger hover:opacity-80 disabled:opacity-40 inline-flex items-center justify-center w-8 h-8"
                        >
                          <Trash2 size={16} />
                        </button>
                      </>
                    )}
                  </div>
                )}

                {!canManage && (
                  <span
                    className={`text-xs font-semibold px-2 py-0.5 rounded-full border ${
                      w.active
                        ? "text-green-400 bg-green-500/10 border-green-500/30"
                        : "text-slate-400 bg-slate-500/10 border-slate-500/30"
                    }`}
                  >
                    {w.active ? "Activo" : "Inactivo"}
                  </span>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}