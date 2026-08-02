import { Category } from "../../../core/entities/Entities";
import { SupabaseRepository } from "./SupabaseRepository";
import { CategoryLocalRepository } from "./CategoryLocalRepository";
import { connectionStore } from "../../../core/store/connectionStore";

/**
 * CategoryRepository
 * ---------------------------------------------------------------------------
 * Migrado de IndexedDbRepository a SupabaseRepository (Fase 1 — Blindar
 * VIMDY): los datos de "categories" ya no viven solo en el navegador, viven
 * en la tabla `categories` de Supabase (ver supabase/schema.sql), aislados
 * por negocio mediante Row Level Security y disponibles en cualquier
 * dispositivo donde el mismo negocio inicie sesión.
 *
 * PASO 1.3 (Catálogo sin internet) — mismo patrón que ProductRepository
 * (Pasos 1.1+1.2), aplicado aquí a Categorías: `findAll()` lee primero del
 * caché local en IndexedDB y responde de inmediato; en paralelo, si hay
 * señal, refresca contra Supabase y guarda ese resultado fresco en
 * IndexedDB para que el próximo `findAll()` ya lo tenga.
 */
export class CategoryRepository extends SupabaseRepository<Category> {
  protected tableName = "categories" as const;

  /** Caché local en IndexedDB — ver CategoryLocalRepository. */
  private readonly local = new CategoryLocalRepository();

  public async findAll(): Promise<Category[]> {
    const cached = await this.local.findAll();

    if (connectionStore.isOnline()) {
      // Fire-and-forget a propósito: no bloquea la respuesta local, y un
      // error de red acá no debe tumbar la pantalla de Categorías (que ya
      // tiene el catálogo local para mostrar).
      void super
        .findAll()
        .then((fresh) => this.local.replaceAll(fresh))
        .catch((error) => {
          console.warn(
            "[CategoryRepository] No se pudo refrescar las categorías desde Supabase:",
            error
          );
        });
    }

    return cached;
  }

  /**
   * Ver el mismo hueco documentado en ProductRepository.findById(): sin
   * este override, `CategoryEngine.getById` (ej. abrir el detalle de una
   * categoría) se quedaba esperando red indefinidamente sin internet.
   * Espera la red cuando hay señal (dato fresco), cae a caché local solo
   * si está offline o si Supabase falla.
   */
  public async findById(id: string): Promise<Category | null> {
    if (connectionStore.isOnline()) {
      try {
        const fresh = await super.findById(id);

        if (fresh) {
          void this.local.save(fresh).catch((error) => {
            console.warn(
              "[CategoryRepository] No se pudo guardar la categoría en caché local:",
              error
            );
          });
        }

        return fresh;
      } catch (error) {
        console.warn(
          "[CategoryRepository] Falló findById contra Supabase, se usa caché local:",
          error
        );
        return this.local.findById(id);
      }
    }

    return this.local.findById(id);
  }
}