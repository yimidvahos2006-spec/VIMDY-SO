import { Product } from "../../../core/entities/Entities";
import { IndexedDbRepository } from "./IndexedDbRepository";

/**
 * ProductLocalRepository
 * ---------------------------------------------------------------------------
 * Copia local (IndexedDB) del catálogo de Productos. Es la pieza que le
 * permite a `ProductRepository.findAll()` (ver Paso 1.1) mostrar algo en
 * pantalla al instante, sin esperar a Supabase.
 *
 * A propósito NO reemplaza a ProductRepository, que sigue siendo la fuente
 * de verdad real (Supabase). Esta clase solo lee/guarda la última copia
 * conocida en el navegador — mismo patrón que ya usa PendingSaleRepository
 * para la cola de ventas offline, aplicado aquí a un catálogo de solo
 * lectura local.
 *
 * Reutiliza el object store "products" que ya existe en indexedDbCore.ts
 * (no hace falta crear uno nuevo ni subir DB_VERSION).
 */
export class ProductLocalRepository extends IndexedDbRepository<Product> {
  protected storeName = "products" as const;
}