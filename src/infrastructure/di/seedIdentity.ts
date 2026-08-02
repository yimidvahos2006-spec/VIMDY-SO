import { PermissionEngine } from "../../core/engines/PermissionEngine";
import { RoleEngine } from "../../core/engines/RoleEngine";

/* ===========================================================================
   seedIdentity
   ---------------------------------------------------------------------------
   Carga el catálogo inicial de permisos y los roles base del negocio.
   Se ejecuta una sola vez al arrancar la app (desde CompositionRoot).

   Agregar un permiso o rol nuevo en el futuro NO requiere tocar los demás
   motores: solo agregarlo aquí (o crearlo en vivo desde RoleEngine /
   PermissionEngine, ej. desde una pantalla de administración).
=========================================================================== */
export async function seedIdentity(
  permissions: PermissionEngine,
  roles: RoleEngine
): Promise<void> {
  await permissions.registerMany([
    // Ventas
    { id: "sales.view", module: "sales", description: "Ver ventas" },
    { id: "sales.create", module: "sales", description: "Registrar ventas" },
    { id: "sales.edit", module: "sales", description: "Editar ventas" },
    { id: "sales.delete", module: "sales", description: "Eliminar ventas" },
    { id: "sales.refund", module: "sales", description: "Hacer devoluciones" },

    // Inventario
    { id: "inventory.view", module: "inventory", description: "Ver inventario" },
    { id: "inventory.create", module: "inventory", description: "Crear productos" },
    { id: "inventory.edit", module: "inventory", description: "Editar productos y precios" },
    { id: "inventory.delete", module: "inventory", description: "Eliminar productos" },
    { id: "inventory.adjust", module: "inventory", description: "Ajustar stock manualmente" },

    // Clientes
    { id: "customers.view", module: "customers", description: "Ver clientes" },
    { id: "customers.create", module: "customers", description: "Crear clientes" },
    { id: "customers.edit", module: "customers", description: "Editar clientes" },
    { id: "customers.delete", module: "customers", description: "Eliminar clientes" },

    // Cocina
    { id: "kitchen.view", module: "kitchen", description: "Ver comandas" },
    { id: "kitchen.manage", module: "kitchen", description: "Gestionar estado de comandas" },

    // Mesas
    { id: "tables.view", module: "tables", description: "Ver mesas" },
    { id: "tables.manage", module: "tables", description: "Abrir, cerrar y mover mesas" },
    { id: "tables.merge", module: "tables", description: "Unir mesas" },

    // Caja y turnos
    { id: "cash.view", module: "cash", description: "Ver movimientos de caja" },
    { id: "cash.registerMovement", module: "cash", description: "Registrar ingresos/egresos" },
    { id: "shift.view", module: "shift", description: "Ver turnos de caja" },
    { id: "shift.open", module: "shift", description: "Abrir turno de caja" },
    { id: "shift.close", module: "shift", description: "Cerrar turno de caja" },

    // Reportes
    { id: "reports.view", module: "reports", description: "Ver reportes" },
    { id: "reports.export", module: "reports", description: "Exportar reportes" },

    // Usuarios y roles
    { id: "users.view", module: "users", description: "Ver usuarios" },
    { id: "users.create", module: "users", description: "Crear usuarios" },
    { id: "users.edit", module: "users", description: "Editar usuarios" },
    { id: "users.delete", module: "users", description: "Eliminar usuarios" },
    { id: "roles.view", module: "roles", description: "Ver roles" },
    { id: "roles.manage", module: "roles", description: "Crear y editar roles" },

    // Empresa
    { id: "company.settings", module: "company", description: "Editar configuración del negocio" }
  ]);

  const createIfMissing = async (id: string, name: string, permissionIds: string[]) => {
    try {
      await roles.getRole(id);
    } catch {
      await roles.createRole(id, name, permissionIds, { isSystem: true });
    }
  };

  await createIfMissing("ADMIN", "Administrador", ["*"]);

  await createIfMissing("GERENTE", "Gerente", [
    "sales.view", "sales.create", "sales.edit", "sales.refund",
    "inventory.view", "inventory.create", "inventory.edit", "inventory.adjust",
    "customers.view", "customers.create", "customers.edit",
    "kitchen.view", "tables.view", "tables.manage",
    "cash.view", "shift.view",
    "reports.view", "reports.export",
    "users.view"
  ]);

  await createIfMissing("CAJERO", "Cajero", [
    "sales.view", "sales.create",
    "customers.view", "customers.create",
    "cash.view", "cash.registerMovement",
    "shift.view", "shift.open", "shift.close"
  ]);

  await createIfMissing("MESERO", "Mesero", [
    "tables.view", "tables.manage", "tables.merge",
    "kitchen.view",
    "customers.view", "customers.create"
  ]);

  await createIfMissing("COCINA", "Cocina", [
    "kitchen.view", "kitchen.manage"
  ]);

  await createIfMissing("INVENTARIO", "Inventario", [
    "inventory.view", "inventory.create", "inventory.edit", "inventory.adjust",
    "reports.view"
  ]);

  await createIfMissing("CONTADOR", "Contador", [
    "sales.view", "cash.view", "shift.view",
    "reports.view", "reports.export"
  ]);

  await createIfMissing("SOPORTE", "Soporte", [
    "users.view", "reports.view"
  ]);
}