/* ===========================================================================
   rolePermissions
   ---------------------------------------------------------------------------
   Con el login migrado a Supabase Auth, el rol de cada usuario ya no vive
   en el RoleEngine local (IndexedDB) sino en `business_members.role`
   (ver authBusinessContext.ts y supabase/schema.sql) — un simple string:
   'ADMIN' | 'GERENTE' | 'CAJERO' | 'MESERO' | 'COCINA' | ...

   AuthContext necesita saber qué puede hacer cada rol para que `can()`
   siga funcionando en toda la UI (ProtectedRoute, SettingsDashboard, etc)
   sin tener que ir a preguntarle a la base de datos en cada click.

   Este mapa es el mismo catálogo que ya existía en seedIdentity.ts (el
   que sembraba roles en el sistema viejo de IndexedDB) — se mantiene
   aquí como la versión "cliente" de esa misma tabla de permisos.
=========================================================================== */

export const ROLE_PERMISSIONS: Record<string, string[]> = {
  ADMIN: ["*"],

  GERENTE: [
    "sales.view", "sales.create", "sales.edit", "sales.refund",
    "inventory.view", "inventory.create", "inventory.edit", "inventory.adjust",
    "customers.view", "customers.create", "customers.edit",
    "kitchen.view", "tables.view", "tables.manage",
    "cash.view", "shift.view",
    "reports.view", "reports.export",
    "users.view"
  ],

  CAJERO: [
    "sales.view", "sales.create",
    "customers.view", "customers.create",
    "cash.view", "cash.registerMovement",
    "shift.view", "shift.open", "shift.close"
  ],

  MESERO: [
    "tables.view", "tables.manage", "tables.merge",
    "kitchen.view",
    "customers.view", "customers.create"
  ],

  COCINA: ["kitchen.view", "kitchen.manage"],

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

export function permissionsForRole(role: string): string[] {
  return ROLE_PERMISSIONS[role] ?? [];
}