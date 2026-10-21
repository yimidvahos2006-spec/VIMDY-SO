import type { StockStatus, useInventory } from "../../../core/store/useInventory";
import { formatMoney } from "../../../core/utils/formatMoney";
import { companyConfigStore } from "../../../core/store/companyConfigStore";

/** Estado completo de Inventario (lo crea InventoryPage una sola vez y lo comparten los paneles). */
export type InventoryState = ReturnType<typeof useInventory>;

export const UNIT_OPTIONS = ["unidad", "kg", "g", "litro", "ml", "libra", "servicio", "paquete", "caja"];

export const money = (value: number) => {
  const currency = companyConfigStore.get().currency;
  const language = companyConfigStore.get().language;
  return formatMoney(value, currency, language);
};

export const STATUS_LABEL: Record<StockStatus, string> = {
  normal: "Normal",
  bajo: "Stock bajo",
  agotado: "Agotado"
};

export const STATUS_CLASS: Record<StockStatus, string> = {
  normal: "bg-vimdy-success/15 text-vimdy-success border border-vimdy-success/30",
  bajo: "bg-vimdy-warning/15 text-vimdy-warning border border-vimdy-warning/30",
  agotado: "bg-vimdy-danger/15 text-vimdy-danger border border-vimdy-danger/30"
};

// PASO 2.5 — Centro de Pérdidas: categorías reales para una salida de stock
// que NO es una venta. Las etiquetas viven en un solo lugar (lossCategoryLabels,
// importado arriba) para que Inventario, useLossCenter y el Gerente
// Inteligente digan siempre el mismo nombre.

export type SortKey = "name" | "stock" | "price";

/**
 * PASO 1 (rediseño formulario de producto): "Tipo de producto" es el campo
 * que va arriba de todo y decide qué más muestra el formulario.
 * - inventario: se vende y descuenta directo del stock (ej: gaseosa, snack empacado).
 * - cocina: se prepara en cocina al venderlo, sin descontar stock propio (ej: hamburguesa).
 * - cocina_receta: se prepara en cocina Y descuenta ingredientes de una receta/BOM.
 * - servicio: no maneja stock ni preparación (ej: domicilio, propina, cover).
 *
 * La inferencia y la resolución de flags viven en core/types/productType.ts
 * (fuente única de verdad, testeable). Este archivo solo las consume.
 */