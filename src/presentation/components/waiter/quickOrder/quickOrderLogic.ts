// src/presentation/components/waiter/quickOrder/quickOrderLogic.ts
/* ===========================================================================
   Toma de pedido ágil desde la mesa — lógica pura (sin React, sin Supabase)
   ---------------------------------------------------------------------------
   Todo lo que decide PRECIO y NOTA de una línea vive aquí, para poder
   probarlo sin pantalla:

   1. Precio de una línea = precio base + tamaño + extras (nunca negativo).
   2. Nota de cocina = [tamaño y extras] · [notas rápidas] · [texto libre].
      Es el mismo patrón que ya usa la Caja (PosVariantSelectorModal): lo que
      el cliente eligió viaja en la nota para que cocina lo lea en su tarjeta.
   3. Para editar una nota ya guardada se separa de nuevo en esas tres partes.
=========================================================================== */

import type {
  Product,
  ProductExtraOption,
  ProductSizeOption,
  SaleItem
} from "../../../../core/entities/Entities";

/** Separador entre las partes de una nota (se ve igual en cocina y en el recibo). */
export const NOTE_SEPARATOR = " · ";

/**
 * Notas rápidas de un toque. Van en MAYÚSCULAS porque así se leen mejor a
 * distancia en la pantalla de cocina; la tarjeta de cocina ya resalta en rojo
 * cualquier nota que empiece por "sin" o "no".
 */
export const QUICK_NOTE_PRESETS: readonly string[] = [
  "SIN CEBOLLA",
  "SIN TOMATE",
  "SIN PICANTE",
  "SIN SAL",
  "SIN HIELO",
  "SIN AZÚCAR",
  "BIEN COCIDO",
  "PARA LLEVAR"
];

/** Un producto pide hoja de opciones solo si tiene tamaños o extras. */
export function needsOptions(product: Pick<Product, "sizes" | "extras">): boolean {
  return (product.sizes?.length ?? 0) > 0 || (product.extras?.length ?? 0) > 0;
}

/** Precio final de UNA unidad con la variante elegida. Nunca baja de cero. */
export function computeUnitPrice(
  basePrice: number,
  size: Pick<ProductSizeOption, "priceDelta"> | null | undefined,
  extras: readonly Pick<ProductExtraOption, "priceDelta">[] = []
): number {
  const total =
    basePrice +
    (size?.priceDelta ?? 0) +
    extras.reduce((sum, extra) => sum + (extra.priceDelta ?? 0), 0);
  return Math.max(0, Math.round(total * 100) / 100);
}

/** "Grande + Queso, Tocineta" (igual que la Caja). Vacío si no hay variante. */
export function buildVariantLabel(
  size: Pick<ProductSizeOption, "name"> | null | undefined,
  extras: readonly Pick<ProductExtraOption, "name">[] = []
): string {
  const parts: string[] = [];
  if (size?.name) parts.push(size.name);
  if (extras.length > 0) parts.push(`+ ${extras.map((extra) => extra.name).join(", ")}`);
  return parts.join(" ");
}

function cleanPiece(text: string | null | undefined): string {
  return (text ?? "").replace(/\s+/g, " ").trim();
}

/**
 * Arma la nota que se guarda en la línea. Sin nada que decir devuelve
 * `undefined` (la línea queda sin nota, igual que hoy).
 */
export function buildLineNote(parts: {
  variantLabel?: string;
  quickNotes?: readonly string[];
  freeText?: string;
}): string | undefined {
  const seen = new Set<string>();
  const pieces: string[] = [];

  const push = (raw: string | null | undefined) => {
    const piece = cleanPiece(raw);
    if (!piece) return;
    const key = piece.toLocaleUpperCase("es-CO");
    if (seen.has(key)) return;
    seen.add(key);
    pieces.push(piece);
  };

  push(parts.variantLabel);
  (parts.quickNotes ?? []).forEach(push);
  push(parts.freeText);

  return pieces.length > 0 ? pieces.join(NOTE_SEPARATOR) : undefined;
}

function sameText(a: string, b: string): boolean {
  return a.toLocaleUpperCase("es-CO") === b.toLocaleUpperCase("es-CO");
}

/**
 * Operación inversa de buildLineNote: de una nota guardada saca qué notas
 * rápidas tenía y qué texto libre. El tamaño/extras (`variantLabel`) se quita
 * porque lo decide la línea, no se edita como nota.
 */
export function parseLineNote(
  note: string | null | undefined,
  variantLabel = ""
): { quickNotes: string[]; freeText: string } {
  const pieces = (note ?? "")
    .split(NOTE_SEPARATOR.trim())
    .map(cleanPiece)
    .filter(Boolean);

  const label = cleanPiece(variantLabel);
  const quickNotes: string[] = [];
  const free: string[] = [];

  pieces.forEach((piece, index) => {
    if (label && index === 0 && sameText(piece, label)) return;
    const preset = QUICK_NOTE_PRESETS.find((candidate) => sameText(candidate, piece));
    if (preset) {
      if (!quickNotes.includes(preset)) quickNotes.push(preset);
    } else {
      free.push(piece);
    }
  });

  return { quickNotes, freeText: free.join(NOTE_SEPARATOR) };
}

/** Tamaño y extras de una línea ya guardada (la línea solo guarda sus ids). */
export function resolveLineVariant(
  product: Pick<Product, "sizes" | "extras"> | undefined,
  item: Pick<SaleItem, "selectedSizeId" | "selectedExtraIds">
): { size: ProductSizeOption | null; extras: ProductExtraOption[]; label: string } {
  const size = item.selectedSizeId
    ? product?.sizes?.find((candidate) => candidate.id === item.selectedSizeId) ?? null
    : null;
  const extraIds = new Set(item.selectedExtraIds ?? []);
  const extras = (product?.extras ?? []).filter((candidate) => extraIds.has(candidate.id));
  return { size, extras, label: buildVariantLabel(size, extras) };
}

/** Referencia completa de una línea (producto + nota + tamaño + extras) para el motor de mesas. */
export function lineRefFromItem(item: SaleItem): {
  note: string | undefined;
  selectedSizeId: string | null;
  selectedExtraIds: readonly string[];
} {
  return {
    note: item.note,
    selectedSizeId: item.selectedSizeId ?? null,
    selectedExtraIds: item.selectedExtraIds ?? []
  };
}

/** Clave estable para pintar la lista (producto + variante + nota). */
export function lineDisplayKey(item: SaleItem): string {
  return JSON.stringify([
    item.productId,
    item.selectedSizeId ?? null,
    [...new Set(item.selectedExtraIds ?? [])].sort(),
    cleanPiece(item.note)
  ]);
}