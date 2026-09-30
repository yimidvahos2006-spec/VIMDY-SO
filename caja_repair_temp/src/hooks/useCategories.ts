import { useCallback, useEffect, useState } from "react";

import { container, categoriesReady } from "../infrastructure/di/CompositionRoot";
import { Category } from "../core/entities/Entities";
import { vimdyCore } from "../core/VimdyCore";
// NOTA: categorías comparte el evento "inventory" con productos y
// proveedores (ver TABLE_EVENT_MAP en realtimeSync.ts) — así, un cambio de
// categoría hecho en Computador A llega también a Computador B/Tablet/Celular.

/* ===========================================================================
   useCategories
   ---------------------------------------------------------------------------
   CRUD real de categorías para el formulario de Productos (y para cualquier
   pantalla que necesite listar/crear categorías, como Configuración más
   adelante). Lee y escribe siempre contra container.categoryEngine.get()
   (IndexedDB) — reemplaza la idea de "categoría = texto suelto".
=========================================================================== */

export interface UseCategoriesResult {
  categories: Category[];
  loading: boolean;
  error: string | null;
  reload: () => Promise<void>;
  createCategory: (input: {
    name: string;
    description?: string;
    requiresKitchenByDefault?: boolean;
  }) => Promise<Category | null>;
  updateCategory: (
    id: string,
    input: { name?: string; description?: string; active?: boolean; requiresKitchenByDefault?: boolean }
  ) => Promise<Category | null>;
  deleteCategory: (id: string) => Promise<boolean>;
}

function friendlyError(code: string): string {
  switch (code) {
    case "CATEGORY_NAME_REQUIRED":
      return "El nombre de la categoría es obligatorio.";
    case "CATEGORY_NAME_DUPLICATE":
      return "Ya existe una categoría con ese nombre.";
    case "CATEGORY_NOT_FOUND":
      return "La categoría ya no existe.";
    case "CATEGORY_IN_USE":
      return "No puedes eliminar esta categoría: hay productos que la usan.";
    default:
      return "No se pudo completar la operación. Intenta de nuevo.";
  }
}

export function useCategories(): UseCategoriesResult {
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    await categoriesReady;
    const all = await container.categoryEngine.get().listAll();
    setCategories(all);
  }, []);

  useEffect(() => {
    setLoading(true);
    reload().finally(() => setLoading(false));
  }, [reload]);

  useEffect(() => {
    const unsubscribe = vimdyCore.on("inventory", () => {
      reload();
    });
    return unsubscribe;
  }, [reload]);

  const createCategory = useCallback(
    async (input: {
      name: string;
      description?: string;
      requiresKitchenByDefault?: boolean;
    }): Promise<Category | null> => {
      setError(null);
      try {
        const created = await container.categoryEngine.get().create(input);
        await reload();
        vimdyCore.emit("inventory");
        return created;
      } catch (e: any) {
        setError(friendlyError(e?.message ?? ""));
        return null;
      }
    },
    [reload]
  );

  const updateCategory = useCallback(
    async (
      id: string,
      input: {
        name?: string;
        description?: string;
        active?: boolean;
        requiresKitchenByDefault?: boolean;
      }
    ): Promise<Category | null> => {
      setError(null);
      try {
        const updated = await container.categoryEngine.get().update(id, input);
        await reload();
        vimdyCore.emit("inventory");
        return updated;
      } catch (e: any) {
        setError(friendlyError(e?.message ?? ""));
        return null;
      }
    },
    [reload]
  );

  const deleteCategory = useCallback(
    async (id: string): Promise<boolean> => {
      setError(null);
      try {
        await container.categoryEngine.get().delete(id);
        await reload();
        vimdyCore.emit("inventory");
        return true;
      } catch (e: any) {
        setError(friendlyError(e?.message ?? ""));
        return false;
      }
    },
    [reload]
  );

  return {
    categories,
    loading,
    error,
    reload,
    createCategory,
    updateCategory,
    deleteCategory
  };
}