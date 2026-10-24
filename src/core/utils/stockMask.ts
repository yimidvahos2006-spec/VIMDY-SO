// src/core/utils/stockMask.ts
/* ===========================================================================
   Stock enmascarado (conteo a ciegas activo)
   ---------------------------------------------------------------------------
   Mientras una persona tiene un conteo a ciegas abierto, el SERVIDOR le
   entrega los productos sin stock ni costo reales (ver migración
   20261107000000_inventory_masked_stock_during_blind_count.sql). En esa copia:

     · product.stockMasked === true
     · product.stock  = valor de "banda" (0 / stock mínimo / stock mínimo + 1).
                         Sirve solo para que getStockStatus() siga dando el
                         estado correcto. NUNCA es la cantidad real.
     · product.purchasePrice no viene.

   Regla de oro para la pantalla: si el producto está enmascarado, se muestra
   el estado (🟢 / 🟡 / 🔴) y jamás una cifra de stock, costo o valor.
=========================================================================== */

import type { Product } from "../entities/Entities";

export type MaskedStockStatus = "AVAILABLE" | "LOW" | "OUT";

export interface StockMaskBadge {
  status: MaskedStockStatus;
  emoji: "🟢" | "🟡" | "🔴";
  label: "Disponible" | "Stock bajo" | "Agotado";
  /** Texto listo para pintar: "🟢 Disponible". */
  text: string;
}

const BADGES: Record<MaskedStockStatus, Omit<StockMaskBadge, "text">> = {
  AVAILABLE: { status: "AVAILABLE", emoji: "🟢", label: "Disponible" },
  LOW: { status: "LOW", emoji: "🟡", label: "Stock bajo" },
  OUT: { status: "OUT", emoji: "🔴", label: "Agotado" }
};

/** ¿Este producto llegó con el stock enmascarado por el servidor? */
export function isStockMasked(product: Pick<Product, "stockMasked"> | null | undefined): boolean {
  return product?.stockMasked === true;
}

/** ¿Alguno de estos productos está enmascarado? (la persona está en modo conteo). */
export function hasMaskedStock(products: ReadonlyArray<Pick<Product, "stockMasked">>): boolean {
  return products.some((product) => product.stockMasked === true);
}

/** Estado para mostrar. Usa el que calculó el servidor; si falta, lo deriva de la banda. */
export function maskedStockStatus(
  product: Pick<Product, "stockStatus" | "stock" | "minStock">
): MaskedStockStatus {
  if (product.stockStatus === "AVAILABLE" || product.stockStatus === "LOW" || product.stockStatus === "OUT") {
    return product.stockStatus;
  }
  if (product.stock <= 0) return "OUT";
  if (product.stock <= product.minStock) return "LOW";
  return "AVAILABLE";
}

export function stockMaskBadge(
  product: Pick<Product, "stockStatus" | "stock" | "minStock">
): StockMaskBadge {
  const base = BADGES[maskedStockStatus(product)];
  return { ...base, text: `${base.emoji} ${base.label}` };
}

/**
 * ¿Alcanza el stock para vender `quantity`?
 *
 * Con la cifra real: compara contra `product.stock`, como siempre.
 * Enmascarado: `stock` es solo un valor de banda y NO sirve para comparar
 * cantidades (un producto con 500 unidades llegaría como "3" y se rechazaría
 * una venta de 5). Lo único que se sabe es el estado: solo se rechaza si está
 * AGOTADO; en cualquier otro caso decide el servidor, que no bloquea la venta
 * por stock (ver 20261106000000_sale_never_blocked_by_stock.sql).
 */
export function stockCoversQuantity(
  product: Pick<Product, "stockMasked" | "stockStatus" | "stock" | "minStock">,
  quantity: number
): boolean {
  if (isStockMasked(product)) return maskedStockStatus(product) !== "OUT";
  return product.stock >= quantity;
}

/**
 * Texto de stock para pantallas y mensajes: la cifra real si se puede ver, el
 * estado amigable si está enmascarado.
 *   describeStock(p, `${p.stock} kg`)  →  "10.5 kg"   |   "🟢 Disponible"
 */
export function describeStock(
  product: Pick<Product, "stockMasked" | "stockStatus" | "stock" | "minStock">,
  exact: string
): string {
  return isStockMasked(product) ? stockMaskBadge(product).text : exact;
}

/** Estado con emoji para mensajes (IA, Copilot, feeds): nunca lleva cifras. */
export function maskedStatusText(status: MaskedStockStatus): string {
  const badge = BADGES[status];
  return `${badge.emoji} ${badge.label}`;
}