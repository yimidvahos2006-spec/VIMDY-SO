import React, { useEffect, useState } from "react";
import { X, ShieldCheck, Check } from "lucide-react";

import { container } from "../../../infrastructure/di/CompositionRoot";
import { Permission } from "../../../core/entities/Entities";
import { VimdyButton } from "../ui/VimdyButton";

const MODULE_LABELS: Record<string, string> = {
  sales: "Ventas",
  inventory: "Inventario",
  kitchen: "Cocina",
  reports: "Reportes",
  config: "Configuración",
  users: "Usuarios",
  customers: "Clientes",
  tables: "Mesas",
  cash: "Caja"
};

const MODULE_ORDER = [
  "sales",
  "inventory",
  "kitchen",
  "tables",
  "cash",
  "customers",
  "reports",
  "users",
  "config"
];

interface PermissionEditorProps {
  roleId: string;
  roleName: string;
  onClose: () => void;
  onSaved: () => void;
}

export function PermissionEditor({ roleId, roleName, onClose, onSaved }: PermissionEditorProps) {
  const [permissions, setPermissions] = useState<Permission[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const all = await container.permissionEngine.get().list();
        setPermissions(all);

        const role = await container.roleEngine.get().getRole(roleId);
        setSelected(new Set(role.permissions.filter((p) => p !== "*")));
      } catch (err) {
        setError(err instanceof Error ? err.message : "No se pudieron cargar los permisos.");
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [roleId]);

  function togglePermission(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
    setSaved(false);
  }

  async function handleSave() {
    setSaving(true);
    setError(null);
    try {
      await container.roleEngine.get().setPermissions(roleId, Array.from(selected));
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudieron guardar los permisos.");
    } finally {
      setSaving(false);
    }
  }

  const grouped = MODULE_ORDER.reduce<Record<string, Permission[]>>((acc, module) => {
    const modulePerms = permissions.filter((p) => p.module === module);
    if (modulePerms.length > 0) {
      acc[module] = modulePerms;
    }
    return acc;
  }, {});

  const otherPerms = permissions.filter((p) => !MODULE_ORDER.includes(p.module));
  if (otherPerms.length > 0) {
    grouped.other = otherPerms;
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg max-h-[90vh] overflow-y-auto rounded-2xl bg-vimdy-surface border border-slate-700 p-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-white font-bold flex items-center gap-2">
            <ShieldCheck size={18} className="text-cyan-400" />
            Permisos de &ldquo;{roleName}&rdquo;
          </h3>
          <button onClick={onClose} aria-label="Cerrar" className="text-slate-400 hover:text-white">
            <X size={18} />
          </button>
        </div>

        {error && (
          <div className="mb-3 rounded-xl border border-red-500/40 bg-red-500/10 text-red-300 text-xs px-3 py-2.5">
            {error}
          </div>
        )}

        {loading ? (
          <p className="text-slate-500 text-sm text-center py-8">Cargando permisos...</p>
        ) : (
          <div className="space-y-4">
            {Object.entries(grouped).map(([module, perms]) => (
              <div key={module} className="space-y-2">
                <h4 className="text-white text-sm font-semibold">
                  {MODULE_LABELS[module] ?? module}
                </h4>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {perms.map((perm) => {
                    const checked = selected.has(perm.id);
                    return (
                      <label
                        key={perm.id}
                        className={`flex items-center gap-2.5 rounded-xl border px-3 py-2 cursor-pointer transition-colors ${
                          checked
                            ? "border-cyan-500/40 bg-cyan-500/10"
                            : "border-slate-700 bg-slate-900/60 hover:border-slate-600"
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => togglePermission(perm.id)}
                          className="hidden"
                        />
                        <span
                          className={`flex-shrink-0 w-4 h-4 rounded border flex items-center justify-center ${
                            checked
                              ? "bg-cyan-500 border-cyan-500"
                              : "border-slate-600 bg-slate-800"
                          }`}
                        >
                          {checked && <Check size={12} className="text-vimdy-background" />}
                        </span>
                        <span className="text-xs text-slate-300">{perm.description}</span>
                      </label>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        )}

        <div className="flex items-center justify-between mt-5">
          <SavedToast show={saved} label="Permisos guardados" />
          <div className="flex gap-2 ml-auto">
            <VimdyButton onClick={onClose} variant="secondary" size="sm">
              Cancelar
            </VimdyButton>
            <VimdyButton
              onClick={handleSave}
              disabled={saving || loading}
              loading={saving}
              variant="primary"
              size="sm"
            >
              Guardar
            </VimdyButton>
          </div>
        </div>
      </div>
    </div>
  );
}

function SavedToast({ show, label = "Guardado" }: { show: boolean; label?: string }) {
  if (!show) return null;
  return (
    <span className="inline-flex items-center gap-1 text-xs font-semibold text-green-400">
      <Check size={13} />
      {label}
    </span>
  );
}
