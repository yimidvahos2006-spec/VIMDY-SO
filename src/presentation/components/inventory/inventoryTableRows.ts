import type { Product } from "../../../core/entities/Entities";
import type { Profitability } from "../../../core/engines/RecipeEngine";
import { getStockStatus, type StockStatus } from "../../../core/store/useInventory";
import { inferProductType } from "../../../core/types/productType";
import { isStockMasked, maskedStockStatus, type MaskedStockStatus } from "../../../core/utils/stockMask";
import { getProductProfitView } from "./productProfit";

/**
 * Datos ya "masticados" para la Tabla Principal de Inventario.
 * La tabla (InventoryMainTable) solo pinta; toda la lógica de negocio
 * (stock bajo, conteo a ciegas, costo faltante) vive aquí, en una función
 * pura y fácil de probar.
 */

/** Qué se muestra en la columna Stock. */
export type StockCell =
  /** Producto con cantidad real: "48", "0 kg". */
  | { kind: "quantity"; quantity: number; unit?: string; status: StockStatus }
  /** Sin cantidad, solo estado: conteo a ciegas o producto de cocina sin stock propio. */
  | { kind: "status"; status: StockStatus }
  /** No maneja stock (servicios como domicilio): se muestra "—". */
  | { kind: "none" };

/** Qué se muestra en la columna Costo. */
export type CostCell =
  | { kind: "none" }
  | { kind: "missing" }
  | { kind: "value"; amount: number };

export interface InventoryTableRow {
  readonly id: string;
  readonly name: string;
  readonly categoryName: string;
  readonly stock: StockCell;
  readonly cost: CostCell;
  readonly price: number;
  /** `➕ Sumar` se deshabilita si el producto no maneja stock o está en conteo a ciegas. */
  readonly canAddStock: boolean;
  /** `✏️ Editar` se deshabilita en conteo a ciegas (solo lectura). */
  readonly canEdit: boolean;
}

export interface BuildRowOptions {
  readonly categoryNameById: Readonly<Record<string, string>>;
  /** Permiso `inventory.viewCosts`. Sin él, la columna Costo muestra "—". */
  readonly canViewCosts: boolean;
  /** Se invoca solo si hace falta (p. ej. `(p) => engine.getProfitability(p, productMap)`). */
  readonly getProfitability: (product: Product) => Profitability;
}

const MASKED_TO_STATUS: Record<MaskedStockStatus, StockStatus> = {
  AVAILABLE: "normal",
  LOW: "bajo",
  OUT: "agotado"
};

function buildStockCell(product: Product, masked: boolean): StockCell {
  // Conteo a ciegas: jamás una cifra, solo el estado que calculó el servidor.
  if (masked) return { kind: "status", status: MASKED_TO_STATUS[maskedStockStatus(product)] };

  if (product.trackStock === false) {
    // Servicio (domicilio, propina): no hay nada que contar. Cocina sin stock propio: "Disponible".
    return inferProductType(product) === "servicio" ? { kind: "none" } : { kind: "status", status: "normal" };
  }

  return { kind: "quantity", quantity: product.stock, unit: product.unit, status: getStockStatus(product) };
}

function buildCostCell(product: Product, masked: boolean, options: BuildRowOptions): CostCell {
  if (masked || !options.canViewCosts) return { kind: "none" };

  const view = getProductProfitView(product, () => options.getProfitability(product));
  if (view.kind === "missing-cost") return { kind: "missing" };
  if (view.kind === "ok") return { kind: "value", amount: view.cost };

  // "none": servicios o productos sin precio (p. ej. insumos). Si tienen costo de compra, se muestra.
  if (inferProductType(product) !== "servicio") {
    const purchaseCost = product.averageCost && product.averageCost > 0 ? product.averageCost : product.purchasePrice;
    if (purchaseCost && purchaseCost > 0) return { kind: "value", amount: purchaseCost };
  }
  return { kind: "none" };
}

export function toInventoryTableRow(product: Product, options: BuildRowOptions): InventoryTableRow {
  const masked = isStockMasked(product);
  return {
    id: product.id,
    name: product.name,
    categoryName: options.categoryNameById[product.categoryId] ?? "Sin categoría",
    stock: buildStockCell(product, masked),
    cost: buildCostCell(product, masked, options),
    price: product.price,
    canAddStock: !masked && product.trackStock !== false,
    canEdit: !masked
  };
}