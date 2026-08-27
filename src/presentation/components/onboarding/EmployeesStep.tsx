import { useState, type FormEvent } from "react";

import { GlassCard } from "../ui/GlassCard";
import { VimdyButton } from "../ui/VimdyButton";
import { VimdyInput } from "../ui/VimdyInput";
import { PasswordField } from "../ui/PasswordField";
import { container } from "../../../infrastructure/di/CompositionRoot";
import { useAuth } from "../../context/AuthContext";
import type { ModuleId } from "../../../core/config/modules";

interface EmployeesStepProps {
  /** Módulos activos del negocio (PASO 4) — decide qué roles tiene sentido ofrecer. */
  enabledModules: ModuleId[];
  onDone: () => void;
}

interface EmployeeRoleOption {
  roleId: "ADMIN" | "CAJERO" | "MESERO" | "COCINA";
  label: string;
  emoji: string;
  /** Si viene definido, el rol solo se ofrece cuando ese módulo está activo. */
  requiresModule?: ModuleId;
}

const EMPLOYEE_ROLE_OPTIONS: EmployeeRoleOption[] = [
  { roleId: "ADMIN", label: "Administrador", emoji: "🛡️" },
  { roleId: "CAJERO", label: "Cajero", emoji: "💵" },
  { roleId: "MESERO", label: "Mesero", emoji: "🧑‍🍳", requiresModule: "mesas" },
  { roleId: "COCINA", label: "Cocina", emoji: "👨‍🍳", requiresModule: "cocina" }
];

interface AddedEmployee {
  id: string;
  name: string;
  roleLabel: string;
}

/**
 * PASO 6 del asistente de onboarding (FASE 3).
 *
 * Permite agregar empleados reales (Administrador, Cajero, Mesero, Cocina)
 * uno por uno, a través de container.userEngine.get().createUser — el mismo
 * motor real que usa Configuración > Usuarios. Cada empleado queda
 * guardado en Supabase (app_users) apenas se agrega, no al final. Es el
 * único paso del asistente que se puede omitir por completo (el negocio
 * puede operar solo con la cuenta del dueño).
 */
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

  return (
    <GlassCard className="w-full max-w-lg px-6 py-10 sm:px-10 hover:translate-y-0 hover:scale-100 hover:border-slate-800 hover:shadow-xl">
      <div className="flex flex-col items-center gap-2 text-center mb-6">
        <h2 className="text-2xl sm:text-3xl font-bold text-white tracking-wide">
          ¿Quieres agregar empleados?
        </h2>
        <p className="text-slate-400 text-sm max-w-sm">
          Puedes omitir este paso y agregarlos después desde Configuración.
        </p>
      </div>

      {added.length > 0 && (
        <div className="flex flex-col gap-2 mb-6">
          {added.map((emp) => (
            <div
              key={emp.id}
              className="flex items-center gap-3 rounded-xl border border-slate-700 bg-slate-900/60 px-4 py-2"
            >
              <span className="text-emerald-400">✓</span>
              <span className="flex-1 text-sm font-medium text-white">{emp.name}</span>
              <span className="text-xs text-slate-400">{emp.roleLabel}</span>
            </div>
          ))}
        </div>
      )}

      <form onSubmit={handleAdd} className="flex flex-col gap-3 mb-6">
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
          disabled={saving}
        />
        <PasswordField
          id="employee-password"
          label="Contraseña"
          value={password}
          onChange={setPassword}
          disabled={saving}
          placeholder="Contraseña"
          inputClassName="rounded-2xl"
        />

        <select
          value={roleId}
          onChange={(e) => setRoleId(e.target.value as EmployeeRoleOption["roleId"])}
          disabled={saving}
          className="w-full rounded-2xl border border-slate-700 bg-slate-900/80 px-4 py-3 text-white outline-none transition-colors duration-300 focus:border-cyan-500 focus:ring-2 focus:ring-cyan-500/20"
        >
          {availableRoles.map((option) => (
            <option key={option.roleId} value={option.roleId}>
              {option.emoji} {option.label}
            </option>
          ))}
        </select>

        {error && <p className="text-center text-sm text-red-400">{error}</p>}

        <VimdyButton type="submit" variant="secondary" disabled={saving}>
          {saving ? "Agregando..." : "+ Agregar empleado"}
        </VimdyButton>
      </form>

      <div className="flex justify-center gap-3">
        <VimdyButton variant="ghost" onClick={onDone} disabled={saving}>
          {added.length > 0 ? "Continuar" : "Omitir"}
        </VimdyButton>
      </div>
    </GlassCard>
  );
}