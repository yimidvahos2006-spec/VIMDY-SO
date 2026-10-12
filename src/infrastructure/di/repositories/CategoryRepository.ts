import { Category } from "../../../core/entities/Entities";
import { SupabaseRepository } from "./SupabaseRepository";
import { CategoryLocalRepository } from "./CategoryLocalRepository";
import { connectionStore } from "../../../core/store/connectionStore";
import { logWarning } from "../../logging/opsLogger";

/**
 * CategoryRepository
 * ---------------------------------------------------------------------------
 * Las categorías viven en la tabla `categories` de Supabase, aisladas por
 * negocio mediante Row Level Security, y se guardan en IndexedDB solo como
 * respaldo para trabajar sin internet.
 *
 * Las categorías son del NEGOCIO completo (todas las sucursales ven las
 * mismas): por eso `scopeByBranch = false` — se filtran solo por negocio y
 * se guardan con branch_id = null. Antes se filtraban también por sucursal,
 * y las categorías creadas durante el onboarding (cuando aún no había
 * sucursal activa) quedaban con branch_id = null y la app dejaba de verlas.
 *
 * Lectura: con internet, `findAll()` espera la respuesta de Supabase (dato
 * fresco, son pocas filas) y actualiza el caché. Sin internet, o si Supabase
 * falla, responde con el caché local. Así una categoría borrada, renombrada
 * o creada en otro dispositivo se ve de inmediato y la revisión de nombre
 * repetido de CategoryEngine ya no usa datos viejos.
 */
export class CategoryRepository extends SupabaseRepository<Category> {
  protected tableName = "categories" as const;
  protected readonly scopeByBranch = false;

  /** Caché local en IndexedDB — ver CategoryLocalRepository. */
  private readonly local = new CategoryLocalRepository();

  public async save(category: Category): Promise<void> {
    await super.save(category);
    try {
      await this.local.save(category);
    } catch (error) {
      logWarning("[CategoryRepository] No se pudo guardar la categoría en caché local", {
        category: "offline",
        context: { error: String(error) }
      });
    }
  }

  public async update(category: Category): Promise<void> {
    await super.update(category);
    try {
      await this.local.save(category);
    } catch (error) {
      logWarning("[CategoryRepository] No se pudo actualizar la categoría en caché local", {
        category: "offline",
        context: { error: String(error) }
      });
    }
  }

  public async delete(id: string): Promise<void> {
    await super.delete(id);
    try {
      await this.local.delete(id);
    } catch (error) {
      logWarning("[CategoryRepository] No se pudo borrar la categoría del caché local", {
        category: "offline",
        context: { error: String(error) }
      });
    }
  }

  public async findAll(): Promise<Category[]> {
    if (connectionStore.isOnline()) {
      try {
        const fresh = await super.findAll();
        try {
          await this.local.replaceAll(fresh);
        } catch (error) {
          logWarning("[CategoryRepository] No se pudo guardar el caché local de categorías", {
            category: "offline",
            context: { error: String(error) }
          });
        }
        return fresh;
      } catch (error) {
        logWarning("[CategoryRepository] No se pudo leer las categorías de Supabase, se usa caché local", {
          category: "offline",
          context: { error: String(error) }
        });
      }
    }

    return this.local.findAll();
  }

  /**
   * Con internet espera el dato fresco; cae al caché local solo si está
   * offline o si Supabase falla (ver el mismo patrón en ProductRepository).
   */
  public async findById(id: string): Promise<Category | null> {
    if (connectionStore.isOnline()) {
      try {
        const fresh = await super.findById(id);

        if (fresh) {
          void this.local.save(fresh).catch((error) => {
            logWarning("[CategoryRepository] No se pudo guardar la categoría en caché local", { category: "offline", context: { error: String(error) } });
          });
        }

        return fresh;
      } catch (error) {
        logWarning("[CategoryRepository] Falló findById contra Supabase, se usa caché local", { category: "offline", context: { error: String(error) } });
        return this.local.findById(id);
      }
    }

    return this.local.findById(id);
  }
}