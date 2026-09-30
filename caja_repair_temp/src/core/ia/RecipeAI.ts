import { supabase } from "../../infrastructure/supabase/supabaseClient";
import { Category, Product } from "../entities/Entities";

/**
 * ✨ Generar receta con IA.
 * ---------------------------------------------------------------------------
 * El usuario escribe el nombre de un plato (ej. "Hamburguesa doble con
 * tocineta") y la Edge Function `recipe-ai` (Claude) propone: categoría,
 * precio de venta e ingredientes con cantidad.
 *
 * Regla de oro: la IA SOLO puede elegir ingredientes que ya existen de
 * verdad en el inventario del negocio (se le manda la lista real completa).
 * Nada de lo que devuelve este módulo en `ingredients` es inventado — cada
 * fila trae el `productId` real de un producto que ya existe. Si la IA
 * sugiere algo que el negocio no tiene todavía (ej. "tocineta"), ese nombre
 * vuelve aparte en `unmatchedIngredients`, nunca mezclado con los reales.
 */

export interface RecipeAIIngredient {
  productId: string;
  name: string;
  unit?: string;
  quantity: number;
}

export interface RecipeAIResult {
  /** Nombre exacto de una categoría real del negocio, o null si ninguna encajó. */
  category: string | null;
  /** Precio de venta sugerido en COP, o null si el modelo no propuso uno válido. */
  suggestedPrice: number | null;
  /** Ingredientes ya resueltos contra productos reales del inventario. */
  ingredients: RecipeAIIngredient[];
  /** Nombres sugeridos por la IA que NO existen todavía en el inventario del negocio. */
  unmatchedIngredients: string[];
}

interface RawRecipeAIResponse {
  category: string | null;
  suggestedPrice: number | null;
  ingredients: RecipeAIIngredient[];
  unmatchedIngredients: string[];
}

/**
 * @param dishName nombre del plato que escribió el usuario (ej. "Hamburguesa especial").
 * @param inventory productos reales del negocio que pueden usarse como ingrediente
 *   (normalmente todo `allProducts` del formulario, salvo el propio producto que se edita).
 * @param categories categorías reales del negocio, para que la IA sugiera una.
 */
export async function generateRecipeWithAI(
  dishName: string,
  inventory: Product[],
  categories: Category[] = []
): Promise<RecipeAIResult> {
  const trimmedName = dishName.trim();

  if (!trimmedName) {
    throw new Error("DISH_NAME_REQUIRED");
  }

  const { data, error } = await supabase.functions.invoke("recipe-ai", {
    body: {
      dishName: trimmedName,
      categories: categories.map((c) => c.name),
      inventory: inventory.map((p) => ({ id: p.id, name: p.name, unit: p.unit }))
    }
  });

  if (error) {
    // Mismo patrón que MenuVisionAI: el detalle real del error viene en el
    // cuerpo de la respuesta HTTP, no en error.message.
    let detail = error.message;
    try {
      const body = await error.context?.json?.();
      if (body?.error) {
        detail = body.detail ? `${body.error}: ${String(body.detail).slice(0, 300)}` : body.error;
      }
    } catch {
      // Si el cuerpo no es JSON legible, nos quedamos con el mensaje genérico.
    }
    throw new Error(`RECIPE_AI_UNAVAILABLE: ${detail}`);
  }

  const raw = (data ?? {}) as Partial<RawRecipeAIResponse>;

  return {
    category: raw.category ?? null,
    suggestedPrice: raw.suggestedPrice ?? null,
    ingredients: Array.isArray(raw.ingredients) ? raw.ingredients : [],
    unmatchedIngredients: Array.isArray(raw.unmatchedIngredients) ? raw.unmatchedIngredients : []
  };
}