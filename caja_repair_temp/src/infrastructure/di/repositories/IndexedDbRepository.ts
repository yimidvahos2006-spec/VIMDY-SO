import { IRepository } from "./IRepository";
import { openDatabase, STORE_NAMES } from "./indexedDbCore";
import { getCurrentBusinessId, getCurrentBranchId } from "../../supabase/supabaseClient";

function promisify<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Error de almacenamiento local."));
  });
}

/**
 * IndexedDbRepository
 * ---------------------------------------------------------------------------
 * Reemplazo directo de InMemoryRepository con la misma interfaz pública
 * (IRepository<T>), pero respaldado por IndexedDB en vez de un array en
 * memoria. Cada subclase solo define `storeName`; toda la lógica de
 * lectura/escritura vive aquí una sola vez.
 *
 * Cada método abre su propia transacción corta (patrón estándar de
 * IndexedDB) en vez de mantener una transacción larga compartida.
 */
export abstract class IndexedDbRepository<T extends { id: string }> implements IRepository<T> {
  protected abstract readonly storeName: (typeof STORE_NAMES)[number];

  private async getStore(mode: IDBTransactionMode): Promise<IDBObjectStore> {
    const db = await openDatabase();
    return db.transaction(this.storeName, mode).objectStore(this.storeName);
  }

  private matchesScope(item: T): boolean {
    const businessId = getCurrentBusinessId();
    const branchId = getCurrentBranchId();

    const itemBusinessId = (item as unknown as { businessId?: string | null }).businessId;
    const itemBranchId = (item as unknown as { branchId?: string | null }).branchId;

    if (itemBusinessId && itemBusinessId !== businessId) {
      return false;
    }

    if (branchId && itemBranchId && itemBranchId !== branchId) {
      return false;
    }

    return true;
  }

  public async findAll(): Promise<T[]> {
    const store = await this.getStore("readonly");
    const rows = await promisify(store.getAll());
    return rows.filter((item) => this.matchesScope(item as T));
  }

  public async findById(id: string): Promise<T | null> {
    const store = await this.getStore("readonly");
    const result = await promisify(store.get(id));
    const item = result as T | undefined;

    if (!item) {
      return null;
    }

    return this.matchesScope(item) ? item : null;
  }

  public async findMany(ids: string[]): Promise<T[]> {
    const idSet = new Set(ids);
    const all = await this.findAll();
    return all.filter((item) => idSet.has(item.id));
  }

  public async save(item: T): Promise<void> {
    const store = await this.getStore("readwrite");
    await promisify(store.put(item));
  }

  public async saveMany(items: T[]): Promise<void> {
    const store = await this.getStore("readwrite");
    await Promise.all(items.map((item) => promisify(store.put(item))));
  }

  /**
   * Reemplaza el contenido del store para el negocio/sucursal ACTUAL por
   * `items`, en una sola transacción (borra lo viejo del scope + escribe
   * lo nuevo).
   *
   * Se agregó para el Paso 1.2 (Catálogo sin internet): a diferencia de
   * `saveMany` (que solo agrega/actualiza), esto también elimina del
   * caché local cualquier registro que ya no venga en la respuesta fresca
   * de Supabase — por ejemplo un producto borrado en otro dispositivo.
   * Si solo hiciéramos `saveMany`, un producto borrado en la nube
   * quedaría "resucitado" para siempre en el caché offline.
   *
   * BLOQUEANTE (FASE 7 — Multi-tenant): la versión anterior hacía
   * `store.clear()` GLOBAL, borrando los datos de TODOS los negocios y
   * sucursales que compartieran el dispositivo. Ahora solo se borran los
   * registros que pertenecen al scope actual (businessId + branchId),
   * dejando intactos los de otros tenants.
   */
  public async replaceAll(items: T[]): Promise<void> {
    const store = await this.getStore("readwrite");
    const scopedItems = items.filter((item) => this.matchesScope(item));

    // Borrar SOLO los registros del scope actual, no el store completo.
    const allRows = await promisify(store.getAll());
    const rowsToDelete = allRows.filter((row) => this.matchesScope(row as T));
    await Promise.all(rowsToDelete.map((row) => promisify(store.delete((row as T).id))));

    await Promise.all(scopedItems.map((item) => promisify(store.put(item))));
  }

  public async update(item: T): Promise<void> {
    const current = await this.findById(item.id);

    if (!current) {
      throw new Error("ITEM_NOT_FOUND");
    }

    const store = await this.getStore("readwrite");
    await promisify(store.put(item));
  }

  public async delete(id: string): Promise<void> {
    const store = await this.getStore("readwrite");
    await promisify(store.delete(id));
  }

  public async deleteMany(ids: string[]): Promise<void> {
    const store = await this.getStore("readwrite");
    await Promise.all(ids.map((id) => promisify(store.delete(id))));
  }

  public async exists(id: string): Promise<boolean> {
    const item = await this.findById(id);
    return item !== null;
  }

  public async count(): Promise<number> {
    const store = await this.getStore("readonly");
    return promisify(store.count());
  }

  public async clear(): Promise<void> {
    const store = await this.getStore("readwrite");
    const allRows = await promisify(store.getAll());
    const rowsToDelete = allRows.filter((row) => this.matchesScope(row as T));
    await Promise.all(rowsToDelete.map((row) => promisify(store.delete((row as T).id))));
  }
}