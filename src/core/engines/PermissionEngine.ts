import { Permission } from "../entities/Entities";
import { IRepository } from "../../infrastructure/di/repositories/IRepository";

/* ===========================================================================
   PermissionEngine
   ---------------------------------------------------------------------------
   Administra el CATÁLOGO de permisos disponibles en VIMDY. No decide quién
   tiene qué permiso (eso es RoleEngine, a través de Role.permissions) ni si
   una acción puede ejecutarse (eso es AccessEngine). Este motor solo sabe
   qué permisos EXISTEN en el sistema, agrupados por módulo.

   Cada permiso es independiente y granular (ej. "sales.create" es distinto
   de "sales.delete"), siguiendo el mismo patrón que usan sistemas grandes
   (RBAC granular por acción, no por pantalla completa).
=========================================================================== */
export class PermissionEngine {
  constructor(private readonly repository: IRepository<Permission>) {}

  /**
   * Registra un permiso nuevo en el catálogo. Es idempotente: si el permiso
   * ya existe, no hace nada (permite llamarlo libremente desde el bootstrap
   * de la app o desde nuevos módulos que se vayan agregando).
   */
  public async register(
    id: string,
    module: string,
    description: string
  ): Promise<Permission> {
    const existing = await this.repository.findById(id);
    if (existing) return existing;

    const permission: Permission = { id, module, description };
    await this.repository.save(permission);

    return permission;
  }

  /** Registra varios permisos de una sola vez. Útil en el bootstrap inicial. */
  public async registerMany(
    permissions: Array<{ id: string; module: string; description: string }>
  ): Promise<void> {
    for (const permission of permissions) {
      await this.register(permission.id, permission.module, permission.description);
    }
  }

  public async list(): Promise<Permission[]> {
    return this.repository.findAll();
  }

  public async getByModule(module: string): Promise<Permission[]> {
    const permissions = await this.repository.findAll();
    return permissions.filter(permission => permission.module === module);
  }

  public async exists(id: string): Promise<boolean> {
    return this.repository.exists(id);
  }
}