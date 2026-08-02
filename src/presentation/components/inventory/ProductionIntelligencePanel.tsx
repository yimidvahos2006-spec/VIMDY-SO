// src/presentation/components/inventory/ProductionIntelligencePanel.tsx
//
// FASE 5 — PASO 2.3: Centro de Producción Inteligente.
// ---------------------------------------------------------------------------
// Componente de SOLO PRESENTACIÓN: no calcula nada, no llama al repositorio,
// no adivina cifras. Todo lo que muestra viene ya calculado por RecipeEngine
// (getRecipeCost / getProfitability / getProductionCapacity), que es la
// única fuente de verdad para costo/ganancia/capacidad en toda la app.
//
// Objetivo: que el dueño del negocio entienda, en una sola pantalla y sin
// calculadora, cuánto cuesta fabricar el producto, cuánto gana, cuántas
// unidades puede preparar hoy y qué ingrediente lo está limitando.

import React from "react";
import {
  Factory,
  DollarSign,
  TrendingUp,
  Percent,
  Boxes,
  AlertTriangle,
  XCircle,
  Package,
  ChefHat,
  ShoppingCart,
  History,
  Clock3
} from "lucide-react";
import { RecipeCost, Profitability, ProductionCapacity, ProductionLevel } from "../../../core/engines/RecipeEngine";

const money = (value: number) => `$${Math.round(value).toLocaleString("es-CO")}`;

/** Estado por fila de ingrediente (independiente del nivel global del producto). */
type IngredientRowLevel = "OK" | "ADVERTENCIA" | "CRITICO";

const ROW_DOT: Record<IngredientRowLevel, string> = {
  OK: "🟢",
  ADVERTENCIA: "🟡",
  CRITICO: "🔴"
};

const LEVEL_META: Record<
  ProductionLevel,
  { dot: string; label: string; badgeClass: string; panelClass: string }
> = {
  OK: {
    dot: "🟢",
    label: "Producción normal",
    badgeClass: "bg-vimdy-success/15 text-vimdy-success border border-vimdy-success/30",
    panelClass: "border-vimdy-success/30"
  },
  ADVERTENCIA: {
    dot: "🟡",
    label: "Producción baja",
    badgeClass: "bg-vimdy-warning/15 text-vimdy-warning border border-vimdy-warning/30",
    panelClass: "border-vimdy-warning/30"
  },
  CRITICO: {
    dot: "🔴",
    label: "Sin producción",
    badgeClass: "bg-vimdy-danger/15 text-vimdy-danger border border-vimdy-danger/30",
    panelClass: "border-vimdy-danger/30"
  }
};

export interface ProductionIntelligencePanelProps {
  /** Nombre del producto elaborado, para la frase de capacidad ("puedes preparar X Hamburguesas"). */
  productName: string;
  cost: RecipeCost;
  profitability: Profitability;
  capacity: ProductionCapacity;
  /** Product.minStock del producto elaborado: define cuándo maxUnits pasa de OK a ADVERTENCIA. */
  minStock: number;
  /** Product.estimatedPrepMinutes, si el negocio lo definió. */
  estimatedPrepMinutes?: number;
  onViewInventory?: () => void;
  onEditRecipe?: () => void;
  onBuyIngredients?: () => void;
  onViewKardex?: () => void;
}

/** Mismo criterio que RecipeEngine.getProductionStatus, para no duplicar la fuente de verdad. */
function resolveLevel(capacity: ProductionCapacity, minStock: number): ProductionLevel {
  if (capacity.maxUnits <= 0) return "CRITICO";
  if (capacity.maxUnits <= minStock) return "ADVERTENCIA";
  return "OK";
}

/** Estado individual de un ingrediente dentro de la tabla de detalle. */
function resolveRowLevel(
  unitsIfOnlyThisIngredient: number,
  isLimiting: boolean,
  maxUnits: number,
  minStock: number
): IngredientRowLevel {
  if (unitsIfOnlyThisIngredient <= 0) return "CRITICO";
  if (isLimiting && maxUnits > 0 && maxUnits <= minStock) return "ADVERTENCIA";
  return "OK";
}

export function ProductionIntelligencePanel({
  productName,
  cost,
  profitability,
  capacity,
  minStock,
  estimatedPrepMinutes,
  onViewInventory,
  onEditRecipe,
  onBuyIngredients,
  onViewKardex
}: ProductionIntelligencePanelProps) {
  const level = resolveLevel(capacity, minStock);
  const levelMeta = LEVEL_META[level];

  // Junta costo (perIngredient) + capacidad (breakdown) por productId: son
  // las dos vistas de la MISMA receta, calculadas por separado en el motor.
  const capacityByIngredient = new Map(capacity.breakdown.map((row) => [row.productId, row]));

  const rows = cost.perIngredient.map((ing) => {
    const capRow = capacityByIngredient.get(ing.productId);
    const isLimiting = capacity.limitingIngredient?.productId === ing.productId;
    const rowLevel = capRow
      ? resolveRowLevel(capRow.unitsIfOnlyThisIngredient, isLimiting, capacity.maxUnits, minStock)
      : "OK";
    const missingCost = cost.missingCostIngredients.includes(ing.name);

    return { ...ing, isLimiting, rowLevel, missingCost };
  });

  const outOfStockIngredients = rows.filter((r) => r.rowLevel === "CRITICO");
  const lowStockIngredients = rows.filter((r) => r.rowLevel === "ADVERTENCIA");

  return (
    <div className={`rounded-vimdy-md border bg-vimdy-background/60 p-4 space-y-4 ${levelMeta.panelClass}`}>
      <div className="flex items-center gap-2">
        <Factory size={16} className="text-vimdy-accent" />
        <h3 className="text-vimdy-text font-semibold text-sm">Producción Inteligente</h3>
      </div>

      {profitability.costUnreliable && (
        <p className="text-vimdy-warning text-xs flex items-center gap-1.5">
          <AlertTriangle size={12} className="shrink-0" />
          Costo no confiable: falta precio de compra de {cost.missingCostIngredients.join(", ")}. Las cifras de
          abajo asumen $0 para ese ingrediente.
        </p>
      )}

      {/* Tarjetas principales */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
        <MetricCard icon={<Package size={13} />} label="Costo de producción" value={money(cost.costPerPortion)} />
        <MetricCard icon={<DollarSign size={13} />} label="Precio de venta" value={money(profitability.price)} />
        {!!estimatedPrepMinutes && (
          <MetricCard
            icon={<Clock3 size={13} />}
            label="Tiempo estimado"
            value={`${estimatedPrepMinutes} min`}
          />
        )}
        <MetricCard
          icon={<TrendingUp size={13} />}
          label="Ganancia"
          value={money(profitability.profit)}
          valueClassName={profitability.profit >= 0 ? "text-vimdy-success" : "text-vimdy-danger"}
        />
        <MetricCard
          icon={<Percent size={13} />}
          label="Margen"
          value={`${Math.round(profitability.marginPercent)}%`}
          valueClassName={profitability.marginPercent >= 0 ? "text-vimdy-success" : "text-vimdy-danger"}
        />
        <MetricCard icon={<Boxes size={13} />} label="Capacidad actual" value={`${capacity.maxUnits} unidades`} />
        <MetricCard
          icon={<ChefHat size={13} />}
          label="Ingrediente limitante"
          value={capacity.limitingIngredient?.name ?? "—"}
        />
      </div>

      {/* Estado general */}
      <div className={`rounded-vimdy-sm px-3 py-2 text-sm font-semibold flex items-center gap-2 ${levelMeta.badgeClass}`}>
        <span>{levelMeta.dot}</span>
        <span>{levelMeta.label}</span>
      </div>

      {/* Capacidad en lenguaje natural, nunca solo el stock del ingrediente */}
      <p className="text-vimdy-text-secondary text-sm">
        Con el inventario actual puedes preparar:{" "}
        <strong className="text-vimdy-text">
          {capacity.maxUnits} {productName}
        </strong>
        .
      </p>

      {/* Detalle de ingredientes */}
      <div>
        <p className="text-vimdy-text-secondary text-xs font-semibold uppercase tracking-wide mb-2">Detalle de ingredientes</p>
        <div className="overflow-x-auto rounded-vimdy-sm border border-vimdy-border">
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-vimdy-surface text-vimdy-text-tertiary text-left">
                <th className="px-3 py-2 font-medium">Ingrediente</th>
                <th className="px-3 py-2 font-medium">Cantidad</th>
                <th className="px-3 py-2 font-medium">Costo unitario</th>
                <th className="px-3 py-2 font-medium">Subtotal</th>
                <th className="px-3 py-2 font-medium text-center">Estado</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.productId} className="border-t border-vimdy-border-subtle text-vimdy-text-secondary">
                  <td className="px-3 py-2">
                    {row.name}
                    {row.isLimiting && (
                      <span className="ml-1.5 text-xs px-1.5 py-0.5 rounded-vimdy-xs bg-vimdy-accent/15 text-vimdy-accent border border-vimdy-accent/30">
                        Limitante
                      </span>
                    )}
                    {row.optional && (
                      <span className="ml-1.5 text-xs px-1.5 py-0.5 rounded-vimdy-xs bg-vimdy-recipe/15 text-vimdy-recipe border border-vimdy-recipe/30">
                        Opcional
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    {row.quantity}
                    {row.unit ? ` ${row.unit}` : ""}
                  </td>
                  <td className="px-3 py-2">{row.missingCost ? "Sin costo" : money(row.unitCost)}</td>
                  <td className="px-3 py-2">{row.missingCost ? "Sin costo" : money(row.subtotal)}</td>
                  <td className="px-3 py-2 text-center">{ROW_DOT[row.rowLevel]}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Alertas */}
      {(lowStockIngredients.length > 0 || outOfStockIngredients.length > 0) && (
        <div className="space-y-1.5">
          {lowStockIngredients.map((row) => (
            <p key={row.productId} className="text-vimdy-warning text-xs flex items-center gap-1.5">
              <AlertTriangle size={12} className="shrink-0" />
              {row.name}: este ingrediente limitará la producción muy pronto.
            </p>
          ))}
          {outOfStockIngredients.map((row) => (
            <p key={row.productId} className="text-vimdy-danger text-xs flex items-center gap-1.5">
              <XCircle size={12} className="shrink-0" />
              {row.name}: no puedes preparar más {productName} sin reponer este ingrediente.
            </p>
          ))}
        </div>
      )}

      {/* Botones de acción */}
      <div className="grid grid-cols-2 gap-2 pt-1">
        <ActionButton icon={<Package size={13} />} label="Ver inventario" onClick={onViewInventory} />
        <ActionButton icon={<ChefHat size={13} />} label="Editar receta" onClick={onEditRecipe} />
        <ActionButton icon={<ShoppingCart size={13} />} label="Comprar ingredientes" onClick={onBuyIngredients} />
        <ActionButton icon={<History size={13} />} label="Ver Kardex" onClick={onViewKardex} />
      </div>
    </div>
  );
}

function MetricCard({
  icon,
  label,
  value,
  valueClassName
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  valueClassName?: string;
}) {
  return (
    <div className="rounded-vimdy-sm border border-vimdy-border bg-vimdy-surface p-2.5">
      <div className="flex items-center gap-1.5 text-vimdy-text-tertiary text-xs mb-1">
        {icon}
        <span>{label}</span>
      </div>
      <p className={`text-vimdy-text font-semibold text-sm ${valueClassName ?? ""}`}>{value}</p>
    </div>
  );
}

function ActionButton({
  icon,
  label,
  onClick
}: {
  icon: React.ReactNode;
  label: string;
  onClick?: () => void;
}) {
  if (!onClick) return null;

  return (
    <button
      type="button"
      onClick={onClick}
      className="h-9 px-3 rounded-vimdy-sm border border-vimdy-border text-vimdy-text-secondary text-xs font-medium hover:bg-vimdy-surface-hover flex items-center justify-center gap-1.5"
    >
      {icon}
      {label}
    </button>
  );
}