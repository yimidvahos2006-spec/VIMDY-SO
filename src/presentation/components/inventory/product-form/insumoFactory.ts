// src/presentation/components/inventory/product-form/insumoFactory.ts
//
// Crear insumos "al vuelo" desde el formulario de plato. Sin React.

import type { Category, Product } from "../../../../core/entities/Entities";
import { container } from "../../../../infrastructure/di/CompositionRoot";
import { normalizeInsumoText } from "../../../../core/utils/insumoCategoryGuess";

/**
 * Crea una categoría de INSUMOS. Si otra pestaña/dispositivo ya la creó, devuelve esa.
 * null si no se pudo (p. ej. el nombre ya lo usa una categoría de productos).
 */
export async function createInsumoCategory(name: string): Promise<Category | null> {
  const engine = container.categoryEngine.get();
  try {
    return await engine.create({ name, kind: "INSUMO", requiresKitchenByDefault: false });
  } catch {
    const all = await engine.listAll().catch(() => [] as Category[]);
    return all.find((c) => c.kind === "INSUMO" && normalizeInsumoText(c.name) === normalizeInsumoText(name)) ?? null;
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