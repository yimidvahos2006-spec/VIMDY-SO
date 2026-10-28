// src/presentation/components/inventory/product-form/insumoFactory.ts
//
// Crear insumos "al vuelo" desde el formulario de plato. Sin React.

import type { Category, Product } from "../../../../core/entities/Entities";
import { container } from "../../../../infrastructure/di/CompositionRoot";

/**
 * Devuelve la categoría de INSUMOS a usar; si el negocio no tiene ninguna, crea
 * "Insumos". `created` viene lleno solo cuando se creó una nueva (para guardarla en el estado).
 */
export async function ensureInsumoCategory(
  known: readonly Category[]
): Promise<{ categoryId: string; created?: Category } | null> {
  const existing = known[0];
  if (existing) return { categoryId: existing.id };

  try {
    const created = await container.categoryEngine.get().create({
      name: "Insumos",
      kind: "INSUMO",
      requiresKitchenByDefault: false
    });
    return { categoryId: created.id, created };
  } catch {
    // Pudo haberse creado en otra pestaña/dispositivo: se busca antes de rendirse.
    const all = await container.categoryEngine.get().listAll();
    const found =
      all.find((c) => c.kind === "INSUMO") ?? all.find((c) => c.name.trim().toLowerCase() === "insumos");
    return found ? { categoryId: found.id, created: found } : null;
  }
}

export interface NewInsumoInput {
  name: string;
  categoryId: string;
  /** Unidad en la que se guarda y descuenta (kg, litro, unidad...). */
  unit: string;
  /** Precio de compra de UNA `unit` completa. Opcional. */
  purchasePrice?: number;
}

/**
 * Crea el insumo. `deferAudit` evita llenar "Últimos movimientos" con insumos
 * que quizá se descarten si la persona cierra sin guardar el plato.
 */
export function createInsumo(input: NewInsumoInput, knownProducts: readonly Product[]): Promise<Product> {
  return container.inventoryEngine.get().createProduct(
    {
      name: input.name,
      categoryId: input.categoryId,
      price: 0,
      purchasePrice: input.purchasePrice,
      stock: 0,
      minStock: 0,
      unit: input.unit,
      isIngredient: true,
      active: true
    },
    undefined,
    { knownProducts: [...knownProducts], deferAudit: true }
  );
}