import { User } from "../../../core/entities/Entities";
import { SupabaseRepository } from "./SupabaseRepository";
import { supabase } from "../../supabase/supabaseClient";

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

  public async findByEmail(email: string): Promise<User | null> {
    const users = await this.findAll();
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