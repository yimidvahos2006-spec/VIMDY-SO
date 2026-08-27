import { useCallback, useEffect, useState } from "react";

import { container, productsReady } from "../infrastructure/di/CompositionRoot";
import { Product } from "../core/entities/Entities";
import { ProductInput } from "../core/engines/InventoryEngine";
import { productCatalogStore } from "../core/store/productCatalogStore";
import { vimdyCore } from "../core/VimdyCore";
import { translateBusinessError } from "../core/errors/translateBusinessError";

/* ===========================================================================
   useProducts
   ---------------------------------------------------------------------------
   Fuente real de CRUD de productos para la UI (formulario de Productos).
   Lee y escribe siempre a través de container.inventoryService, que a su
   vez usa InventoryEngine + ProductRepository (IndexedDB) — nunca datos de
   ejemplo ni estado local desconectado.

   Después de cualquier cambio (crear/editar/eliminar), refresca también
   productCatalogStore para que la Caja (PosProducts/PosCategories) vea el
   catálogo actualizado sin recargar la página, y emite el evento
   "inventory" del bus global para que Dashboard/otros módulos reaccionen.
=========================================================================== */

export interface UseProductsResult {
  products: Product[];
  loading: boolean;
  error: string | null;
  reload: () => Promise<void>;
  search: (query: string) => Promise<Product[]>;
  createProduct: (input: ProductInput) => Promise<Product | null>;
  updateProduct: (id: string, input: ProductInput) => Promise<Product | null>;
  deleteProduct: (id: string) => Promise<boolean>;
  increaseStock: (id: string, quantity: number, reason: string) => Promise<boolean>;
  decreaseStock: (id: string, quantity: number, reason: string) => Promise<boolean>;
}

/**
 * Traduce los códigos de error que lanza InventoryEngine a mensajes para
 * el usuario. Delega en el traductor central (core/errors/translateBusinessError)
 * para que exista un solo lugar con el diccionario completo.
 */
function friendlyError(err: unknown): string {
  return translateBusinessError(err, "No se pudo completar la operación. Intenta de nuevo.");
}

export function useProducts(): UseProductsResult {
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    await productsReady;
    const all = await container.inventoryService.get().listAll();
    setProducts(all);
  }, []);

  useEffect(() => {
    setLoading(true);
    reload().finally(() => setLoading(false));
  }, [reload]);

  // Sincronización en vivo: cuando OTRO dispositivo (Computador B, Tablet,
  // Celular) crea/edita/borra un producto, categoría o proveedor,
  // realtimeSync.ts detecta el cambio en Supabase y emite "inventory" en
  // este mismo bus. Sin este listener, este hook solo se enteraba de sus
  // PROPIOS cambios (los que hacía syncAfterWrite más abajo).
  useEffect(() => {
    const unsubscribe = vimdyCore.on("inventory", () => {
      reload();
    });
    return unsubscribe;
  }, [reload]);

  const search = useCallback(async (query: string) => {
    await productsReady;
    return await container.inventoryService.get().search(query);
  }, []);

  /** Sincroniza la Caja y notifica al resto de la app que el catálogo cambió. */
  const syncAfterWrite = useCallback(async () => {
    await Promise.all([reload(), productCatalogStore.refresh()]);
    vimdyCore.emit("inventory");
  }, [reload]);

  const createProduct = useCallback(
    async (input: ProductInput): Promise<Product | null> => {
      setError(null);
      try {
        const created = await container.inventoryService.get().createProduct(input);
        await syncAfterWrite();
        return created;
      } catch (e: any) {
        setError(friendlyError(e));
        return null;
      }
    },
    [syncAfterWrite]
  );

  const updateProduct = useCallback(
    async (id: string, input: ProductInput): Promise<Product | null> => {
      setError(null);
      try {
        const updated = await container.inventoryService.get().updateProduct(id, input);
        await syncAfterWrite();
        return updated;
      } catch (e: any) {
        setError(friendlyError(e));
        return null;
      }
    },
    [syncAfterWrite]
  );

  const deleteProduct = useCallback(
    async (id: string): Promise<boolean> => {
      setError(null);
      try {
        await container.inventoryService.get().deleteProduct(id);
        await syncAfterWrite();
        return true;
      } catch (e: any) {
        setError(friendlyError(e));
        return false;
      }
    },
    [syncAfterWrite]
  );

  const increaseStock = useCallback(
    async (id: string, quantity: number, reason: string): Promise<boolean> => {
      setError(null);
      try {
        await container.inventoryService.get().increaseStock(id, quantity, reason);
        await syncAfterWrite();
        return true;
      } catch (e: any) {
        setError(friendlyError(e));
        return false;
      }
    },
    [syncAfterWrite]
  );

  const decreaseStock = useCallback(
    async (id: string, quantity: number, reason: string): Promise<boolean> => {
      setError(null);
      try {
        await container.inventoryService.get().decreaseStock(id, quantity, reason);
        await syncAfterWrite();
        return true;
      } catch (e: any) {
        setError(friendlyError(e));
        return false;
      }
    },
    [syncAfterWrite]
  );

  return {
    products,
    loading,
    error,
    reload,
    search,
    createProduct,
    updateProduct,
    deleteProduct,
    increaseStock,
    decreaseStock
  };
}