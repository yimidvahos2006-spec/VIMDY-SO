import { Customer } from "../../../core/entities/Entities";
import { SupabaseRepository } from "./SupabaseRepository";
import { CustomerLocalRepository } from "./CustomerLocalRepository";
import { connectionStore } from "../../../core/store/connectionStore";
import { logWarning } from "../../logging/opsLogger";
import { getCurrentBusinessId, getCurrentBranchId } from "../../../infrastructure/supabase/supabaseClient";

/**
 * CustomerRepository
 * ---------------------------------------------------------------------------
 * Migrado de IndexedDbRepository a SupabaseRepository (Fase 1 — Blindar
 * VIMDY): los datos de "customers" ya no viven solo en el navegador, viven
 * en la tabla `customers` de Supabase (ver supabase/schema.sql), aislados
 * por negocio mediante Row Level Security y disponibles en cualquier
 * dispositivo donde el mismo negocio inicie sesión.
 *
 * PASO 1.5 (Catálogo sin internet) — mismo patrón que ProductRepository /
 * CategoryRepository / TableRepository (Pasos 1.1–1.4), aplicado aquí a
 * Clientes: `findAll()` lee primero del caché local en IndexedDB y
 * responde de inmediato; en paralelo, si hay señal, refresca contra
 * Supabase y guarda ese resultado fresco en IndexedDB para que el próximo
 * `findAll()` ya lo tenga.
 */
export class CustomerRepository extends SupabaseRepository<Customer> {
  protected tableName = "customers" as const;

  /** Caché local en IndexedDB — ver CustomerLocalRepository. */
  private readonly local = new CustomerLocalRepository();

  public async findAll(): Promise<Customer[]> {
    const cached = await this.local.findAll();

    if (connectionStore.isOnline()) {
      void super
        .findAll()
        .then((fresh) => this.local.replaceAll(fresh))
        .catch((error) => {
          logWarning("[CustomerRepository] No se pudo refrescar los clientes desde Supabase", { category: "offline", context: { error: String(error) } });
        });
    }

    return cached.filter((customer) => {
      if (customer.businessId && customer.businessId !== getCurrentBusinessId()) {
        return false;
      }
      if (customer.branchId && customer.branchId !== getCurrentBranchId()) {
        return false;
      }
      return true;
    });
  }

  /**
   * Ver el mismo hueco documentado en ProductRepository.findById(): sin
   * este override, `CustomerEngine` (ej. abrir el detalle de un cliente
   * puntual) se quedaba esperando red indefinidamente sin internet.
   * Espera la red cuando hay señal (dato fresco), cae a caché local solo
   * si está offline o si Supabase falla.
   */
  public async findById(id: string): Promise<Customer | null> {
    if (connectionStore.isOnline()) {
      try {
        const fresh = await super.findById(id);

        if (fresh) {
          void this.local.save(fresh).catch((error) => {
            logWarning("[CustomerRepository] No se pudo guardar el cliente en caché local", { category: "offline", context: { error: String(error) } });
          });
        }

        return fresh;
      } catch (error) {
        logWarning("[CustomerRepository] Falló findById contra Supabase, se usa caché local", { category: "offline", context: { error: String(error) } });
        return this.local.findById(id);
      }
    }

    return this.local.findById(id);
  }
}