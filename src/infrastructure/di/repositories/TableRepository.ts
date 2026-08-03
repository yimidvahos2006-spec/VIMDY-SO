import { Table } from "../../../core/entities/Entities";
import { SupabaseRepository } from "./SupabaseRepository";
import { TableLocalRepository } from "./TableLocalRepository";
import { connectionStore } from "../../../core/store/connectionStore";
import { logWarning } from "../../logging/opsLogger";

/**
 * TableRepository
 * ---------------------------------------------------------------------------
 * Migrado de IndexedDbRepository a SupabaseRepository (Fase 1 — Blindar
 * VIMDY): los datos de "tables" ya no viven solo en el navegador, viven
 * en la tabla `tables` de Supabase (ver supabase/schema.sql), aislados
 * por negocio mediante Row Level Security y disponibles en cualquier
 * dispositivo donde el mismo negocio inicie sesión.
 *
 * PASO 1.4 (Catálogo sin internet) — mismo patrón que ProductRepository /
 * CategoryRepository (Pasos 1.1–1.3), aplicado aquí a Mesas: `findAll()`
 * lee primero del caché local en IndexedDB y responde de inmediato; en
 * paralelo, si hay señal, refresca contra Supabase y guarda ese resultado
 * fresco en IndexedDB para que el próximo `findAll()` ya lo tenga.
 */
export class TableRepository extends SupabaseRepository<Table> {
  protected tableName = "tables" as const;

  /** Caché local en IndexedDB — ver TableLocalRepository. */
  private readonly local = new TableLocalRepository();

  public async findAll(): Promise<Table[]> {
    const cached = await this.local.findAll();

    if (connectionStore.isOnline()) {
      // Fire-and-forget a propósito: no bloquea la respuesta local, y un
      // error de red acá no debe tumbar la pantalla de Mesas (que ya
      // tiene el catálogo local para mostrar).
      void super
        .findAll()
        .then((fresh) => this.local.replaceAll(fresh))
        .catch((error: unknown) => {
          logWarning("[TableRepository] No se pudo refrescar las mesas desde Supabase", {
            category: "offline",
            context: { error: String(error) },
          });
        });
    }

    return cached;
  }

  /**
   * Ver el mismo hueco documentado en ProductRepository.findById(): sin
   * este override, `TableEngine` (ej. abrir/cerrar una mesa puntual por
   * id) se quedaba esperando red indefinidamente sin internet. Espera la
   * red cuando hay señal (dato fresco), cae a caché local solo si está
   * offline o si Supabase falla.
   */
  public async findById(id: string): Promise<Table | null> {
    if (connectionStore.isOnline()) {
      try {
        const fresh = await super.findById(id);

        if (fresh) {
          void this.local.save(fresh).catch((error: unknown) => {
            logWarning("[TableRepository] No se pudo guardar la mesa en caché local", {
              category: "offline",
              context: { error: String(error) },
            });
          });
        }

        return fresh;
      } catch (error: unknown) {
        logWarning("[TableRepository] Falló findById contra Supabase, se usa caché local", {
          category: "offline",
          context: { error: String(error) },
        });
        return this.local.findById(id);
      }
    }

    return this.local.findById(id);
  }
}