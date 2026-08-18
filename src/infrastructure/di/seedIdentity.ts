import { PermissionEngine } from "../../core/engines/PermissionEngine";
import { RoleEngine } from "../../core/engines/RoleEngine";
import { logWarning } from "../logging/opsLogger";
import { supabase } from "../supabase/supabaseClient";

let identitySeeded = false;

export async function seedIdentity(
  permissions: PermissionEngine,
  roles: RoleEngine
): Promise<void> {
  if (identitySeeded) return;

  try {
    const { data } = await supabase.auth.getSession();
    if (!data.session) return;
  } catch {
    return;
  }

  try {
    await doSeed(permissions, roles);
    identitySeeded = true;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const isPermissionError =
      message.includes("permission denied") ||
      message.includes("JWT") ||
      message.includes("session") ||
      message.includes("RLS") ||
      message.includes("new row violates");

    if (!isPermissionError) {
      logWarning("seedIdentity falló (sin negocio activo o sin sesión). Se reintentará después del login.", {
        context: { error: String(error) }
      });
    }
  }
}

export async function ensureIdentity(
  permissions: PermissionEngine,
  roles: RoleEngine
): Promise<void> {
  if (identitySeeded) return;
  await doSeed(permissions, roles);
  identitySeeded = true;
}

async function doSeed(
  permissions: PermissionEngine,
  roles: RoleEngine
): Promise<void> {
  await permissions.registerMany([
    { id: "sales.view", module: "sales", description: "Ver ventas" },
    { id: "sales.create", module: "sales", description: "Registrar ventas" },
    { id: "sales.edit", module: "sales", description: "Editar ventas" },
    { id: "sales.delete", module: "sales", description: "Eliminar ventas" },
    { id: "sales.refund", module: "sales", description: "Hacer devoluciones" },
    { id: "inventory.view", module: "inventory", description: "Ver inventario" },
    { id: "inventory.create", module: "inventory", description: "Crear productos" },
    { id: "inventory.edit", module: "inventory", description: "Editar productos y precios" },
    { id: "inventory.delete", module: "inventory", description: "Eliminar productos" },
    { id: "inventory.adjust", module: "inventory", description: "Ajustar stock manualmente" },
    { id: "customers.view", module: "customers", description: "Ver clientes" },
    { id: "customers.create", module: "customers", description: "Crear clientes" },
    { id: "customers.edit", module: "customers", description: "Editar clientes" },
    { id: "customers.delete", module: "customers", description: "Eliminar clientes" },
    { id: "kitchen.view", module: "kitchen", description: "Ver comandas" },
    { id: "kitchen.manage", module: "kitchen", description: "Gestionar estado de comandas" },
    { id: "tables.view", module: "tables", description: "Ver mesas" },
    { id: "tables.manage", module: "tables", description: "Abrir, cerrar y mover mesas" },
    { id: "tables.merge", module: "tables", description: "Unir mesas" },
    { id: "cash.view", module: "cash", description: "Ver movimientos de caja" },
    { id: "cash.registerMovement", module: "cash", description: "Registrar ingresos/egresos" },
    { id: "shift.view", module: "shift", description: "Ver turnos de caja" },
    { id: "shift.open", module: "shift", description: "Abrir turno de caja" },
    { id: "shift.close", module: "shift", description: "Cerrar turno de caja" },
    { id: "reports.view", module: "reports", description: "Ver reportes" },
    { id: "reports.export", module: "reports", description: "Exportar reportes" },
    { id: "users.view", module: "users", description: "Ver usuarios" },
    { id: "users.create", module: "users", description: "Crear usuarios" },
    { id: "users.edit", module: "users", description: "Editar usuarios" },
    { id: "users.delete", module: "users", description: "Eliminar usuarios" },
    { id: "roles.view", module: "roles", description: "Ver roles" },
    { id: "roles.manage", module: "roles", description: "Crear y editar roles" },
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
