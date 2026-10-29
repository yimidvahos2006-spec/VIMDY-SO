// src/core/utils/insumoGrouping.ts
//
// Agrupa los insumos por categoría para la tabla: grupos en orden alfabético,
// "Sin categoría" siempre al final, e insumos ordenados por nombre dentro de
// cada grupo. Sin React ni red.

import type { Category, Product } from "../entities/Entities";

export const NO_CATEGORY_LABEL = "Sin categoría";

export interface InsumoGroup {
  readonly id: string;
  readonly name: string;
  readonly items: Product[];
}

export function groupInsumosByCategory(
  insumos: readonly Product[],
  categories: ReadonlyArray<Pick<Category, "id" | "name">>
): InsumoGroup[] {
  const nameById = new Map(categories.map((c) => [c.id, c.name]));
  const byCategory = new Map<string, Product[]>();

  for (const insumo of insumos) {
    const list = byCategory.get(insumo.categoryId) ?? [];
    list.push(insumo);
    byCategory.set(insumo.categoryId, list);
  }

  return [...byCategory.entries()]
    .map(([id, items]) => ({
      id,
      name: nameById.get(id) ?? NO_CATEGORY_LABEL,
      items: [...items].sort((a, b) => a.name.localeCompare(b.name, "es"))
    }))
    .sort((a, b) => {
      const aLast = a.name === NO_CATEGORY_LABEL;
      const bLast = b.name === NO_CATEGORY_LABEL;
      if (aLast !== bLast) return aLast ? 1 : -1;
      return a.name.localeCompare(b.name, "es");
    });
}