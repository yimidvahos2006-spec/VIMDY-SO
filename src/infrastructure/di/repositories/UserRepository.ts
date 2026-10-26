import { User } from "../../../core/entities/Entities";
import { SupabaseRepository } from "./SupabaseRepository";
import { supabase } from "../../supabase/supabaseClient";
import { CachedList, indexedDbPersistence } from "../../cache/CachedList";
import { vimdyCore } from "../../../core/VimdyCore";

/**
 * UserRepository
 * ---------------------------------------------------------------------------
 * Migrado a SupabaseRepository. OJO con el nombre de tabla: en
 * supabase/schema.sql el directorio de empleados (meseros, cajeros,
 * cocineros) vive en `app_users`, NO en `users` — ese nombre está
 * reservado por Supabase para `auth.users` (el login real). `app_users`
 * es el PERFIL de cada empleado (nombre, avatar, preferencias) — NUNCA
 * credenciales. Desde CRÍTICO #1 del checklist de lanzamiento,
 * cajero/mesero/cocina son usuarios reales de Supabase Auth, igual que el
 * dueño (ver create-staff-user y authBusinessContext.ts). El login en sí
 * ya no pasa por este repositorio en absoluto — pasa por
 * supabase.auth.signInWithPassword(), server-side, como el de cualquier
 * usuario de Supabase.
 */
export class UserRepository extends SupabaseRepository<User> {
  protected tableName = "app_users" as const;

  /**
   * El equipo es del NEGOCIO completo, no de una sola sucursal. Los
   * administradores se guardan con branch_id = NULL (alcance de negocio),
   * así que si se filtrara por sucursal nunca aparecerían en la lista aunque
   * existan. Por eso se filtra solo por negocio (igual que roles y categorías).
   */
  protected readonly scopeByBranch = false;

  /**
   * Lectura rápida del equipo: una sola petición compartida entre pantallas
   * (Cocina, Ganancias, Pérdidas, Ajustes...), memoria de 15 s, y copia en
   * IndexedDB por negocio para abrir al instante y funcionar sin internet.
   */
  private readonly team = new CachedList<User>({
    label: "app_users",
    fetchRemote: () => this.fetchTeamFromSupabase(),
    persistence: indexedDbPersistence<User>("users")
  });

  constructor() {
    super();
    // Si otro dispositivo cambia el equipo, la memoria local deja de valer.
    vimdyCore.on("user", (payload: { source?: string } | undefined) => {
      if (payload?.source === "remote-sync") this.team.invalidate();
    });
  }

  private fetchTeamFromSupabase(): Promise<User[]> {
    return super.findAll();
  }

  public findAll(): Promise<User[]> {
    return this.team.get();
  }

  /** Siempre pregunta al servidor (para validaciones como "correo repetido"). */
  public findAllFresh(): Promise<User[]> {
    return this.team.getFresh();
  }

  /** Último equipo guardado en este dispositivo, sin tocar la red. null si no hay. */
  public readCached(): Promise<User[] | null> {
    return this.team.readCached();
  }

  public async save(item: User): Promise<void> {
    await super.save(item);
    this.team.invalidate();
  }

  public async update(item: User): Promise<void> {
    await super.update(item);
    this.team.invalidate();
  }

  public async delete(id: string): Promise<void> {
    await super.delete(id);
    this.team.invalidate();
  }

  public async findByEmail(email: string): Promise<User | null> {
    const users = await this.findAllFresh();
    return users.find(user => user.email.toLowerCase() === email.toLowerCase()) ?? null;
  }

  /**
   * Crea un empleado (cajero/mesero/cocina/admin) como usuario REAL de
   * Supabase Auth, a través de la Edge Function create-staff-user. La
   * contraseña viaja una sola vez, por HTTPS, directo al servidor — nunca
   * se hashea en el navegador ni se guarda en `app_users`.
   */
  public async createStaffAccount(data: {
    name: string;
    email: string;
    password: string;
    roleId: string;
  }): Promise<User> {
    const { data: fnData, error: fnError } = await supabase.functions.invoke("create-staff-user", {
      body: data
    });

    if (fnError) {
      let detailedMessage: string | null = null;
      const context = (fnError as { context?: Response }).context;
      if (context && typeof context.json === "function") {
        try {
          const body = await context.json();
          detailedMessage = body?.error ?? null;
        } catch {
          // El body no era JSON válido; nos quedamos con el mensaje genérico.
        }
      }
      throw new Error(detailedMessage ?? fnError.message ?? "No se pudo crear el empleado.");
    }
    if (fnData?.error) {
      throw new Error(fnData.error);
    }

    this.team.invalidate();

    const created = fnData.user as { id: string; name: string; email: string; roleId: string; status: string };
    const now = new Date();

    return {
      id: created.id,
      name: created.name,
      email: created.email,
      roleId: created.roleId,
      status: created.status as User["status"],
      createdAt: now,
      updatedAt: now
    };
  }
}