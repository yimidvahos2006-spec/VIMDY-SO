/**
 * permissions.ts
 * ---------------------------------------------------------------------------
 * Centraliza TODOS los permisos de VIMDY como constantes type-safe.
 *
 * Antes los permisos eran strings sueltos esparcidos por el código
 * ("tables.view", "cash.view", etc.) sin validación centralizada.
 * Esto causó errores como usar "tables.view" para Meseros.
 *
 * Ahora:
 *   - Un único origen de verdad
 *   - Type safety: PermissionId solo permite valores válidos
 *   - Fácil refactor: cambiar un permiso = cambiar UNA constante
 */

export const Permissions = {
  // Caja
  CASH_VIEW: 'cash.view',
  CASH_REGISTER_MOVEMENT: 'cash.registerMovement',

  // Turnos
  SHIFT_VIEW: 'shift.view',

  // Mesas (operación de mesas)
  TABLES_VIEW: 'tables.view',
  TABLES_MANAGE: 'tables.manage',
  TABLES_MERGE: 'tables.merge',

  // Personal/Staff (INDEPENDIENTE de mesas)
  // Un negocio puede tener personal sin mesas (mostrador, domicilios, etc.)
  STAFF_VIEW: 'staff.view',
  STAFF_MANAGE: 'staff.manage',

  // Cocina
  KITCHEN_VIEW: 'kitchen.view',

  // Inventario
  INVENTORY_VIEW: 'inventory.view',
  INVENTORY_CREATE: 'inventory.create',
  INVENTORY_EDIT: 'inventory.edit',
  INVENTORY_ADJUST: 'inventory.adjust',

  // Clientes
  CUSTOMERS_VIEW: 'customers.view',
  CUSTOMERS_CREATE: 'customers.create',
  CUSTOMERS_EDIT: 'customers.edit',

  // Reportes
  REPORTS_VIEW: 'reports.view',
  REPORTS_EXPORT: 'reports.export',

  // Usuarios (cuentas con login)
  USERS_VIEW: 'users.view',

  // Configuración
  COMPANY_SETTINGS: 'company.settings',
} as const;

export type PermissionId = typeof Permissions[keyof typeof Permissions];

/**
 * Mapeo de módulo → permiso de acceso.
 * Define qué permiso se necesita para acceder a cada módulo.
 */
export const MODULE_PERMISSION_MAP: Record<string, PermissionId> = {
  caja: Permissions.CASH_VIEW,
  mesas: Permissions.TABLES_VIEW,
  meseros: Permissions.STAFF_VIEW,  // Personal usa permiso STAFF, no TABLES
  cocina: Permissions.KITCHEN_VIEW,
  inventario: Permissions.INVENTORY_VIEW,
  clientes: Permissions.CUSTOMERS_VIEW,
  reportes: Permissions.REPORTS_VIEW,
  company: Permissions.COMPANY_SETTINGS,
};

/**
 * Helper: obtener el permiso requerido para un módulo.
 */
export function getPermissionForModule(moduleId: string): PermissionId | undefined {
  return MODULE_PERMISSION_MAP[moduleId];
}
