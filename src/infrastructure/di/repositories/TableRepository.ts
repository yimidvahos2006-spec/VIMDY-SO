import { Table } from "../../../core/entities/Entities";
import { SupabaseRepository } from "./SupabaseRepository";
import { TableLocalRepository } from "./TableLocalRepository";
import { connectionStore } from "../../../core/store/connectionStore";
import { logWarning } from "../../logging/opsLogger";
import { vimdyCore } from "../../../core/VimdyCore";

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

  /**
   * Cuenta las escrituras propias a la caché local. Si una escritura ocurre
   * mientras un refresco de Supabase está en vuelo, ese refresco trae datos
   * anteriores a la escritura: se descarta para no borrar la mesa recién creada.
   */
  private writeSeq = 0;

  /** Huella de un listado de mesas (id + versión + última modificación). */
  private static signature(tables: Table[]): string {
    return tables
      .map((t) => `${t.id}:${t.version ?? 1}:${t.updatedAt ? new Date(t.updatedAt).getTime() : 0}`)
      .sort()
      .join("|");
  }

  private async mirrorToLocal(action: () => Promise<void>, what: string): Promise<void> {
    this.writeSeq += 1;
    await action().catch((error: unknown) => {
      logWarning(`[TableRepository] No se pudo reflejar ${what} en la caché local`, {
        category: "offline",
        context: { error: String(error) },
      });
    });
  }

  public async findAll(): Promise<Table[]> {
    const cached = await this.local.findAll();

    if (connectionStore.isOnline()) {
      // Fire-and-forget a propósito: no bloquea la respuesta local, y un
      // error de red acá no debe tumbar la pantalla de Mesas (que ya
      // tiene el catálogo local para mostrar).
      const seqAtStart = this.writeSeq;
      const cachedSignature = TableRepository.signature(cached);

      void super
        .findAll()
        .then(async (fresh) => {
          // Hubo una escritura propia durante el refresco: este resultado ya es viejo.
          if (this.writeSeq !== seqAtStart) return;

          await this.local.replaceAll(fresh);

          // Si la nube tenía algo distinto (p. ej. otro dispositivo creó o cambió una mesa),
          // la pantalla ya pintó la caché vieja: se avisa para que vuelva a leer.
          // Converge: la segunda lectura ya coincide y no emite de nuevo.
          if (TableRepository.signature(fresh) !== cachedSignature) {
            vimdyCore.emit("table", { action: "table.synced", source: "cache-refresh" });
          }
        })
        .catch((error: unknown) => {
          logWarning("[TableRepository] No se pudo refrescar las mesas desde Supabase", {
            category: "offline",
            context: { error: String(error) },
          });
        });
    }

    const seen = new Set<string>();
    const unique = cached.filter((table) => {
      if (seen.has(table.id)) {
        return false;
      }
      seen.add(table.id);
      return true;
    });

    if (unique.length !== cached.length) {
      console.warn("[TableRepository] Se detectaron mesas duplicadas en el catálogo local, se deduplicaron antes de devolver.", {
        cached: cached.length,
        unique: unique.length
      });
    }

    return unique;
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

  /**
   * Igual que delete(): guardar solo en Supabase NO basta, porque `findAll()`
   * responde primero con la caché local y la mesa nueva no aparecería hasta
   * recargar. Primero la nube (si falla, la caché queda intacta) y luego local.
   */
  public async save(item: Table): Promise<void> {
    await super.save(item);
    await this.mirrorToLocal(() => this.local.save({ ...item, version: item.version ?? 1 }), "la mesa guardada");
  }

  public async saveMany(items: Table[]): Promise<void> {
    await super.saveMany(items);
    await this.mirrorToLocal(
      () => this.local.saveMany(items.map((item) => ({ ...item, version: item.version ?? 1 }))),
      "las mesas guardadas"
    );
  }

  /** La nube sube la versión en +1 al actualizar; la copia local debe quedar igual. */
  public async update(item: Table): Promise<void> {
    await super.update(item);
    const mirrored = item.version === undefined ? item : { ...item, version: item.version + 1 };
    await this.mirrorToLocal(() => this.local.save(mirrored), "la mesa actualizada");
  }

  /**
   * Borrar en Supabase NO basta: `findAll()` responde primero con la caché
   * local, así que la mesa eliminada reaparecería hasta el siguiente refresco.
   * Se borra primero en la nube (si falla, la caché queda intacta) y luego en local.
   */
  public async delete(id: string): Promise<void> {
    await super.delete(id);
    this.writeSeq += 1;
    await this.local.delete(id).catch((error: unknown) => {
      logWarning("[TableRepository] No se pudo quitar la mesa de la caché local", {
        category: "offline",
        context: { error: String(error) },
      });
    });
  }

  public async deleteMany(ids: string[]): Promise<void> {
    await super.deleteMany(ids);
    this.writeSeq += 1;
    await this.local.deleteMany(ids).catch((error: unknown) => {
      logWarning("[TableRepository] No se pudieron quitar las mesas de la caché local", {
        category: "offline",
        context: { error: String(error) },
      });
    });
  }
}