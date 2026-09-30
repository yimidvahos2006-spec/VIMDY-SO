import { ProductSizeOption, ProductExtraOption } from "../entities/Entities";

/**
 * variantDisplayName.ts
 * ---------------------------------------------------------------------------
 * PASO 4A (Presentaciones y extras — bug de nombre en recibo/cocina):
 * antes de este archivo, 4 lugares distintos (processSale.ts x2,
 * CloseTableDialog.tsx, kitchenOrderEnrichment.ts) reconstruían el nombre
 * a mostrar buscando product.name en el catálogo, en vez de usar
 * item.selectedSize/item.selectedExtras (que sí viajan completos y
 * congelados con la venta -- ver SelectedSizeOption/SelectedExtraOption en
 * Entities.ts). El resultado: una Pizza vendida como "Grande + Tocineta"
 * llegaba al recibo y a cocina mostrando solo "Pizza".
 *
 * Mismo espíritu que variantPricing.ts / variantSelectionFreeze.ts: un solo
 * lugar decide cómo se ve el nombre con variante, para que los 4 puntos de
 * consumo nunca puedan volver a divergir entre sí.
 *
 *   Pizza                          -> "Pizza"
 *   Pizza + Grande                 -> "Pizza (Grande)"
 *   Pizza + Grande + Tocineta      -> "Pizza (Grande, Tocineta)"
 */

/** Selección mínima necesaria para el nombre: solo hace falta `name`. */
type NamedOption = Pick<ProductSizeOption, "name"> | Pick<ProductExtraOption, "name">;

export function buildVariantDisplayName(
  baseName: string,
  selectedSize: NamedOption | null | undefined,
  selectedExtras: readonly NamedOption[] | null | undefined
): string {
  const parts: string[] = [];

  if (selectedSize?.name) {
    parts.push(selectedSize.name);
  }

  (selectedExtras ?? []).forEach((extra) => {
    if (extra?.name) {
      parts.push(extra.name);
    }
  });

  if (parts.length === 0) {
    return baseName;
  }

  return `${baseName} (${parts.join(", ")})`;
}