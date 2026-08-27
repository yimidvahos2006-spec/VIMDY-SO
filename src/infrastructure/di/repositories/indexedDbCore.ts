/**
 * Núcleo de persistencia con IndexedDB, compartido por todos los
 * repositorios de la app (ver IndexedDbRepository.ts).
 *
 * Antes, cada repositorio extendía InMemoryRepository: un array en RAM
 * que se perdía por completo al refrescar la página. Este módulo abre
 * una única base de datos del navegador con un object store por cada
 * tipo de entidad, así que los datos sobreviven a un refresh, a cerrar
 * la pestaña, o a reiniciar el computador.
 */

const DB_NAME = "vimdy_os_db";
const DB_VERSION = 7;

/**
 * Un object store por repositorio. Si agregas un repositorio nuevo,
 * agrega su nombre aquí (y sube DB_VERSION si la app ya está en uso
 * con datos reales, para que onupgradeneeded se dispare de nuevo).
 *
 * v2: se agregan "categories" y "suppliers" -> Módulo de Productos ahora
 * persiste categorías y proveedores como entidades reales en vez de
 * strings sueltos en cada producto.
 *
 * v3: se agrega "pendingSales" -> cola de ventas cobradas SIN internet
 * (ver core/offline/PendingSale.ts) que esperan aquí, en el navegador,
 * hasta poder sincronizarse de verdad contra Supabase. A propósito es
 * el único store que nunca vivirá en Supabase: existe solo mientras el
 * dato todavía no llegó allá.
 *
 * v4 (PASO 1.7 — Cola offline para escrituras): se agrega
 * "pendingInventoryAdjustments" -> cola de ajustes de inventario
 * (entradas/salidas de stock) hechos SIN internet (ver
 * core/offline/PendingInventoryAdjustment.ts). Mismo patrón exacto que
 * "pendingSales": nunca vive en Supabase, existe solo mientras el ajuste
 * todavía no se sincronizó de verdad.
 *
 * v5 (PASO 1.8 — Cola offline para escrituras): se agrega
 * "pendingTableOperations" -> cola de aperturas/cierres de mesa hechos
 * SIN internet (ver core/offline/PendingTableOperation.ts). Mismo patrón
 * exacto que "pendingSales"/"pendingInventoryAdjustments": nunca vive en
 * Supabase, existe solo mientras la operación todavía no se sincronizó
 * de verdad.
 *
 * v6 (PASO 1.9 — Cola offline para escrituras): se agrega
 * "pendingCustomerOperations" -> cola de clientes nuevos creados SIN
 * internet (ver core/offline/PendingCustomerOperation.ts). Mismo patrón
 * exacto que las anteriores: nunca vive en Supabase, existe solo mientras
 * el cliente todavía no se sincronizó de verdad.
 */
export const STORE_NAMES = [
  "products",
  "sales",
  "customers",
  "kitchenOrders",
  "alerts",
  "inventoryMovements",
  "cashMovements",
  "tables",
  "orders",
  "shifts",
  "users",
  "roles",
  "permissions",
  "sessions",
  "auditLogs",
  "categories",
  "suppliers",
  "pendingSales",
  "pendingInventoryAdjustments",
  "pendingTableOperations",
  "pendingCustomerOperations",
  "pendingKitchenOrders"
] as const;

let dbPromise: Promise<IDBDatabase> | null = null;

export function openDatabase(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;

  if (typeof indexedDB === "undefined") {
    dbPromise = Promise.reject(new Error("IndexedDB is not available in this environment."));
    return dbPromise;
  }

  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;

      for (const name of STORE_NAMES) {
        if (!db.objectStoreNames.contains(name)) {
          db.createObjectStore(name, { keyPath: "id" });
        }
      }
    };

    request.onsuccess = () => resolve(request.result);

    request.onerror = () => {
      dbPromise = null;
      reject(request.error ?? new Error("No se pudo abrir la base de datos local."));
    };
  });

  return dbPromise;
}