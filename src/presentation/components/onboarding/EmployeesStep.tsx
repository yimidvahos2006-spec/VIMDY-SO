import { useState, type FormEvent } from "react";
import {
  Shield,
  Wallet,
  Utensils,
  ChefHat,
  UserPlus,
  Loader2,
  CheckCircle2
} from "lucide-react";

import { VimdyCard } from "../ui/VimdyCard";
import { VimdyButton } from "../ui/VimdyButton";
import { VimdyInput } from "../ui/VimdyInput";
import { PasswordField } from "../ui/PasswordField";
import { container } from "../../../infrastructure/di/CompositionRoot";
import { useAuth } from "../../context/AuthContext";
import { translateBusinessError } from "../../../core/errors/translateBusinessError";
import type { ModuleId } from "../../../core/config/modules";
import { useCanUse } from "../../../hooks/useCanUse";
import { useStepDraft } from "./useStepDraft";
import { onboardingStepLabel } from "./onboardingSteps";

const MIN_PASSWORD_LENGTH = 8;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

interface EmployeesStepProps {
  enabledModules: ModuleId[];
  onDone: () => void;
}

interface EmployeeRoleOption {
  roleId: "ADMIN" | "CAJERO" | "MESERO" | "COCINA";
  label: string;
  description: string;
  emoji: string;
  requiresModule?: ModuleId;
}

const EMPLOYEE_ROLE_OPTIONS: EmployeeRoleOption[] = [
  { roleId: "ADMIN", label: "Administrador", description: "Acceso total al negocio", emoji: "🛡️" },
  { roleId: "CAJERO", label: "Cajero", description: "Cobra y maneja la caja", emoji: "💵" },
  { roleId: "MESERO", label: "Mesero", description: "Toma los pedidos", emoji: "🧑‍🍳", requiresModule: "mesas" },
  { roleId: "COCINA", label: "Cocina", description: "Ve y prepara los pedidos", emoji: "👨‍🍳", requiresModule: "cocina" }
];

const ROLE_ICONS: Record<string, React.ElementType> = {
  ADMIN: Shield,
  CAJERO: Wallet,
  MESERO: Utensils,
  COCINA: ChefHat
};

interface AddedEmployee {
  id: string;
  name: string;
  roleLabel: string;
}

interface EmployeesDraft {
  name: string;
  email: string;
  roleId: EmployeeRoleOption["roleId"];
  added: AddedEmployee[];
}

function sanitizeEmployeesDraft(raw: unknown): EmployeesDraft | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const roleId = EMPLOYEE_ROLE_OPTIONS.find((option) => option.roleId === r.roleId)?.roleId ?? "CAJERO";
  const added = Array.isArray(r.added)
    ? r.added.flatMap((item): AddedEmployee[] => {
        if (!item || typeof item !== "object") return [];
        const e = item as Record<string, unknown>;
        return typeof e.id === "string" && typeof e.name === "string" && typeof e.roleLabel === "string"
          ? [{ id: e.id, name: e.name, roleLabel: e.roleLabel }]
          : [];
      })
    : [];
  return {
    name: typeof r.name === "string" ? r.name.slice(0, 120) : "",
    email: typeof r.email === "string" ? r.email.slice(0, 200) : "",
    roleId,
    added,
  };
}

export function EmployeesStep({ enabledModules, onDone }: EmployeesStepProps) {
  const { user } = useAuth();

  // El rol Mesero aparece si el negocio usa meseros o tiene mesas; Cocina, si tiene cocina.
  const usesWaiters = useCanUse("waiters");
  const availableRoles = EMPLOYEE_ROLE_OPTIONS.filter(
    (option) =>
      !option.requiresModule ||
      enabledModules.includes(option.requiresModule) ||
      (option.roleId === "MESERO" && usesWaiters)
  );

  // Nombre, correo, rol y la lista de agregados se guardan al instante y se
  // recuperan si el usuario sale o recarga. La contraseña NUNCA se guarda.
  const [draft, setDraft] = useStepDraft<EmployeesDraft>(
    "employees",
    { name: "", email: "", roleId: availableRoles[0]?.roleId ?? "CAJERO", added: [] },
    sanitizeEmployeesDraft
  );
  const { name, email, added } = draft;
  const roleId: EmployeeRoleOption["roleId"] = availableRoles.some((option) => option.roleId === draft.roleId)
    ? draft.roleId
    : (availableRoles[0]?.roleId ?? "CAJERO");
  const setName = (value: string) => setDraft((current) => ({ ...current, name: value }));
  const setEmail = (value: string) => setDraft((current) => ({ ...current, email: value }));
  const setRoleId = (value: EmployeeRoleOption["roleId"]) => setDraft((current) => ({ ...current, roleId: value }));
  const setAdded = (update: (previous: AddedEmployee[]) => AddedEmployee[]) =>
    setDraft((current) => ({ ...current, added: update(current.added) }));
  const [password, setPassword] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleAdd(event: FormEvent) {
    event.preventDefault();
    if (saving) return;

    if (!user?.id) {
      setError("AUTH_USER_REQUIRED");
      return;
    }

    if (!name.trim() || !email.trim() || !password.trim()) {
      setError("Completa nombre, correo y contraseña.");
      return;
    }

    if (!EMAIL_PATTERN.test(email.trim())) {
      setError("Escribe un correo válido, por ejemplo: nombre@correo.com");
      return;
    }

    if (password.trim().length < MIN_PASSWORD_LENGTH) {
      setError(`La contraseña debe tener al menos ${MIN_PASSWORD_LENGTH} caracteres.`);
      return;
    }

    setSaving(true);
    setError(null);

    try {
      const created = await container.userEngine.get().createUser(user.id, {
        name: name.trim(),
        email: email.trim(),
        password: password.trim(),
        roleId
      });

      const roleLabel = EMPLOYEE_ROLE_OPTIONS.find((r) => r.roleId === roleId)?.label ?? roleId;
      setAdded((prev) => [...prev, { id: created.id, name: created.name, roleLabel }]);
      setName("");
      setEmail("");
      setPassword("");
    } catch (err) {
      const message = translateBusinessError(err, "No se pudo crear el empleado.");
      setError(message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="w-full max-w-3xl mx-auto">
      <div className="text-center mb-10">
        <p className="text-vimdy-micro uppercase tracking-widest text-vimdy-accent font-semibold mb-3">{onboardingStepLabel("employees")}</p>
        <h2 className="text-vimdy-h2 text-vimdy-text mb-2">¿Quieres agregar empleados?</h2>
        <p className="text-vimdy-small text-vimdy-text-secondary max-w-md mx-auto">
          Puedes omitir este paso y agregarlos después desde Configuración.
        </p>
      </div>

      <VimdyCard padding="lg" className="w-full">
        {added.length > 0 && (
          <div className="flex flex-col gap-2 mb-6">
            {added.map((emp) => (
              <div
                key={emp.id}
                className="flex items-center gap-3 rounded-vimdy-md border border-vimdy-border-subtle bg-vimdy-surface-hover/60 px-4 py-2.5"
              >
                <span className="text-vimdy-success shrink-0">
                  <CheckCircle2 size={18} />
                </span>
                <span className="flex-1 text-sm font-medium text-vimdy-text">{emp.name}</span>
                <span className="text-xs text-vimdy-text-secondary font-medium">{emp.roleLabel}</span>
              </div>
            ))}
          </div>
        )}

        <form onSubmit={handleAdd} className="flex flex-col gap-4 mb-6">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <VimdyInput
              placeholder="Nombre del empleado"
              value={name}
              onChange={(e) => setName(e.target.value)}
              disabled={saving}
            />
            <VimdyInput
              type="email"
              placeholder="Correo"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="new-password"
              disabled={saving}
            />
          </div>

          <PasswordField
            id="employee-password"
            label="Contraseña"
            value={password}
            onChange={setPassword}
            autoComplete="new-password"
            disabled={saving}
            placeholder={`Mínimo ${MIN_PASSWORD_LENGTH} caracteres`}
          />
          <p className="-mt-2 text-vimdy-micro text-vimdy-text-tertiary">
            Con esta contraseña y el correo, tu empleado entrará a VIMDY.
          </p>

          <div role="radiogroup" aria-label="Rol del empleado">
            <p className="block text-sm font-semibold text-vimdy-text-secondary mb-2">Rol</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {availableRoles.map((option) => {
                const RoleIcon = ROLE_ICONS[option.roleId];
                const selected = roleId === option.roleId;
                return (
                  <button
                    key={option.roleId}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    onClick={() => setRoleId(option.roleId)}
                    disabled={saving}
                    className={`
                      group flex items-center gap-3 rounded-vimdy-md border-2 px-4 py-3 text-left
                      transition-all duration-200 disabled:cursor-not-allowed disabled:opacity-50
                      ${
                        selected
                          ? "border-vimdy-accent bg-vimdy-accent/10"
                          : "border-vimdy-border bg-vimdy-surface hover:border-vimdy-accent/60 hover:bg-vimdy-surface-hover"
                      }
                    `}
                  >
                    <div
                      className={`
                        w-10 h-10 rounded-vimdy-md flex items-center justify-center shrink-0 transition-colors
                        ${selected ? "bg-vimdy-accent/15 text-vimdy-accent" : "bg-vimdy-background text-vimdy-text-secondary group-hover:text-vimdy-text"}
                      `}
                    >
                      {RoleIcon && <RoleIcon size={20} strokeWidth={1.8} />}
                    </div>
                    <div className="flex-1 min-w-0">
                      <span className={`block text-sm font-semibold ${selected ? "text-vimdy-text" : "text-vimdy-text-secondary group-hover:text-vimdy-text"}`}>
                        {option.label}
                      </span>
                      <span className="block text-vimdy-micro text-vimdy-text-tertiary mt-0.5">
                        {option.description}
                      </span>
                    </div>
                    <div
                      className={`
                        w-5 h-5 rounded-full border-2 flex items-center justify-center shrink-0 transition-all
                        ${selected ? "bg-vimdy-accent border-vimdy-accent" : "border-vimdy-border bg-vimdy-surface"}
                      `}
                    >
                      {selected && <CheckCircle2 size={14} className="text-white" />}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {error && (
            <div className="flex items-start gap-2 rounded-vimdy-md border border-vimdy-danger/40 bg-vimdy-danger-bg px-4 py-3 text-vimdy-small text-vimdy-danger">
              <span className="mt-0.5 shrink-0">⚠</span>
              <span>{translateBusinessError(new Error(error), "No se pudo crear el empleado.")}</span>
            </div>
          )}

          <VimdyButton type="submit" variant="secondary" disabled={saving} className="w-full sm:w-auto">
            {saving ? (
              <span className="flex items-center gap-2">
                <Loader2 size={18} className="animate-spin" />
                Agregando...
              </span>
            ) : (
              <span className="flex items-center gap-2">
                <UserPlus size={18} strokeWidth={1.8} />
                Agregar empleado
              </span>
            )}
          </VimdyButton>
        </form>

        <div className="flex justify-center">
          <VimdyButton variant="ghost" onClick={onDone} disabled={saving}>
            {added.length > 0 ? "Continuar" : "Omitir"}
          </VimdyButton>
        </div>
      </VimdyCard>
    </div>
  );
}