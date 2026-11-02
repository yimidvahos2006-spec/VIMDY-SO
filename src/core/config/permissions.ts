/* ===========================================================================
   rolePermissions
   ---------------------------------------------------------------------------
   Con el login migrado a Supabase Auth, el rol de cada usuario ya no vive
   en el RoleEngine local (IndexedDB) sino en `business_members.role`
   (ver authBusinessContext.ts y supabase/schema.sql) — un simple string.

   AuthContext necesita saber qué puede hacer cada rol para que `can()`
   siga funcionando en toda la UI (ProtectedRoute, SettingsDashboard, etc)
   sin tener que ir a preguntarle a la base de datos en cada click.

   Este es el ÚNICO catálogo de permisos por rol. `infrastructure/supabase/
   rolePermissions.ts` lo reexporta. Antes había dos copias desincronizadas:
   la de aquí traía `staff.view` en GERENTE y CAJERO y la de infraestructura
   (la que de verdad usa AuthContext.can()) no. Se conservó el comportamiento
   REAL de la app: CAJERO y GERENTE no llevan `staff.view` (el cajero no entra
   a /meseros; el gerente entra por `tables.view`).

   Los 4 roles asignables (ADMIN, CAJERO, MESERO, COCINA) están tipados en
   STAFF_ROLE_PERMISSIONS: si falta uno, TypeScript no compila. Los roles
   antiguos siguen aquí solo para cuentas que ya los tenían.
=========================================================================== */

import { WAITERS_MANAGE_PERMISSION, type LegacyRole, type StaffRole } from "./staffRoles";

export type { LegacyRole };

export const STAFF_ROLE_PERMISSIONS: Readonly<Record<StaffRole, readonly string[]>> = {
  // "inventory.viewCosts" (ver costos y valor del inventario) es SOLO de ADMIN:
  // lo cubre el "*". Ningún otro rol lo lleva a propósito; para dárselo a otro
  // rol hay que agregarlo de forma explícita en su lista.
  // Lo mismo aplica a "waiters.manage" (administrar tarjetas de meseros): solo ADMIN.
  ADMIN: ["*"],

  CAJERO: [
    "sales.view", "sales.create",
    "customers.view", "customers.create",
    "cash.view", "cash.registerMovement",
    "shift.view", "shift.close"
  ],

  MESERO: [
    "tables.view", "tables.manage", "tables.merge",
    "kitchen.view",
    "customers.view", "customers.create"
  ],

  COCINA: ["kitchen.view", "kitchen.manage"]
};

export const LEGACY_ROLE_PERMISSIONS: Readonly<Record<LegacyRole, readonly string[]>> = {
  GERENTE: [
    "sales.view", "sales.create", "sales.edit", "sales.refund",
    "inventory.view", "inventory.create", "inventory.edit", "inventory.adjust",
    "customers.view", "customers.create", "customers.edit",
    "kitchen.view", "tables.view", "tables.manage",
    "cash.view", "cash.registerMovement", "cash.transfer",
    "shift.view", "shift.close",
    "reports.view", "reports.export",
    "users.view"
  ],

  INVENTARIO: [
    "inventory.view", "inventory.create", "inventory.edit", "inventory.adjust",
    "reports.view"
  ],

  CONTADOR: [
    "sales.view", "cash.view", "shift.view",
    "reports.view", "reports.export"
  ],

  SOPORTE: ["users.view", "reports.view"]
};

/** Catálogo completo (4 roles vigentes + antiguos) indexable por el string que llega de la base. */
export const ROLE_PERMISSIONS: Record<string, string[]> = Object.fromEntries(
  Object.entries({ ...LEGACY_ROLE_PERMISSIONS, ...STAFF_ROLE_PERMISSIONS }).map(
    ([role, permissions]) => [role, [...permissions]]
  )
);

export function permissionsForRole(role: string): string[] {
  return Object.prototype.hasOwnProperty.call(ROLE_PERMISSIONS, role) ? ROLE_PERMISSIONS[role] : [];
}

/** ¿Este rol puede administrar las tarjetas de meseros? (ADMIN por "*"; nadie más). */
export function roleCanManageWaiters(role: string | null | undefined): boolean {
  if (!role) return false;
  const permissions = permissionsForRole(role);
  return permissions.includes("*") || permissions.includes(WAITERS_MANAGE_PERMISSION);
}