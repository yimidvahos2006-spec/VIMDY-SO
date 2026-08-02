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