import { supabase, getCurrentBusinessId } from "../../infrastructure/supabase/supabaseClient";
import { connectionStore } from "../store/connectionStore";

/**
 * VIMDY IA — "Describe tu plato".
 * ---------------------------------------------------------------------------
 * El usuario escribe o dicta un plato en lenguaje natural y la Edge Function
 * `vimdy-ia-dish` (Gemini, con la clave protegida en el servidor) devuelve los
 * datos estructurados: nombre, categoría, estación, precio e insumos con
 * cantidad y unidad.
 *
 * Este módulo solo habla con la función y valida la forma de la respuesta.
 * Cruzar los insumos contra el inventario real vive en `dishDraft.ts`, y
 * rellenar el formulario vive en `ProductFormModal`.
 */

export type DishUnit = "g" | "kg" | "ml" | "litro" | "libra" | "unidad";

export interface DishAIIngredient {
  name: string;
  quantity: number;
  unit: DishUnit;
  /** true si el usuario NO dijo la cantidad y la IA propuso una típica. */
  estimated: boolean;
}

export interface DishAIResult {
  name: string;
  /** Nombre exacto de una categoría real del negocio, o null si ninguna encajó. */
  category: string | null;
  /** Nombre de categoría nueva sugerido cuando ninguna existente encajó. */
  suggestedCategory: string | null;
  station: string | null;
  /** Precio de venta en pesos (entero), o null si el usuario no lo dijo. */
  price: number | null;
  ingredients: DishAIIngredient[];
}

export const DISH_TEXT_MAX_LENGTH = 600;

const VALID_UNITS: ReadonlySet<string> = new Set(["g", "kg", "ml", "litro", "libra", "unidad"]);

export async function parseDishWithAI(
  text: string,
  categoryNames: string[],
  stationNames: string[]
): Promise<DishAIResult> {
  const trimmed = text.trim().slice(0, DISH_TEXT_MAX_LENGTH);

  if (!trimmed) {
    throw new Error("DISH_TEXT_REQUIRED");
  }

  if (!connectionStore.isOnline()) {
    throw new Error("VIMDY_IA_OFFLINE: VIMDY IA necesita internet. Cuando vuelva la conexión, inténtalo de nuevo.");
  }

  const businessId = getCurrentBusinessId();
  if (!businessId) {
    throw new Error("VIMDY_IA_UNAVAILABLE: no hay un negocio activo en esta sesión.");
  }

  const { data, error } = await supabase.functions.invoke("vimdy-ia-dish", {
    body: { text: trimmed, businessId, categories: categoryNames, stations: stationNames }
  });

  if (error) {
    // supabase-js esconde el motivo real en error.context (la Response HTTP).
    let detail = error.message;
    try {
      const response = (error as { context?: Response }).context;
      if (response && typeof response.json === "function") {
        const body = await response.json();
        detail = [body?.error, body?.detail].filter(Boolean).join(" — ") || detail;
      }
    } catch {
      // Si el cuerpo no es JSON legible, nos quedamos con el mensaje genérico.
    }
    throw new Error(`VIMDY_IA_UNAVAILABLE: ${detail}`);
  }

  return sanitizeDishResult(data);
}

/** Red de seguridad en el cliente: nunca se confía ciegamente en la respuesta. */
export function sanitizeDishResult(raw: unknown): DishAIResult {
  const data = (raw ?? {}) as Record<string, unknown>;

  const asText = (value: unknown) => (typeof value === "string" ? value.trim() : "");
  const price = typeof data.price === "number" && Number.isFinite(data.price) && data.price > 0 ? Math.round(data.price) : null;

  const ingredients: DishAIIngredient[] = [];
  for (const item of Array.isArray(data.ingredients) ? data.ingredients : []) {
    const entry = (item ?? {}) as Record<string, unknown>;
    const name = asText(entry.name);
    const quantity = typeof entry.quantity === "number" ? entry.quantity : Number.NaN;
    const unit = asText(entry.unit);
    if (!name || !Number.isFinite(quantity) || quantity <= 0 || !VALID_UNITS.has(unit)) continue;
    ingredients.push({ name, quantity, unit: unit as DishUnit, estimated: entry.estimated === true });
  }

  return {
    name: asText(data.name),
    category: asText(data.category) || null,
    suggestedCategory: asText(data.suggestedCategory) || null,
    station: asText(data.station) || null,
    price,
    ingredients
  };
}

export function describeDishAIError(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err ?? "");

  if (message.includes("SUBSCRIPTION_EXPIRED")) {
    return "Tu suscripción venció. Elige un plan para seguir usando VIMDY IA.";
  }
  if (message.includes("VIMDY_IA_OFFLINE")) {
    return "VIMDY IA necesita internet. Revisa tu conexión e inténtalo de nuevo.";
  }
  if (message.includes("GEMINI_API_KEY_MISSING")) {
    return "VIMDY IA todavía no está configurada en el servidor (falta la clave de Gemini).";
  }
  if (message.includes("DISH_TEXT_REQUIRED") || message.includes("TEXT_REQUIRED")) {
    return "Escribe o dicta el plato primero.";
  }
  return "No pudimos entender el plato en este momento. Inténtalo de nuevo o crea el producto a mano.";
}