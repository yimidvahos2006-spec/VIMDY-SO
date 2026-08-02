// ============================================================================
// recipe-ai (Supabase Edge Function)
// ----------------------------------------------------------------------------
// "✨ Generar receta con IA" — el usuario escribe el nombre de un plato
// (ej. "Hamburguesa doble con tocineta") y Claude propone: los ingredientes
// (cantidad + unidad), una categoría sugerida y un precio de venta sugerido.
//
// Regla de oro (pedida explícitamente por el negocio): el modelo NUNCA
// inventa productos de inventario nuevos. Solo puede elegir ingredientes de
// la lista EXACTA de productos que el negocio ya tiene registrados en
// Inventario — la misma lista que ya usa el selector manual de ingredientes
// en el formulario de producto. Cualquier ingrediente que el modelo sugiera
// y que NO matchee ningún producto real de esa lista se devuelve aparte,
// como "sugerencia sin match" — nunca se cuela como si fuera un ingrediente
// real ya validado. Esa limpieza pasa acá, en el servidor, igual que
// menu-vision valida categorías del lado del backend.
//
// Mismo patrón de seguridad que copilot-chat: la ANTHROPIC_API_KEY vive acá,
// nunca en el navegador.
//
// El cliente (RecipeAI.ts) llama a esta función con:
//   {
//     dishName: "Hamburguesa doble con tocineta",
//     categories: ["Entradas", "Platos fuertes", ...],
//     inventory: [{ id, name, unit }, ...]  // productos reales del negocio
//   }
// y recibe:
//   {
//     category: "Platos fuertes" | null,
//     suggestedPrice: 18000 | null,
//     ingredients: [{ productId, name, unit, quantity }],
//     unmatchedIngredients: ["tocineta"]  // sugeridos por la IA, sin match real en inventario
//   }
//
// CONFIGURACIÓN (una sola vez, desde tu terminal):
//   supabase secrets set ANTHROPIC_API_KEY=sk-ant-xxxxxxxx
//
// DESPLIEGUE:
//   supabase functions deploy recipe-ai
// ============================================================================

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type"
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" }
  });
}

interface InventoryItem {
  id: string;
  name: string;
  unit?: string;
}

interface RequestPayload {
  dishName?: string;
  categories?: string[];
  inventory?: InventoryItem[];
}

interface RawIngredient {
  nombre_inventario?: string;
  cantidad?: number;
  unidad?: string;
}

interface RawRecipeResponse {
  categoria?: string;
  precio_sugerido?: number;
  ingredientes?: RawIngredient[];
}

const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY");
const ANTHROPIC_MODEL = "claude-sonnet-5";

function buildSystemPrompt(categories: string[], inventory: InventoryItem[]): string {
  const categorySection = categories.length > 0
    ? `Elegí la categoría que mejor le corresponda al plato de esta lista EXACTA de categorías del negocio (son las únicas válidas, no inventes otras): ${categories.join(", ")}. Si ninguna encaja, dejá "categoria" como cadena vacía.`
    : `El negocio todavía no tiene categorías configuradas: dejá "categoria" como cadena vacía.`;

  const inventorySection = inventory.length > 0
    ? `Estos son los ÚNICOS productos que existen hoy en el inventario del negocio (nombre real y unidad, si tiene). SOLO podés usar ingredientes de esta lista EXACTA — nunca inventes un ingrediente que no esté acá, aunque sea obvio que el plato lo necesita:\n${inventory.map((i) => `- ${i.name}${i.unit ? ` (unidad: ${i.unit})` : ""}`).join("\n")}\n\nSi el plato necesita un ingrediente real que NO está en esa lista (ej. "tocineta" para una hamburguesa que la lleva), igual lo podés sugerir con su nombre normal — el sistema se encarga de avisarle al usuario que ese ingrediente todavía no existe en su inventario, para que lo cree si quiere. Vos nunca decidís eso, solo proponés.`
    : `El negocio todavía no tiene ningún producto registrado en Inventario. Proponé los ingredientes normales del plato de todas formas — el sistema le avisará al usuario que ninguno existe todavía.`;

  return `Eres un chef y administrador de restaurante experto, ayudando a construir la receta (BOM — lista de ingredientes con cantidades) de un plato para un sistema de punto de venta (POS) en Colombia.

Te dan el nombre de un plato. Tu trabajo:
1. Proponer la lista de ingredientes reales que lleva ese plato, con cantidad y unidad de medida (gramos "g", mililitros "ml", o "unidad" para cosas contables como panes, tajadas, huevos).
2. Proponer una categoría de menú.
3. Proponer un precio de venta razonable en pesos colombianos (COP), como si fuera un restaurante popular/informal — nunca un precio de restaurante de lujo.

${inventorySection}

${categorySection}

Reglas estrictas:
- Cantidades realistas para UNA porción/unidad vendida, no para un lote grande.
- Nunca inventes cantidades absurdas (ej. 5000g de sal).
- El precio sugerido debe ser mayor al costo estimado de los ingredientes (para que el negocio gane), pero razonable para el mercado colombiano.
- Si "nombre_inventario" corresponde a un producto que SÍ está en la lista de inventario de arriba, usá el nombre EXACTAMENTE como aparece ahí.
- No repitas el mismo ingrediente dos veces.
- Responde ÚNICAMENTE con un JSON válido, sin texto adicional, con esta forma exacta:
{"categoria":"Platos fuertes","precio_sugerido":18000,"ingredientes":[{"nombre_inventario":"Carne molida","cantidad":150,"unidad":"g"},{"nombre_inventario":"Pan hamburguesa","cantidad":1,"unidad":"unidad"}]}`;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }

  if (!ANTHROPIC_API_KEY) {
    return json(
      { error: "ANTHROPIC_API_KEY_MISSING: configura el secreto con `supabase secrets set ANTHROPIC_API_KEY=...`" },
      500
    );
  }

  let payload: RequestPayload;

  try {
    payload = await req.json();
  } catch {
    return json({ error: "INVALID_JSON" }, 400);
  }

  const dishName = typeof payload.dishName === "string" ? payload.dishName.trim() : "";

  if (!dishName) {
    return json({ error: "DISH_NAME_REQUIRED" }, 400);
  }

  const categories = Array.isArray(payload.categories)
    ? Array.from(
        new Set(
          payload.categories.filter((c): c is string => typeof c === "string" && c.trim().length > 0).map((c) => c.trim())
        )
      )
    : [];

  const inventory = Array.isArray(payload.inventory)
    ? payload.inventory.filter(
        (i): i is InventoryItem => i && typeof i.id === "string" && typeof i.name === "string" && i.name.trim().length > 0
      )
    : [];

  // Mapa nombre(minúscula) -> producto real, para validar del lado del
  // servidor que cada ingrediente que "eligió" el modelo de verdad existe
  // en el inventario del negocio — nunca se confía a ciegas en el nombre
  // que devolvió el modelo.
  const inventoryByLowerName = new Map(inventory.map((i) => [i.name.trim().toLowerCase(), i]));
  const categoryByLowerName = new Map(categories.map((c) => [c.toLowerCase(), c]));

  try {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01"
      },
      body: JSON.stringify({
        model: ANTHROPIC_MODEL,
        max_tokens: 1024,
        system: buildSystemPrompt(categories, inventory),
        messages: [
          { role: "user", content: `Plato: "${dishName}". Devuelve el JSON de la receta según las reglas del sistema.` }
        ]
      })
    });

    if (!response.ok) {
      const errorBody = await response.text();
      return json({ error: "ANTHROPIC_API_ERROR", detail: errorBody }, 502);
    }

    const data = await response.json();

    const rawText: string = (data.content ?? [])
      .filter((block: { type: string }) => block.type === "text")
      .map((block: { text: string }) => block.text)
      .join("\n")
      .trim();

    let parsed: RawRecipeResponse;
    try {
      // El modelo a veces envuelve el JSON en ```json ... ``` a pesar de la
      // instrucción — se limpia por las dudas, igual que ya hace el cliente
      // del Copiloto con otras respuestas de Claude.
      const cleaned = rawText.replace(/^```json\s*|```$/g, "").trim();
      parsed = JSON.parse(cleaned);
    } catch {
      return json({ error: "MODEL_RESPONSE_NOT_JSON", detail: rawText }, 502);
    }

    const modelCategory = typeof parsed.categoria === "string" ? parsed.categoria.trim() : "";
    const category = categoryByLowerName.get(modelCategory.toLowerCase()) ?? null;

    const suggestedPrice =
      typeof parsed.precio_sugerido === "number" && parsed.precio_sugerido > 0
        ? Math.round(parsed.precio_sugerido)
        : null;

    const rawIngredients = Array.isArray(parsed.ingredientes) ? parsed.ingredientes : [];

    const ingredients: { productId: string; name: string; unit?: string; quantity: number }[] = [];
    const unmatchedIngredients: string[] = [];

    for (const item of rawIngredients) {
      const rawName = typeof item.nombre_inventario === "string" ? item.nombre_inventario.trim() : "";
      const quantity = typeof item.cantidad === "number" && item.cantidad > 0 ? item.cantidad : null;

      if (!rawName || !quantity) continue;

      const match = inventoryByLowerName.get(rawName.toLowerCase());

      if (match) {
        ingredients.push({
          productId: match.id,
          name: match.name,
          unit: match.unit,
          quantity
        });
      } else {
        // Sugerido por la IA pero no existe hoy en el inventario real del
        // negocio: NUNCA se agrega como si fuera un ingrediente válido. Se
        // reporta aparte para que el usuario decida si lo quiere crear.
        unmatchedIngredients.push(rawName);
      }
    }

    return json({ category, suggestedPrice, ingredients, unmatchedIngredients });
  } catch (error) {
    return json({ error: "RECIPE_AI_REQUEST_FAILED", detail: String(error) }, 500);
  }
});