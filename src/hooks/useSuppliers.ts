// src/hooks/useSuppliers.ts
import { useCallback, useEffect, useState } from "react";

import { container } from "../infrastructure/di/CompositionRoot";
import { Supplier } from "../core/entities/Entities";
import { vimdyCore } from "../core/VimdyCore";

/* ===========================================================================
   useSuppliers
   ---------------------------------------------------------------------------
   CRUD real de proveedores para el formulario de Productos. Lee y escribe
   siempre contra container.supplierEngine.get() (IndexedDB).
=========================================================================== */

export interface UseSuppliersResult {
  suppliers: Supplier[];
  loading: boolean;
  error: string | null;
  reload: () => Promise<void>;
  createSupplier: (input: {
    name: string;
    contactName?: string;
    phone?: string;
    email?: string;
    address?: string;
    avgDeliveryDays?: number;
  }) => Promise<Supplier | null>;
  updateSupplier: (
    id: string,
    input: {
      name?: string;
      contactName?: string;
      phone?: string;
      email?: string;
      address?: string;
      avgDeliveryDays?: number;
      active?: boolean;
    }
  ) => Promise<Supplier | null>;
  deleteSupplier: (id: string) => Promise<boolean>;
}

function friendlyError(code: string): string {
  switch (code) {
    case "SUPPLIER_NAME_REQUIRED":
      return "El nombre del proveedor es obligatorio.";
    case "SUPPLIER_NOT_FOUND":
      return "El proveedor ya no existe.";
    case "SUPPLIER_IN_USE":
      return "No puedes eliminar este proveedor: hay productos que lo usan.";
    default:
      return "No se pudo completar la operación. Intenta de nuevo.";
  }
}

export function useSuppliers(): UseSuppliersResult {
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    const all = await container.supplierEngine.get().listAll();
    setSuppliers(all);
  }, []);

  useEffect(() => {
    setLoading(true);
    reload().finally(() => setLoading(false));
  }, [reload]);

  useEffect(() => {
    const unsubscribe = vimdyCore.on("inventory", () => reload());
    return unsubscribe;
  }, [reload]);

  const createSupplier = useCallback(
    async (input: {
      name: string;
      contactName?: string;
      phone?: string;
      email?: string;
      address?: string;
      avgDeliveryDays?: number;
    }): Promise<Supplier | null> => {
      setError(null);
      try {
        const created = await container.supplierEngine.get().create(input);
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

  const updateSupplier = useCallback(
    async (
      id: string,
      input: {
        name?: string;
        contactName?: string;
        phone?: string;
        email?: string;
        address?: string;
        avgDeliveryDays?: number;
        active?: boolean;
      }
    ): Promise<Supplier | null> => {
      setError(null);
      try {
        const updated = await container.supplierEngine.get().update(id, input);
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

  const deleteSupplier = useCallback(
    async (id: string): Promise<boolean> => {
      setError(null);
      try {
        await container.supplierEngine.get().delete(id);
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
    suppliers,
    loading,
    error,
    reload,
    createSupplier,
    updateSupplier,
    deleteSupplier
  };
}