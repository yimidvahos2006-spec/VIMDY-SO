/* ===========================================================================
   staffRoles
   ---------------------------------------------------------------------------
   Única fuente de verdad (tipada) de los 4 roles con los que VIMDY crea
   personal: ADMIN, CAJERO, MESERO y COCINA.

   Los usan: UserEngine (alta/edición), Configuración > Equipo (selector de
   rol) y las reglas de "quién administra el equipo". El servidor aplica lo
   mismo: la Edge Function create-staff-user solo acepta estos 4 y las
   políticas RLS del Paso 1 dejan escribir equipo/meseros únicamente a ADMIN.

   Los roles antiguos (GERENTE, INVENTARIO, CONTADOR, SOPORTE) siguen
   existiendo en `permissions.ts` para cuentas que ya los tenían, pero ya no
   se pueden asignar a personas nuevas.
=========================================================================== */

export const STAFF_ROLES = ["ADMIN", "CAJERO", "MESERO", "COCINA"] as const;

/** Uno de los 4 roles asignables: "ADMIN" | "CAJERO" | "MESERO" | "COCINA". */
export type StaffRole = (typeof STAFF_ROLES)[number];

/** Roles que ya no se asignan a personas nuevas, pero pueden existir en cuentas viejas. */
export type LegacyRole = "GERENTE" | "INVENTARIO" | "CONTADOR" | "SOPORTE";

/** Cualquier rol que puede traer una cuenta ya guardada (los 4 vigentes + los antiguos). */
export type KnownRole = StaffRole | LegacyRole;

export const STAFF_ROLE_LABELS: Readonly<Record<StaffRole, string>> = {
  ADMIN: "Administrador",
  CAJERO: "Cajero",
  MESERO: "Mesero",
  COCINA: "Cocina"
};

/** Normaliza mayúsculas/espacios. No decide si el rol es válido. */
function normalize(value: unknown): string {
  return typeof value === "string" ? value.trim().toUpperCase() : "";
}

/** Type guard: ¿es exactamente uno de los 4 roles? Acepta " mesero " → true. */
export function isStaffRole(value: unknown): value is StaffRole {
  return (STAFF_ROLES as readonly string[]).includes(normalize(value));
}

/** Devuelve el rol normalizado o `null` si no es uno de los 4. */
export function parseStaffRole(value: unknown): StaffRole | null {
  const role = normalize(value);
  return isStaffRole(role) ? role : null;
}

/** Igual que `parseStaffRole`, pero lanza ROLE_NOT_FOUND (mismo código que usa el resto). */
export function assertStaffRole(value: unknown): StaffRole {
  const role = parseStaffRole(value);
  if (!role) {
    throw new Error(
      `ROLE_NOT_FOUND: el rol "${String(value)}" no es válido. Usa ${STAFF_ROLES.join(", ")}.`
    );
  }
  return role;
}

export function staffRoleLabel(value: unknown): string {
  const role = parseStaffRole(value);
  return role ? STAFF_ROLE_LABELS[role] : String(value ?? "");
}

/** Lista lista para un <select>: [{ id: "ADMIN", name: "Administrador" }, ...]. */
export const STAFF_ROLE_OPTIONS: ReadonlyArray<{ readonly id: StaffRole; readonly name: string }> =
  STAFF_ROLES.map((id) => ({ id, name: STAFF_ROLE_LABELS[id] }));

/**
 * Permiso que protege la administración de las tarjetas de meseros
 * (crear, renombrar, foto, activar/desactivar, borrar y el interruptor global
 * de fotos). Solo ADMIN lo tiene (vía "*"), igual que las políticas RLS de la
 * tabla `waiters` y de `businesses`.
 */
export const WAITERS_MANAGE_PERMISSION = "waiters.manage";