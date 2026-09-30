import type {
  RecipeCost,
  Profitability,
  ProductionCapacity,
} from "../../../core/engines/RecipeEngine";

export interface RecipeSummary {
  readonly cost: RecipeCost;
  readonly profitability: Profitability;
  readonly capacity: ProductionCapacity;
}
