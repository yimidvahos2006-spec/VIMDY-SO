// src/core/utils/tableMerge.ts
/* ===========================================================================
   Unir mesas — reglas puras (sin base de datos)
   ---------------------------------------------------------------------------
   Todo lo que decide "qué se puede unir" y "cómo se combinan las líneas"
   vive aquí, sin efectos secundarios, para poder probarlo a fondo.
   TableEngine.mergeTables() solo orquesta: lee, aplica estas reglas y guarda.

   Principios:
   - Las líneas se mueven COMPLETAS (tamaño, extras, nota, descuento, IVA,
     unidad, cantidad física, costo congelado). Antes se reconstruían solo con
     producto + cantidad + precio y se perdía el resto en silencio.
   - Dos líneas se suman solo si son realmente la misma (mismo producto,
     tamaño, extras, nota, precio, descuento, IVA y unidad).
   - restar una unión (rollback) es la operación inversa exacta de sumarla.
=========================================================================== */

import type { SaleItem, Table, TableStatus } from "../entities/Entities";

/**
 * Estados en los que una mesa tiene una cuenta abierta y se puede unir.
 * Quedan fuera: FREE (no hay cuenta), RESERVED (aún no se sentaron),
 * CLOSED (ya cobrada) y PAYING (hay un cobro en curso: unir cambiaría el
 * total en pleno pago).
 */
export const MERGEABLE_TABLE_STATUSES: readonly TableStatus[] = [
  "BUSY",
  "WAITING_FOOD",
  "EATING",
  "CUENTA_SOLICITADA",
  "WAITING_BILL"
];

export function isMergeableTableStatus(status: TableStatus): boolean {
  return MERGEABLE_TABLE_STATUSES.includes(status);
}

/** Identidad de una línea: dos líneas con la misma clave son la misma. */
export function saleItemKey(item: SaleItem): string {
  return JSON.stringify([
    item.productId,
    item.selectedSizeId ?? null,
    [...(item.selectedExtraIds ?? [])].sort(),
    (item.note ?? "").trim(),
    item.price,
    item.discount ? [item.discount.type, item.discount.value] : null,
    item.taxRate ?? null,
    item.unit ?? null
  ]);
}

function sumRaw(a?: number, b?: number): number | undefined {
  if (a === undefined && b === undefined) return undefined;
  return Number(((a ?? 0) + (b ?? 0)).toFixed(6));
}

/** Suma `incoming` sobre `base` sin perder ningún dato de ninguna línea. */
export function mergeSaleItems(
  base: readonly SaleItem[],
  incoming: readonly SaleItem[]
): SaleItem[] {
  const result: SaleItem[] = base.map((item) => ({ ...item }));

  for (const line of incoming) {
    const key = saleItemKey(line);
    const index = result.findIndex((existing) => saleItemKey(existing) === key);

    if (index < 0) {
      result.push({ ...line });
      continue;
    }

    const current = result[index];
    const quantityRaw = sumRaw(current.quantityRaw, line.quantityRaw);
    result[index] = {
      ...current,
      quantity: Number((current.quantity + line.quantity).toFixed(6)),
      ...(quantityRaw !== undefined ? { quantityRaw } : {})
    };
  }

  return result;
}

/** Operación inversa de mergeSaleItems: quita `removed` de `base`. */
export function subtractSaleItems(
  base: readonly SaleItem[],
  removed: readonly SaleItem[]
): SaleItem[] {
  const result: SaleItem[] = base.map((item) => ({ ...item }));

  for (const line of removed) {
    const key = saleItemKey(line);
    const index = result.findIndex((existing) => saleItemKey(existing) === key);
    if (index < 0) continue;

    const current = result[index];
    const quantity = Number((current.quantity - line.quantity).toFixed(6));

    if (quantity <= 0) {
      result.splice(index, 1);
      continue;
    }

    const quantityRaw =
      current.quantityRaw !== undefined
        ? Number(Math.max((current.quantityRaw ?? 0) - (line.quantityRaw ?? 0), 0).toFixed(6))
        : undefined;

    result[index] = {
      ...current,
      quantity,
      ...(quantityRaw !== undefined ? { quantityRaw } : {})
    };
  }

  return result;
}

export interface MergeAssessment {
  readonly ok: boolean;
  /** Código de negocio (el mismo que lanza TableEngine) cuando no se puede. */
  readonly code?:
    | "TABLE_MERGE_SAME_TABLE"
    | "CONTEXT_MISMATCH"
    | "TABLE_NOT_OPEN"
    | "TABLE_MERGE_TARGET_NOT_OPEN"
    | "EMPTY_TABLE";
}

/** Decide si `source` se puede unir a `target`. */
export function assessMerge(source: Table, target: Table): MergeAssessment {
  if (source.id === target.id) return { ok: false, code: "TABLE_MERGE_SAME_TABLE" };

  if (
    (source.businessId && target.businessId && source.businessId !== target.businessId) ||
    (source.branchId && target.branchId && source.branchId !== target.branchId)
  ) {
    return { ok: false, code: "CONTEXT_MISMATCH" };
  }

  if (!isMergeableTableStatus(source.status)) return { ok: false, code: "TABLE_NOT_OPEN" };
  if (!isMergeableTableStatus(target.status)) {
    return { ok: false, code: "TABLE_MERGE_TARGET_NOT_OPEN" };
  }
  if (source.items.length === 0) return { ok: false, code: "EMPTY_TABLE" };

  return { ok: true };
}