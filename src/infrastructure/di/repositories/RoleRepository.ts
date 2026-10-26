import { Role } from "../../../core/entities/Entities";
import { SupabaseRepository } from "./SupabaseRepository";
import { CachedList, indexedDbPersistence } from "../../cache/CachedList";
import { vimdyCore } from "../../../core/VimdyCore";

/**
 * RoleRepository
 * ---------------------------------------------------------------------------
 * Migrado de IndexedDbRepository a SupabaseRepository (Fase 1 — Blindar
 * VIMDY): los datos de "roles" ya no viven solo en el navegador, viven
 * en la tabla `roles` de Supabase (ver supabase/schema.sql), aislados
 * por negocio mediante Row Level Security y disponibles en cualquier
 * dispositivo donde el mismo negocio inicie sesión.
 */
export class RoleRepository extends SupabaseRepository<Role> {
  protected tableName = "roles" as const;

  /** Los roles pertenecen al negocio completo, no a una sucursal concreta. */
  protected readonly scopeByBranch = false;

  /**
   * Lectura rápida: petición compartida + memoria de 15 s + copia en
   * IndexedDB por negocio (los ids "ADMIN", "CAJERO"... se repiten entre
   * negocios, por eso el caché usa llave compuesta con el negocio).
   */
  private readonly list = new CachedList<Role>({
    label: "roles",
    fetchRemote: () => this.fetchRolesFromSupabase(),
    persistence: indexedDbPersistence<Role>("roles")
  });

  constructor() {
    super();
    // Si otro dispositivo cambia los roles, la memoria local deja de valer.
    vimdyCore.on("access", (payload: { source?: string } | undefined) => {
      if (payload?.source === "remote-sync") this.list.invalidate();
    });
  }

  private fetchRolesFromSupabase(): Promise<Role[]> {
    return super.findAll();
  }

  public findAll(): Promise<Role[]> {
    return this.list.get();
  }

  public findAllFresh(): Promise<Role[]> {
    return this.list.getFresh();
  }

  /** Últimos roles guardados en este dispositivo, sin tocar la red. null si no hay. */
  public readCached(): Promise<Role[] | null> {
    return this.list.readCached();
  }

  public async save(item: Role): Promise<void> {
    await super.save(item);
    this.list.invalidate();
  }

  public async update(item: Role): Promise<void> {
    await super.update(item);
    this.list.invalidate();
  }

  public async delete(id: string): Promise<void> {
    await super.delete(id);
    this.list.invalidate();
  }
}