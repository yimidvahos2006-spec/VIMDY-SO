import { UserEngine } from "./UserEngine";
import { RoleEngine } from "./RoleEngine";
import { vimdyCore } from "../VimdyCore";

/* ===========================================================================
   AccessEngine
   ---------------------------------------------------------------------------
   Punto único de decisión de autorización en VIMDY:

       ¿Tiene permiso? → Sí → ejecutar
                        → No → ACCESS_DENIED

   Cualquier motor que vaya a ejecutar una acción sensible (borrar una
   venta, cambiar un precio, eliminar un usuario) debería preguntarle
   primero a AccessEngine, en vez de reimplementar su propia validación de
   roles. Así, agregar o quitar permisos a un rol no requiere tocar el
   código de los demás motores — solo la configuración del rol.

   Conexiones directas:
     - UserEngine → de dónde sale el roleId del usuario que pide la acción.
     - RoleEngine  → si ese rol tiene o no el permiso solicitado.
=========================================================================== */
export class AccessEngine {
  constructor(
    private readonly users: UserEngine,
    private readonly roles: RoleEngine
  ) {}

  /** ¿El usuario tiene el permiso indicado? No lanza error, solo informa. */
  public async can(userId: string, permissionId: string): Promise<boolean> {
    const user = await this.users.getUser(userId);

    if (user.status !== "ACTIVE") return false;

    return this.roles.roleHasPermission(user.roleId, permissionId);
  }

  /** ¿El usuario tiene AL MENOS UNO de los permisos indicados? */
  public async canAny(userId: string, permissionIds: string[]): Promise<boolean> {
    for (const permissionId of permissionIds) {
      if (await this.can(userId, permissionId)) return true;
    }
    return false;
  }

  /**
   * Exige el permiso indicado antes de continuar. Lanza ACCESS_DENIED si
   * el usuario no lo tiene, y deja rastro del intento denegado.
   */
  public async assert(userId: string, permissionId: string): Promise<void> {
    const allowed = await this.can(userId, permissionId);

    if (!allowed) {
      vimdyCore.emit("access", { action: "DENIED", userId, permissionId });
      throw new Error(`ACCESS_DENIED: el usuario no tiene el permiso "${permissionId}".`);
    }
  }
}