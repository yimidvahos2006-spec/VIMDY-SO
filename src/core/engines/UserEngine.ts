import { User } from "../entities/Entities";
import { UserRepository } from "../../infrastructure/di/repositories/UserRepository";

import { RoleEngine } from "./RoleEngine";
import { AuditEngine } from "./AuditEngine";
import { vimdyCore } from "../VimdyCore";

/* ===========================================================================
   UserEngine
   ---------------------------------------------------------------------------
   Responsable ÚNICAMENTE de los usuarios: alta, edición y estado de la
   cuenta. NO maneja contraseñas ni verifica credenciales — eso es 100%
   responsabilidad de Supabase Auth, server-side (ver
   infrastructure/supabase/authBusinessContext.ts -> signIn(), usada tanto
   por el dueño como por cajero/mesero/cocina desde CRÍTICO #1 del checklist
   de lanzamiento). Tampoco decide si un usuario puede hacer algo (eso es
   AccessEngine).

   Conexiones directas:
     - UserRepository → persistencia del perfil (con búsqueda por email) y
                          alta de la cuenta real vía Edge Function.
     - RoleEngine       → valida que el roleId asignado exista.
     - AuditEngine       → deja rastro de cada acción sensible sobre usuarios.
=========================================================================== */
export class UserEngine {
  constructor(
    private readonly repository: UserRepository,
    private readonly roles: RoleEngine,
    private readonly audit: AuditEngine
  ) {}

  /**
   * Crea un empleado (cajero/mesero/cocina/admin adicional). La contraseña
   * nunca se hashea ni se verifica en el navegador: viaja una sola vez,
   * por HTTPS, a la Edge Function create-staff-user, que crea un usuario
   * real de Supabase Auth y lo asocia al negocio con su rol.
   */
  public async createUser(
    actorId: string,
    data: { name: string; email: string; password: string; roleId: string }
  ): Promise<User> {
    // Lanza ROLE_NOT_FOUND si el rol no existe en el catálogo local.
    await this.roles.getRole(data.roleId);

    const user = await this.repository.createStaffAccount(data);

    await this.audit.log(actorId, "USER_CREATED", "users", `Usuario "${user.name}" creado.`, user.id);
    vimdyCore.emit("user", { action: "CREATED", user });

    return user;
  }

  public async getUser(userId: string): Promise<User> {
    const user = await this.repository.findById(userId);
    if (!user) throw new Error("USER_NOT_FOUND");
    return user;
  }

  public async findByEmail(email: string): Promise<User | null> {
    return this.repository.findByEmail(email);
  }

  public async listUsers(options?: { includeDeleted?: boolean }): Promise<User[]> {
    const users = await this.repository.findAll();
    if (options?.includeDeleted) return users;
    return users.filter(user => user.status !== "DELETED");
  }

  public async updateUser(
    actorId: string,
    userId: string,
    changes: Partial<Pick<User, "name" | "email" | "roleId" | "avatar" | "settings">>
  ): Promise<User> {
    const user = await this.getUser(userId);

    if (changes.roleId) {
      await this.roles.getRole(changes.roleId);
    }

    if (changes.email && changes.email !== user.email) {
      const taken = await this.repository.findByEmail(changes.email);
      if (taken) throw new Error(`EMAIL_ALREADY_IN_USE: ya existe un usuario con el correo "${changes.email}".`);
    }

    const updated: User = { ...user, ...changes, updatedAt: new Date() };
    await this.repository.update(updated);

    await this.audit.log(actorId, "USER_UPDATED", "users", `Usuario "${updated.name}" editado.`, userId);
    vimdyCore.emit("user", { action: "UPDATED", user: updated });

    return updated;
  }

  public async setStatus(
    actorId: string,
    userId: string,
    status: User["status"]
  ): Promise<User> {
    const user = await this.getUser(userId);
    const updated: User = { ...user, status, updatedAt: new Date() };

    await this.repository.update(updated);
    await this.audit.log(
      actorId,
      "USER_STATUS_CHANGED",
      "users",
      `Usuario "${user.name}" pasó a estado ${status}.`,
      userId
    );
    vimdyCore.emit("user", { action: "STATUS_CHANGED", user: updated });

    return updated;
  }

  public activateUser(actorId: string, userId: string) {
    return this.setStatus(actorId, userId, "ACTIVE");
  }

  public suspendUser(actorId: string, userId: string) {
    return this.setStatus(actorId, userId, "SUSPENDED");
  }

  /** Borrado lógico: el usuario no vuelve a poder iniciar sesión, pero se conserva para auditoría. */
  public deleteUser(actorId: string, userId: string) {
    return this.setStatus(actorId, userId, "DELETED");
  }

  /**
   * Cambio de contraseña iniciado por el propio usuario. Ya no vive aquí:
   * cualquier usuario autenticado (dueño o personal, todos son usuarios
   * reales de Supabase Auth) lo hace directamente con
   * supabase.auth.updateUser({ password }) — ver AuthContext.updatePassword,
   * ya conectado en la pantalla de "Actualizar contraseña".
   *
   * Restablecimiento por un administrador (sin la contraseña anterior) y
   * bloqueo por intentos fallidos: Supabase Auth ya aplica su propio
   * rate-limiting de login a nivel de plataforma. Si más adelante se
   * necesita que un ADMIN resetee la contraseña de un empleado sin pasar
   * por "olvidé mi contraseña", agregar una Edge Function admin-only
   * (mismo patrón que create-staff-user) que llame a
   * admin.auth.admin.updateUserById — nunca hacerlo leyendo/escribiendo un
   * hash desde el navegador.
   */
}