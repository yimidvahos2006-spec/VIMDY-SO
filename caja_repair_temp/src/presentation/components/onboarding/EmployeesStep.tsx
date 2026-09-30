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
import type { ModuleId } from "../../../core/config/modules";

interface EmployeesStepProps {
  enabledModules: ModuleId[];
  onDone: () => void;
}

interface EmployeeRoleOption {
  roleId: "ADMIN" | "CAJERO" | "MESERO" | "COCINA";
  label: string;
  emoji: string;
  requiresModule?: ModuleId;
}

const EMPLOYEE_ROLE_OPTIONS: EmployeeRoleOption[] = [
  { roleId: "ADMIN", label: "Administrador", emoji: "🛡️" },
  { roleId: "CAJERO", label: "Cajero", emoji: "💵" },
  { roleId: "MESERO", label: "Mesero", emoji: "🧑‍🍳", requiresModule: "mesas" },
  { roleId: "COCINA", label: "Cocina", emoji: "👨‍🍳", requiresModule: "cocina" }
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

export function EmployeesStep({ enabledModules, onDone }: EmployeesStepProps) {
  const { user } = useAuth();

  const availableRoles = EMPLOYEE_ROLE_OPTIONS.filter(
    (option) => !option.requiresModule || enabledModules.includes(option.requiresModule)
  );

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [roleId, setRoleId] = useState<EmployeeRoleOption["roleId"]>(availableRoles[0]?.roleId ?? "CAJERO");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [added, setAdded] = useState<AddedEmployee[]>([]);

  async function handleAdd(event: FormEvent) {
    event.preventDefault();
    if (saving) return;

    if (!name.trim() || !email.trim() || !password.trim()) {
      setError("Completa nombre, correo y contraseña.");
      return;
    }

    setSaving(true);
    setError(null);

    try {
      const created = await container.userEngine.get().createUser(user?.id ?? "ADMIN", {
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
      const message = err instanceof Error ? err.message : "No se pudo crear el empleado.";
      setError(message);
    } finally {
      setSaving(false);
    }
  }

  const Icon = ROLE_ICONS[roleId];

  return (
    <div className="w-full max-w-3xl mx-auto">
      <div className="text-center mb-10">
        <p className="text-vimdy-micro uppercase tracking-widest text-vimdy-accent font-semibold mb-3">Paso 5 de 7</p>
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
            placeholder="Contraseña"
          />

          <div className="relative">
            <select
              value={roleId}
              onChange={(e) => setRoleId(e.target.value as EmployeeRoleOption["roleId"])}
              disabled={saving}
              className="w-full appearance-none rounded-vimdy-md border-2 border-vimdy-border bg-vimdy-surface px-4 py-3 pl-12 text-vimdy-text outline-none transition-all duration-200 focus:border-vimdy-accent focus:ring-4 focus:ring-vimdy-accent/10 disabled:opacity-50"
            >
              {availableRoles.map((option) => {
                const RoleIcon = ROLE_ICONS[option.roleId];
                return (
                  <option key={option.roleId} value={option.roleId}>
                    {option.label}
                  </option>
                );
              })}
            </select>
            <div className="absolute left-3 top-1/2 -translate-y-1/2 text-vimdy-text-secondary pointer-events-none">
              {Icon && <Icon size={20} strokeWidth={1.8} />}
            </div>
            <div className="absolute right-3 top-1/2 -translate-y-1/2 text-vimdy-text-muted pointer-events-none">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="6 9 12 15 18 9" />
              </svg>
            </div>
          </div>

          {error && (
            <div className="flex items-start gap-2 rounded-vimdy-md border border-vimdy-danger/40 bg-vimdy-danger-bg px-4 py-3 text-vimdy-small text-vimdy-danger">
              <span className="mt-0.5 shrink-0">⚠</span>
              <span>{error}</span>
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