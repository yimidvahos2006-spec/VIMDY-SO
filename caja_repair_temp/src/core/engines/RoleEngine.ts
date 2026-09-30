import { Role } from "../entities/Entities";
import { IRepository } from "../../infrastructure/di/repositories/IRepository";

import { PermissionEngine } from "./PermissionEngine";
import { vimdyCore } from "../VimdyCore";

/* ===========================================================================
   RoleEngine
   ---------------------------------------------------------------------------
   Administra los ROLES de VIMDY: agrupaciones de permisos con nombre
   (ej. "CAJERO" = ["sales.create", "payments.process", ...]). No administra
   usuarios (eso es UserEngine) ni decide accesos en tiempo de ejecución
   (eso es AccessEngine, que consulta a este motor).

   Permite roles personalizados además de los predefinidos del sistema.
   Los roles del sistema (isSystem: true) no se pueden eliminar ni renombrar,
   para que el negocio siempre tenga una base mínima funcionando.

   Conexiones directas:
     - IRepository<Role>  → persistencia de los roles.
     - PermissionEngine    → valida que los permisos asignados a un rol
                              existan realmente en el catálogo.
=========================================================================== */
export class RoleEngine {
  constructor(
    private readonly repository: IRepository<Role>,
    private readonly permissions: PermissionEngine
  ) {}

  /**
   * Crea un rol nuevo. `permissionIds` puede incluir "*" para dar acceso
   * total (super-admin), o una lista de permisos puntuales.
   */
  public async createRole(
    id: string,
    name: string,
    permissionIds: string[],
    options?: { description?: string; isSystem?: boolean }
  ): Promise<Role> {
    const existing = await this.repository.findById(id);
    if (existing) {
      throw new Error(`ROLE_ALREADY_EXISTS: ya existe un rol con id "${id}".`);
    }

    await this.validatePermissions(permissionIds);

    const role: Role = {
      id,
      name,
      description: options?.description,
      permissions: permissionIds,
      isSystem: options?.isSystem ?? false,
      createdAt: new Date(),
      updatedAt: new Date()
    };

    await this.repository.save(role);
    vimdyCore.emit("access", { action: "ROLE_CREATED", role });

    return role;
  }

  public async getRole(id: string): Promise<Role> {
    const role = await this.repository.findById(id);
    if (!role) throw new Error("ROLE_NOT_FOUND");
    return role;
  }

  public async listRoles(): Promise<Role[]> {
    return this.repository.findAll();
  }

  /** Reemplaza por completo la lista de permisos de un rol. */
  public async setPermissions(roleId: string, permissionIds: string[]): Promise<Role> {
    const role = await this.getRole(roleId);
    await this.validatePermissions(permissionIds);

    const updated: Role = { ...role, permissions: permissionIds, updatedAt: new Date() };
    await this.repository.update(updated);

    vimdyCore.emit("access", { action: "ROLE_PERMISSIONS_UPDATED", role: updated });
    return updated;
  }

  public async grantPermission(roleId: string, permissionId: string): Promise<Role> {
    const role = await this.getRole(roleId);
    if (role.permissions.includes(permissionId)) return role;

    return this.setPermissions(roleId, [...role.permissions, permissionId]);
  }

  public async revokePermission(roleId: string, permissionId: string): Promise<Role> {
    const role = await this.getRole(roleId);
    return this.setPermissions(
      roleId,
      role.permissions.filter(id => id !== permissionId)
    );
  }

  public async renameRole(roleId: string, name: string, description?: string): Promise<Role> {
    const role = await this.getRole(roleId);

    const updated: Role = { ...role, name, description: description ?? role.description, updatedAt: new Date() };
    await this.repository.update(updated);

    return updated;
  }

  public async deleteRole(roleId: string): Promise<void> {
    const role = await this.getRole(roleId);

    if (role.isSystem) {
      throw new Error(`ROLE_IS_SYSTEM: el rol "${role.name}" es del sistema y no se puede eliminar.`);
    }

    await this.repository.delete(roleId);
    vimdyCore.emit("access", { action: "ROLE_DELETED", roleId });
  }

  /**
   * ¿El rol tiene el permiso indicado? "*" en la lista de permisos
   * significa acceso total. Es usado directamente por AccessEngine.
   */
  public async roleHasPermission(roleId: string, permissionId: string): Promise<boolean> {
    const role = await this.repository.findById(roleId);
    if (!role) return false;

    return role.permissions.includes("*") || role.permissions.includes(permissionId);
  }

  public async seedDefaultPermissions(): Promise<void> {
    await this.permissions.registerMany([
      { id: "sales.create", module: "sales", description: "Crear ventas" },
      { id: "sales.view", module: "sales", description: "Ver ventas" },
      { id: "sales.edit", module: "sales", description: "Editar ventas" },
      { id: "sales.delete", module: "sales", description: "Eliminar ventas" },
      { id: "sales.refund", module: "sales", description: "Hacer devoluciones" },
      { id: "sales.cancel", module: "sales", description: "Cancelar ventas" },
      { id: "inventory.create", module: "inventory", description: "Crear productos" },
      { id: "inventory.view", module: "inventory", description: "Ver inventario" },
      { id: "inventory.edit", module: "inventory", description: "Editar productos y precios" },
      { id: "inventory.transfer", module: "inventory", description: "Transferir stock" },
      { id: "kitchen.create", module: "kitchen", description: "Crear comandas" },
      { id: "kitchen.view", module: "kitchen", description: "Ver comandas" },
      { id: "kitchen.complete", module: "kitchen", description: "Marcar comanda como lista" },
      { id: "reports.view", module: "reports", description: "Ver reportes" },
      { id: "reports.export", module: "reports", description: "Exportar reportes" },
      { id: "config.view", module: "config", description: "Ver configuración" },
      { id: "config.edit", module: "config", description: "Editar configuración" },
      { id: "users.create", module: "users", description: "Crear usuarios" },
      { id: "users.view", module: "users", description: "Ver usuarios" },
      { id: "users.edit", module: "users", description: "Editar usuarios" },
      { id: "users.suspend", module: "users", description: "Suspender usuarios" },
      { id: "customers.create", module: "customers", description: "Crear clientes" },
      { id: "customers.view", module: "customers", description: "Ver clientes" },
      { id: "customers.edit", module: "customers", description: "Editar clientes" },
      { id: "tables.view", module: "tables", description: "Ver mesas" },
      { id: "tables.edit", module: "tables", description: "Editar mesas" },
      { id: "cash.view", module: "cash", description: "Ver movimientos de caja" },
      { id: "cash.close", module: "cash", description: "Cerrar turno de caja" }
    ]);
  }

  private async validatePermissions(permissionIds: string[]): Promise<void> {
    for (const id of permissionIds) {
      if (id === "*") continue;

      const exists = await this.permissions.exists(id);
      if (!exists) {
        throw new Error(`PERMISSION_NOT_FOUND: el permiso "${id}" no existe en el catálogo.`);
      }
    }
  }
}