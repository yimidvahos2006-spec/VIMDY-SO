import { Customer } from "../../../core/entities/Entities";
import { SupabaseRepository } from "./SupabaseRepository";
import { CustomerLocalRepository } from "./CustomerLocalRepository";
import { PendingCustomerOperationRepository } from "./PendingCustomerOperationRepository";
import { connectionStore } from "../../../core/store/connectionStore";
import { logWarning } from "../../logging/opsLogger";
import { customerPhoneKey } from "../../../core/offline/customerPhoneConflict";
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
/**
 * Cuánto se espera a Supabase al refrescar el caché. Con mala señal una
 * petición puede quedarse colgada mucho rato; pasado este tiempo se da por
 * perdida (el caché local sigue sirviendo) y el próximo intento arranca limpio.
 */
const REFRESH_TIMEOUT_MS = 8_000;

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("CUSTOMER_REFRESH_TIMEOUT")), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      }
    );
  });
}

export class CustomerRepository extends SupabaseRepository<Customer> {
  protected tableName = "customers" as const;

  /** Caché local en IndexedDB — ver CustomerLocalRepository. */
  private readonly local = new CustomerLocalRepository();

  /** Cola de clientes creados sin internet que todavía no llegaron a Supabase. */
  private readonly pending = new PendingCustomerOperationRepository();

  /** Refresco en curso: si ya hay uno, los demás esperan el mismo en vez de lanzar otro. */
  private refreshInFlight: Promise<Customer[]> | null = null;

  private inCurrentScope(customer: Customer): boolean {
    if (customer.businessId && customer.businessId !== getCurrentBusinessId()) {
      return false;
    }
    if (customer.branchId && customer.branchId !== getCurrentBranchId()) {
      return false;
    }
    return true;
  }

  /** Clientes creados offline que siguen esperando sincronizarse (no los fallidos). */
  private async pendingCustomers(): Promise<Customer[]> {
    try {
      const operations = await this.pending.findAll();
      return operations
        .filter((operation) => operation.status === "PENDING_SYNC" || operation.status === "SYNCING")
        .map((operation) => operation.customer);
    } catch (error) {
      logWarning("[CustomerRepository] No se pudo leer la cola de clientes pendientes", { category: "offline", context: { error: String(error) } });
      return [];
    }
  }

  /**
   * PASO 5 (búsqueda local): lee SOLO de IndexedDB — nunca toca la red, así
   * que responde en milisegundos aunque el internet del local esté caído o
   * muy lento. Incluye los clientes creados sin internet que aún están en
   * cola, para que se puedan buscar y usar en una venta de inmediato.
   */
  public async findAllLocal(): Promise<Customer[]> {
    const [cached, pending] = await Promise.all([this.local.findAll(), this.pendingCustomers()]);

    const byId = new Map<string, Customer>();
    for (const customer of cached) byId.set(customer.id, customer);
    for (const customer of pending) {
      if (!byId.has(customer.id)) byId.set(customer.id, customer);
    }

    return [...byId.values()].filter((customer) => this.inCurrentScope(customer));
  }

  private fetchFromServer(): Promise<Customer[]> {
    return super.findAll();
  }

  /**
   * Trae la lista fresca de Supabase y la guarda en IndexedDB. Conserva los
   * clientes que todavía están en la cola offline: antes, un refresco los
   * borraba del caché (no existen aún en el servidor) y desaparecían de la
   * búsqueda hasta que terminaba la sincronización.
   *
   * Lanza si no hay red o si Supabase tarda más de REFRESH_TIMEOUT_MS; el
   * llamador decide qué hacer (normalmente nada: el caché local sigue vigente).
   */
  public refreshFromServer(): Promise<Customer[]> {
    if (this.refreshInFlight) return this.refreshInFlight;

    const run = (async () => {
      const fresh = await withTimeout(this.fetchFromServer(), REFRESH_TIMEOUT_MS);
      const pending = await this.pendingCustomers();

      const freshIds = new Set(fresh.map((customer) => customer.id));
      const merged = [...fresh, ...pending.filter((customer) => !freshIds.has(customer.id))];

      await this.local.replaceAll(merged);
      return merged.filter((customer) => this.inCurrentScope(customer));
    })();

    this.refreshInFlight = run;
    const clear = () => {
      if (this.refreshInFlight === run) this.refreshInFlight = null;
    };
    run.then(clear, clear);

    return run;
  }

  public async findAll(): Promise<Customer[]> {
    const local = await this.findAllLocal();

    if (connectionStore.isOnline()) {
      void this.refreshFromServer().catch((error) => {
        logWarning("[CustomerRepository] No se pudo refrescar los clientes desde Supabase", { category: "offline", context: { error: String(error) } });
      });
    }

    return local;
  }

  /**
   * PASO 3: busca en el SERVIDOR (nunca solo en caché) al cliente que ya usa
   * este teléfono, con la misma llave de unicidad del índice. Se usa cuando
   * un cliente creado offline choca (23505) al sincronizarse.
   *
   * Primero una consulta exacta por data->>phone (barata); si no aparece, se
   * recorre la lista fresca comparando por customerPhoneKey() para cubrir
   * formatos distintos del mismo número. Si hay varios, se elige el más
   * antiguo (createdAt, luego id) para que el resultado sea determinista.
   * Lanza si no hay red — el llamador lo trata como fallo de red y reintenta.
   *
   * Límite conocido: respeta el alcance negocio+sucursal de findAll(); un
   * cliente con el mismo teléfono en OTRA sucursal no se encuentra aquí.
   */
  public async findByPhone(phone: string, excludeId?: string): Promise<Customer | null> {
    const target = customerPhoneKey(phone);
    if (!target) return null;

    const matches = (list: Customer[]) =>
      list.filter((c) => c.id !== excludeId && customerPhoneKey(c.phone) === target);

    let found = matches(await super.findByDataField("phone", phone));

    if (found.length === 0) {
      const fresh = await super.findAll();
      void this.local.replaceAll(fresh).catch(() => undefined);
      found = matches(fresh);
    }

    if (found.length === 0) return null;

    found.sort((a, b) => {
      const byDate = (a.createdAt?.getTime() ?? 0) - (b.createdAt?.getTime() ?? 0);
      return byDate !== 0 ? byDate : a.id.localeCompare(b.id);
    });

    const existing = found[0];
    void this.local.save(existing).catch(() => undefined);
    return existing;
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