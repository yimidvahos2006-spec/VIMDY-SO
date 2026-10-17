/**
 * Textos simples (para un dueño nuevo) de "Usuarios y roles".
 * Solo cambian lo que se MUESTRA; los ids y permisos guardados no se tocan.
 */

const ROLE_HELP: Record<string, string> = {
  ADMIN: "Es el dueño: puede hacerlo todo.",
  GERENTE: "Maneja el día a día: ventas, inventario, caja y reportes.",
  CAJERO: "Cobra a los clientes y abre y cierra su turno de caja.",
  MESERO: "Atiende las mesas y manda los pedidos a cocina.",
  COCINA: "Ve los pedidos de cocina y los marca como listos.",
  INVENTARIO: "Maneja los productos y las cantidades que hay.",
  CONTADOR: "Solo mira ventas, caja y reportes, y los puede descargar.",
  SOPORTE: "Solo mira la lista de personas y los reportes."
};

export function roleHelp(roleId: string, permissions: readonly string[] = []): string {
  const known = ROLE_HELP[roleId];
  if (known) return known;
  if (permissions.includes("*")) return "Puede hacerlo todo.";
  const n = permissions.length;
  return `Rol creado por ti, con ${n} cosa${n === 1 ? "" : "s"} que puede hacer.`;
}

export function roleSummary(permissions: readonly string[]): string {
  if (permissions.includes("*")) return "Puede hacerlo todo";
  const n = permissions.length;
  return `Puede hacer ${n} cosa${n === 1 ? "" : "s"}`;
}

export function userStatusLabel(status: string): string {
  if (status === "ACTIVE") return "Activo";
  if (status === "SUSPENDED") return "Sin acceso";
  if (status === "DELETED") return "Eliminado";
  return status;
}

const PERMISSION_LABELS: Record<string, string> = {
  "sales.view": "Ver las ventas",
  "sales.create": "Cobrar y registrar ventas",
  "sales.edit": "Cambiar ventas ya hechas",
  "sales.delete": "Borrar ventas",
  "sales.refund": "Hacer devoluciones",
  "sales.cancel": "Cancelar ventas",
  "inventory.view": "Ver el inventario",
  "inventory.create": "Crear productos",
  "inventory.edit": "Cambiar productos y precios",
  "inventory.delete": "Borrar productos",
  "inventory.adjust": "Corregir las cantidades del inventario",
  "inventory.transfer": "Pasar productos entre sucursales",
  "customers.view": "Ver clientes",
  "customers.create": "Crear clientes",
  "customers.edit": "Cambiar datos de clientes",
  "customers.delete": "Borrar clientes",
  "kitchen.view": "Ver los pedidos de cocina",
  "kitchen.create": "Mandar pedidos a cocina",
  "kitchen.complete": "Marcar pedidos como listos",
  "kitchen.manage": "Marcar pedidos como listos",
  "tables.view": "Ver las mesas",
  "tables.edit": "Cambiar las mesas",
  "tables.manage": "Abrir, cerrar y mover mesas",
  "tables.merge": "Juntar mesas",
  "cash.view": "Ver el dinero de la caja",
  "cash.close": "Cerrar el turno de caja",
  "cash.registerMovement": "Anotar dinero que entra o sale de la caja",
  "cash.transfer": "Pasar efectivo de una caja a otra",
  "shift.view": "Ver los turnos de caja",
  "shift.open": "Abrir el turno de caja",
  "shift.close": "Cerrar el turno de caja",
  "reports.view": "Ver los reportes",
  "reports.export": "Descargar los reportes",
  "users.view": "Ver las personas con acceso",
  "users.create": "Agregar personas",
  "users.edit": "Cambiar datos de las personas",
  "users.suspend": "Quitar o devolver el acceso a una persona",
  "users.delete": "Eliminar personas",
  "roles.view": "Ver los roles",
  "roles.manage": "Crear y cambiar roles",
  "config.view": "Ver los ajustes",
  "config.edit": "Cambiar los ajustes",
  "company.settings": "Cambiar los datos del negocio"
};

export function permissionLabel(id: string, fallback?: string): string {
  return PERMISSION_LABELS[id] ?? fallback ?? id;
}

export const PERMISSION_MODULE_LABELS: Record<string, string> = {
  sales: "Ventas",
  inventory: "Inventario",
  kitchen: "Cocina",
  tables: "Mesas",
  cash: "Caja",
  shift: "Turnos de caja",
  customers: "Clientes",
  reports: "Reportes",
  users: "Personas",
  roles: "Roles",
  config: "Ajustes",
  company: "Mi negocio"
};

export const PERMISSION_MODULE_ORDER = [
  "sales",
  "inventory",
  "kitchen",
  "tables",
  "cash",
  "shift",
  "customers",
  "reports",
  "users",
  "roles",
  "config",
  "company"
];