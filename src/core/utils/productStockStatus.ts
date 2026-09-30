// src/core/utils/productStockStatus.ts
import { Product } from "../entities/Entities";

/**
 * Punto 10 (auditoría final de Inventario): extraído de useInventory.ts a
 * un util puro (sin React ni Supabase) para que sea importable desde
 * tests de Node y desde cualquier motor/UI sin arrastrar dependencias de
 * navegador -- mismo patrón que productVisualType.ts.
 */
export type StockStatus = "normal" | "bajo" | "agotado" | "inactivo";

export function getStockStatus(product: Product): StockStatus {
  // Punto 10 (auditoría final de Inventario): "Agotado" (sin stock) e
  // "Inactivo" (product.active === false, el interruptor manual del
  // editor -- ver BasicInformationSection) son DOS conceptos distintos.
  // Antes esta función ignoraba `active` por completo: un producto
  // apagado a mano (que SalesEngine.validateInventory ya rechaza en Caja
  // con "está inactivo") podía seguir apareciendo como "Normal" aquí si
  // tenía stock -- Inventario y Caja contaban una historia distinta del
  // mismo producto. Se revisa primero porque es la decisión del negocio
  // (independiente del stock real) la que manda sobre si se puede vender.
  if (product.active === false) return "inactivo";

  // BLOQUEANTE (bug reportado en video 2026-07-31): un producto con
  // trackStock === false (Servicio, o Cocina sin receta, ej. Caldo de
  // Costilla) nace y se queda en stock 0 a propósito porque no maneja
  // stock propio. Sin este chequeo aparecía como "agotado" para siempre
  // en el KPI de inventario, en su propio badge de estado y en la lista
  // de "stock bajo" — mismo criterio que InventoryEngine/SalesEngine/
  // AlertEngine.
  if (product.trackStock === false) return "normal";
  if (product.stock <= 0) return "agotado";
  if (product.stock <= product.minStock) return "bajo";
  return "normal";
}