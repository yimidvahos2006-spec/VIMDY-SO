import React from "react";
import { FormSectionCard } from "./FormSectionCard";
import { ProductionIntelligencePanel } from "../inventory/ProductionIntelligencePanel";
import { RecipeSummary } from "./IngredientConsumptionEditor";

interface ProductionSectionProps {
  hasRecipe: boolean;
  recipeSummary: RecipeSummary | null;
  productName: string;
  minStock: string;
  estimatedPrepMinutes: string;

  onViewInventory: () => void;
  /** Lleva al usuario de vuelta a la tarjeta "🧪 Consumo de ingredientes" (recipeSectionRef). */
  onEditRecipe: () => void;
  onBuyIngredients?: (ingredientId: string) => void;
  onViewKardex?: () => void;

  money: (value: number) => string;
}

/**
 * PASO 4 (reconstrucción del formulario de producto -- tarjeta 🏭 "Producción
 * y rentabilidad"): todo lo que `RecipeEngine` calcula a partir de la receta
 * pero que NO responde la pregunta de "🧪 Consumo de ingredientes" (¿qué
 * ingredientes lleva?). Esta tarjeta responde una pregunta distinta: con lo
 * que hoy tengo en inventario, ¿cuánto cuesta, cuánto gano y cuánto puedo
 * producir?
 *
 * Envuelve `ProductionIntelligencePanel` (que ya existía, sin tocarlo) igual
 * que `RecipeSection` envuelve a `IngredientConsumptionEditor`. El único
 * cálculo que se hace aquí es leer `capacity.limitingIngredient` para
 * decidir QUÉ ingrediente comprar cuando el dueño toca "Comprar
 * ingredientes" -- `RecipeEngine` sigue siendo la única fuente de verdad
 * para costo/ganancia/capacidad.
 *
 * Si todavía no hay receta o la receta no alcanza a calcular costo
 * (`recipeSummary === null`, ej. porque falta un ingrediente o un precio de
 * compra), la tarjeta se muestra igual pero con un mensaje en vez del
 * panel, para que el dueño entienda que le falta un paso antes de ver estas
 * cifras.
 */
export function ProductionSection({
  hasRecipe,
  recipeSummary,
  productName,
  minStock,
  estimatedPrepMinutes,
  onViewInventory,
  onEditRecipe,
  onBuyIngredients,
  onViewKardex,
  money
}: ProductionSectionProps) {
  if (!hasRecipe) return null;

  const minStockValue = minStock.trim() ? Number(minStock) : 0;
  const prepMinutesValue = estimatedPrepMinutes.trim() ? Number(estimatedPrepMinutes) : undefined;

  return (
    <FormSectionCard
      icon="🏭"
      title="Producción y rentabilidad"
      subtitle={
        recipeSummary
          ? `Costo ${money(recipeSummary.cost.costPerPortion)} · Margen ${Math.round(
              recipeSummary.profitability.marginPercent
            )}% · ${recipeSummary.capacity.maxUnits} unidades posibles`
          : "Agrega ingredientes con precio de compra en la receta para ver costo, ganancia y capacidad de producción."
      }
      defaultOpen={!!recipeSummary}
    >
      {recipeSummary ? (
        <ProductionIntelligencePanel
          productName={productName.trim() || "este producto"}
          cost={recipeSummary.cost}
          profitability={recipeSummary.profitability}
          capacity={recipeSummary.capacity}
          minStock={minStockValue}
          estimatedPrepMinutes={prepMinutesValue}
          onViewInventory={onViewInventory}
          onEditRecipe={onEditRecipe}
          onBuyIngredients={
            onBuyIngredients
              ? () => onBuyIngredients(recipeSummary.capacity.limitingIngredient?.productId ?? "")
              : undefined
          }
          onViewKardex={onViewKardex}
        />
      ) : (
        <p className="text-vimdy-text-tertiary text-sm">
          Agrega al menos un ingrediente en "Consumo de ingredientes" con precio de compra
          cargado para ver aquí el costo, la ganancia, el margen y cuántas unidades puedes
          preparar hoy con el inventario actual.
        </p>
      )}
    </FormSectionCard>
  );
}