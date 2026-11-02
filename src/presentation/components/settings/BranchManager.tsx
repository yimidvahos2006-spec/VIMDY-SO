import React, { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Plus, Pencil, Ban, RotateCcw, Trash2, MapPin, Phone, Building2, Star, Sparkles } from "lucide-react";

import { confirmDialog } from "../../../core/store/confirmStore";
import { toast } from "../../../core/store/toastStore";
import { subscriptionStore } from "../../../core/store/subscriptionStore";
import { subscriptionEngine } from "../../../core/engines/SubscriptionEngine";
import { translateBusinessError } from "../../../core/errors/translateBusinessError";
import { DEFAULT_BUSINESS_TIER, type BusinessTier } from "../../../core/entities/SubscriptionTypes";
import {
  canDeactivateBranch,
  canDeleteBranch,
  canSetMainBranch,
  evaluateBranchAccess,
  validateBranchInput,
  type BranchField,
  type BranchSummary,
} from "../../../core/config/branchAccess";
import {
  getCurrentBusinessId,
  getBranches,
  createBranch,
  updateBranch,
  deleteBranch,
} from "../../../infrastructure/supabase/supabaseClient";
import { loadBusinessPlanTier, setMainBranch } from "../../../infrastructure/supabase/branchAdmin";
import { VimdyButton } from "../ui/VimdyButton";
import { UpgradeModal } from "../subscription/UpgradeModal";
import { Field, inputClass, inputErrorClass } from "./settingsPrimitives";

type FieldErrors = Partial<Record<BranchField, string>>;

const subscribeSubscription = subscriptionStore.subscribe;
const readSubscription = subscriptionStore.getSnapshot;

export function BranchManager() {
  const businessId = getCurrentBusinessId();
  const subscriptionSnapshot = useSyncExternalStore(subscribeSubscription, readSubscription, readSubscription);

  const [branches, setBranches] = useState<BranchSummary[]>([]);
  const [tier, setTier] = useState<BusinessTier>(DEFAULT_BUSINESS_TIER);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [upgrading, setUpgrading] = useState(false);

  const [name, setName] = useState("");
  const [address, setAddress] = useState("");
  const [phone, setPhone] = useState("");
  const [wantsMain, setWantsMain] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});

  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const subscriptionStatus = subscriptionSnapshot.subscription
    ? subscriptionEngine.effectiveStatus(subscriptionSnapshot.subscription, new Date())
    : null;
  const subscriptionBlocked = subscriptionStatus === "expired" || subscriptionStatus === "suspended";
  const access = evaluateBranchAccess({ tier, branches, subscriptionBlocked });

  const refresh = useCallback(async (): Promise<void> => {
    if (!businessId) return;
    try {
      const [all, planTier] = await Promise.all([getBranches(businessId), loadBusinessPlanTier(businessId)]);
      if (!mountedRef.current) return;
      setBranches(all);
      setTier(planTier);
      setLoadError(null);
    } catch (error) {
      if (!mountedRef.current) return;
      setLoadError(translateBusinessError(error, "No se pudieron cargar las sucursales."));
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, [businessId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  function resetForm() {
    setName("");
    setAddress("");
    setPhone("");
    setWantsMain(false);
    setFieldErrors({});
    setEditingId(null);
    setFormOpen(false);
  }

  function startEdit(branch: BranchSummary) {
    setEditingId(branch.id);
    setName(branch.name);
    setAddress(branch.address ?? "");
    setPhone(branch.phone ?? "");
    setWantsMain(branch.is_main);
    setFieldErrors({});
    setFormOpen(true);
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!businessId || saving) return;

    const editing = editingId ? branches.find((branch) => branch.id === editingId) : undefined;
    if (!editing && !access.canCreate) {
      toast.warning(access.message ?? "No puedes crear más sucursales con tu plan actual.");
      return;
    }

    const validation = validateBranchInput({ name, address, phone }, branches, editingId);
    if (!validation.ok) {
      setFieldErrors(validation.errors);
      return;
    }
    setFieldErrors({});

    const { value } = validation;
    setSaving(true);
    try {
      if (editing) {
        await updateBranch(editing.id, { name: value.name, address: value.address, phone: value.phone });
        if (wantsMain && !editing.is_main) await setMainBranch(editing.id);
        toast.success("Sucursal actualizada.");
      } else {
        const hasMain = branches.some((branch) => branch.is_main);
        const created = await createBranch(businessId, {
          name: value.name,
          address: value.address,
          phone: value.phone,
          is_main: !hasMain,
        });
        if (hasMain && wantsMain) {
          try {
            await setMainBranch(created.id);
          } catch (error) {
            toast.warning(
              `La sucursal se creó, pero no se pudo marcar como principal: ${translateBusinessError(error, "intenta de nuevo.")}`,
            );
          }
        }
        toast.success("Sucursal creada.");
      }
      resetForm();
      await refresh();
    } catch (error) {
      toast.error(translateBusinessError(error, "No se pudo guardar la sucursal."));
    } finally {
      if (mountedRef.current) setSaving(false);
    }
  }

  async function toggleActive(branch: BranchSummary) {
    if (branch.active) {
      const guard = canDeactivateBranch(branch, branches);
      if (!guard.allowed) {
        toast.warning(guard.message ?? "No se puede desactivar esta sucursal.");
        return;
      }
    } else if (!access.canActivate) {
      toast.warning(access.message ?? "No puedes activar más sucursales con tu plan actual.");
      return;
    }

    setBusyId(branch.id);
    try {
      await updateBranch(branch.id, { active: !branch.active });
      toast.success(branch.active ? "Sucursal desactivada." : "Sucursal reactivada.");
      await refresh();
    } catch (error) {
      toast.error(translateBusinessError(error, "No se pudo actualizar la sucursal."));
    } finally {
      if (mountedRef.current) setBusyId(null);
    }
  }

  async function handleDelete(branch: BranchSummary) {
    const guard = canDeleteBranch(branch);
    if (!guard.allowed) {
      toast.warning(guard.message ?? "No se puede eliminar esta sucursal.");
      return;
    }
    const accepted = await confirmDialog({
      title: "Eliminar sucursal",
      message: `¿Eliminar la sucursal "${branch.name}"? Esta acción no se puede deshacer.`,
      confirmLabel: "Eliminar",
      danger: true,
    });
    if (!accepted) return;

    setBusyId(branch.id);
    try {
      await deleteBranch(branch.id);
      toast.success("Sucursal eliminada.");
      await refresh();
    } catch (error) {
      toast.error(translateBusinessError(error, "No se pudo eliminar la sucursal."));
    } finally {
      if (mountedRef.current) setBusyId(null);
    }
  }

  async function handleSetMain(branch: BranchSummary) {
    const guard = canSetMainBranch(branch);
    if (!guard.allowed) {
      toast.warning(guard.message ?? "No se puede marcar como principal.");
      return;
    }
    setBusyId(branch.id);
    try {
      await setMainBranch(branch.id);
      toast.success(`"${branch.name}" ahora es la sucursal principal.`);
      await refresh();
    } catch (error) {
      toast.error(translateBusinessError(error, "No se pudo marcar como principal."));
    } finally {
      if (mountedRef.current) setBusyId(null);
    }
  }

  if (!businessId) {
    return <p className="text-slate-500 text-sm">No hay un negocio activo.</p>;
  }

  const editingBranch = editingId ? branches.find((branch) => branch.id === editingId) : undefined;
  const showForm = formOpen || (!loading && !loadError && branches.length === 0 && access.canCreate);
  const mainLocked = Boolean(editingBranch?.is_main);

  return (
    <div>
      {access.message && (
        <div
          role="status"
          className="mb-4 flex flex-col gap-3 rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 sm:flex-row sm:items-center sm:justify-between"
        >
          <p className="text-sm text-amber-200">{access.message}</p>
          <VimdyButton
            variant="secondary"
            size="sm"
            icon={<Sparkles size={16} />}
            onClick={() => setUpgrading(true)}
            className="flex-shrink-0"
          >
            {access.reason === "subscription_blocked" ? "Renovar plan" : "Ver planes"}
          </VimdyButton>
        </div>
      )}

      {!showForm && access.canCreate && !loading && !loadError && (
        <div className="mb-4">
          <VimdyButton variant="secondary" size="sm" icon={<Plus size={16} />} onClick={() => setFormOpen(true)}>
            Agregar sucursal
          </VimdyButton>
        </div>
      )}

      {showForm && (
        <form
          onSubmit={handleSubmit}
          noValidate
          className="mb-4 grid gap-3 rounded-xl border border-slate-700 bg-slate-900/40 p-4 sm:grid-cols-2"
        >
          <div className="sm:col-span-2">
            <Field label="Nombre de la sucursal" htmlFor="branch-name">
              <input
                id="branch-name"
                className={fieldErrors.name ? inputErrorClass : inputClass}
                placeholder="Ej. Sede Centro"
                value={name}
                onChange={(e) => setName(e.target.value)}
                aria-invalid={Boolean(fieldErrors.name)}
                maxLength={80}
              />
            </Field>
            {fieldErrors.name && <p className="mt-1 text-xs text-red-300">{fieldErrors.name}</p>}
          </div>
          <div className="sm:col-span-2">
            <Field label="Dirección" htmlFor="branch-address">
              <input
                id="branch-address"
                className={fieldErrors.address ? inputErrorClass : inputClass}
                placeholder="Calle, número, barrio"
                value={address}
                onChange={(e) => setAddress(e.target.value)}
                aria-invalid={Boolean(fieldErrors.address)}
                maxLength={200}
              />
            </Field>
            {fieldErrors.address && <p className="mt-1 text-xs text-red-300">{fieldErrors.address}</p>}
          </div>
          <div>
            <Field label="Teléfono" htmlFor="branch-phone">
              <input
                id="branch-phone"
                type="tel"
                inputMode="tel"
                className={fieldErrors.phone ? inputErrorClass : inputClass}
                placeholder="Ej. 300 123 4567"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                aria-invalid={Boolean(fieldErrors.phone)}
                maxLength={40}
              />
            </Field>
            {fieldErrors.phone && <p className="mt-1 text-xs text-red-300">{fieldErrors.phone}</p>}
          </div>
          <label className="flex items-center gap-3 self-end rounded-xl border border-slate-700 px-3 py-2.5 text-sm text-slate-300">
            <input
              type="checkbox"
              checked={wantsMain || mainLocked}
              disabled={mainLocked || (!editingBranch && branches.length === 0)}
              onChange={(e) => setWantsMain(e.target.checked)}
              className="h-4 w-4 accent-cyan-400"
            />
            <span>
              Sucursal principal
              {mainLocked && <span className="block text-xs text-slate-500">Para cambiarla, marca otra sucursal como principal.</span>}
              {!editingBranch && branches.length === 0 && (
                <span className="block text-xs text-slate-500">La primera sucursal es la principal.</span>
              )}
            </span>
          </label>
          <div className="flex flex-wrap justify-end gap-2 sm:col-span-2">
            <VimdyButton type="button" variant="ghost" size="sm" onClick={resetForm} disabled={saving}>
              Cancelar
            </VimdyButton>
            <VimdyButton type="submit" variant="secondary" size="sm" loading={saving} icon={<Plus size={16} />}>
              {editingId ? "Guardar cambios" : "Crear sucursal"}
            </VimdyButton>
          </div>
        </form>
      )}

      {loading ? (
        <p className="text-slate-500 text-sm">Cargando sucursales...</p>
      ) : loadError ? (
        <div className="flex flex-col items-start gap-3 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3">
          <p className="text-sm text-red-200">{loadError}</p>
          <VimdyButton variant="secondary" size="sm" onClick={() => void refresh()}>
            Reintentar
          </VimdyButton>
        </div>
      ) : branches.length === 0 ? (
        <div className="flex flex-col items-center gap-2 py-8 text-slate-500">
          <Building2 size={28} />
          <p className="text-sm text-center">Todavía no agregas sucursales. Crea la primera con el formulario.</p>
        </div>
      ) : (
        <ul className="space-y-2 max-h-96 overflow-y-auto pr-1">
          {branches.map((b) => (
            <li
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
                <p className="text-slate-500 text-xs truncate flex flex-wrap gap-x-3">
                  {b.address ? (
                    <span className="flex items-center gap-1"><MapPin size={12} /> {b.address}</span>
                  ) : null}
                  {b.phone ? (
                    <span className="flex items-center gap-1"><Phone size={12} /> {b.phone}</span>
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
                  type="button"
                  title={b.active ? "Desactivar" : "Reactivar"}
                  aria-label={b.active ? `Desactivar ${b.name}` : `Reactivar ${b.name}`}
                  disabled={busyId === b.id}
                  onClick={() => void toggleActive(b)}
                  className="text-slate-400 hover:text-white disabled:opacity-40"
                >
                  {b.active ? <Ban size={16} /> : <RotateCcw size={16} />}
                </button>
                <button
                  type="button"
                  title="Editar"
                  aria-label={`Editar ${b.name}`}
                  disabled={busyId === b.id}
                  onClick={() => startEdit(b)}
                  className="text-slate-400 hover:text-white disabled:opacity-40"
                >
                  <Pencil size={16} />
                </button>
                {!b.is_main && b.active && (
                  <button
                    type="button"
                    title="Marcar como principal"
                    aria-label={`Marcar ${b.name} como principal`}
                    disabled={busyId === b.id}
                    onClick={() => void handleSetMain(b)}
                    className="text-slate-400 hover:text-cyan-300 disabled:opacity-40"
                  >
                    <Star size={16} />
                  </button>
                )}
                {!b.is_main && (
                  <button
                    type="button"
                    title="Eliminar"
                    aria-label={`Eliminar ${b.name}`}
                    disabled={busyId === b.id}
                    onClick={() => void handleDelete(b)}
                    className="text-vimdy-danger hover:opacity-80 disabled:opacity-40"
                  >
                    <Trash2 size={16} />
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      {upgrading && <UpgradeModal onClose={() => setUpgrading(false)} />}
    </div>
  );
}