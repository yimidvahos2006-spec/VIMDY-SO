// ============================================================================
// menu-vision (Supabase Edge Function)
// ----------------------------------------------------------------------------
// VIMDY Smart Import V2 — reemplaza al OCR genérico (tesseract.js) que corría
// en el navegador. En vez de "leer texto de una imagen", esta función le
// pide a Gemini (modelo de Google con visión, nivel gratis) que analice la
// foto SABIENDO que es un menú de restaurante: ignora decoración, fondos,
// logos y ruido, y devuelve únicamente productos reales con nombre + precio,
// marcando con requiere_revision los que no está seguro de haber leído bien.
//
// Paso 2.1 (Categorías con IA): además de nombre/precio, ahora la función
// recibe la lista de categorías reales del negocio y le pide al modelo que
// sugiera una categoría por producto (o "Sin clasificar" si ninguna encaja).
// El modelo NUNCA inventa categorías nuevas: solo puede elegir entre las que
// el negocio ya tiene, o "Sin clasificar" — eso se valida acá mismo, del lado
// del servidor, por si el modelo se equivoca o alucina un nombre parecido.
//
// Mismo patrón de seguridad que copilot-chat: la GEMINI_API_KEY vive acá,
// nunca en el navegador.
//
// El cliente (MenuVisionAI.ts) llama a esta función con:
//   { image: "data:image/jpeg;base64,....", categories: ["Entradas", "Platos fuertes", ...] }
// y recibe:
//   { items: [{ name, price, confidence, requiresReview, category }] }
//
// "categories" es opcional: si no se manda (o va vacío), la función sigue
// funcionando exactamente igual que antes, pero "category" siempre viene
// como "Sin clasificar" en cada item (todavía no hay contra qué clasificar).
//
// CONFIGURACIÓN (una sola vez, desde tu terminal):
//   supabase secrets set GEMINI_API_KEY=AIzaSy...
//
// DESPLIEGUE:
//   supabase functions deploy menu-vision
// ============================================================================

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type"
};

const SIN_CLASIFICAR = "Sin clasificar";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" }
  });
}

interface RequestPayload {
  image?: string; // data URL: "data:image/jpeg;base64,...."
  categories?: string[]; // nombres de las categorías reales del negocio
}

interface RawMenuItem {
  nombre?: string;
  precio?: number;
  confianza?: number;
  requiere_revision?: boolean;
  categoria?: string;
}

const GEMINI_API_KEY = Deno.env.get("GEMINI_API_KEY");
// gemini-2.5-flash fue descontinuado por Google para cuentas nuevas (404
// NOT_FOUND, julio 2026). El reemplazo GA (listo para producción) vigente
// es gemini-3.6-flash: multimodal, más rápido y más barato que 2.5-flash.
// Si en el futuro Google lo retira también, revisá la lista de modelos
// vigentes en https://ai.google.dev/gemini-api/docs/models antes de cambiar
// este string — no lo inventes a ciegas.
const GEMINI_MODEL = "gemini-3.6-flash";
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;

// Prompt especializado en menús (Fase 2 del rediseño). Se le pide al modelo
// que devuelva SOLO un JSON válido — con responseMimeType "application/json"
// Gemini se encarga de eso, no hace falta parsear lenguaje natural.
//
// Es una función (no una constante fija) porque la lista de categorías
// cambia según el negocio que llama a la función — cada request arma su
// propio bloque de "categorías disponibles" a partir de lo que mandó el
// cliente.
function buildSystemPrompt(categories: string[]): string {
  const categorySection = categories.length > 0
    ? `
Además de nombre y precio, para cada producto elegí la categoría que mejor le
corresponda de esta lista EXACTA de categorías del negocio (son las únicas
válidas, no inventes otras ni las traduzcas ni las reformules):
${categories.map((c) => `- ${c}`).join("\n")}

Reglas para la categoría:
- Usá el nombre de la categoría EXACTAMENTE como aparece en la lista de arriba.
- Si ningún producto de la lista encaja claramente, o no podés determinarlo con
  confianza, usá literalmente "${SIN_CLASIFICAR}" — no adivines ni fuerces una
  categoría que no corresponde.`
    : `
No hay categorías configuradas todavía para este negocio: para cada producto,
usá siempre "${SIN_CLASIFICAR}" como categoría.`;

  return `Eres un sistema experto en digitalizar menús de restaurante a partir de fotos.

Esta imagen corresponde a un menú de restaurante. Ignora completamente:
- decoración, fondos, texturas y logotipos
- líneas divisorias, íconos y adornos
- sombras, reflejos y dobleces del papel
- cualquier caracter o palabra ilegible

Extrae ÚNICAMENTE productos reales del menú. Cada producto tiene nombre y precio.

Reglas estrictas:
- Corrige mayúsculas: nombres en formato "Título" (ej: "Bandeja Paisa", no "BANDEJA PAISA" ni "bandeja paisa").
- Elimina puntos, guiones y símbolos sueltos que no sean parte real del nombre (ej. líneas de puntos "......" usadas para unir el nombre con el precio no son parte del nombre).
- El precio va en pesos colombianos, como número entero sin símbolos (ej: 22000, no "$22.000").
- Si no puedes leer un nombre o un precio con al menos 90% de confianza, NO LO INVENTES: usa tu mejor lectura parcial y marca "requiere_revision": true.
- Si una fila es pura decoración, ruido o no tiene precio identificable, NO la incluyas.
- No repitas el mismo producto dos veces.
${categorySection}

Responde ÚNICAMENTE con un JSON válido, con esta forma exacta:
{"items":[{"nombre":"Bandeja Paisa","precio":22000,"confianza":0.97,"requiere_revision":false,"categoria":"Platos fuertes"}]}`;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }

  if (!GEMINI_API_KEY) {
    return json(
      { error: "GEMINI_API_KEY_MISSING: configura el secreto con `supabase secrets set GEMINI_API_KEY=...`" },
      500
    );
  }

  let payload: RequestPayload;

  try {
    payload = await req.json();
  } catch {
    return json({ error: "INVALID_JSON" }, 400);
  }

  const { image } = payload;

  if (!image || !image.startsWith("data:image/")) {
    return json({ error: "IMAGE_REQUIRED" }, 400);
  }

  // Lista de categorías del negocio: solo strings no vacíos, sin duplicados.
  // Si el cliente manda cualquier otra cosa (undefined, no-array, etc.) la
  // tratamos como "no hay categorías" en vez de romper el request.
  const categories = Array.isArray(payload.categories)
    ? Array.from(
        new Set(
          payload.categories
            .filter((c): c is string => typeof c === "string" && c.trim().length > 0)
            .map((c) => c.trim())
        )
      )
    : [];

  // Set en minúsculas para validar la respuesta del modelo sin importar
  // diferencias de mayúsculas/espacios — pero el valor final que devolvemos
  // siempre es el nombre EXACTO tal como lo mandó el negocio.
  const categoryByLowerCase = new Map(categories.map((c) => [c.toLowerCase(), c]));

  // "data:image/jpeg;base64,AAAA..." -> mime_type + datos puros en base64.
  const match = image.match(/^data:(image\/[a-zA-Z+]+);base64,(.+)$/);
  if (!match) {
    return json({ error: "INVALID_IMAGE_FORMAT" }, 400);
  }
  const [, mimeType, base64Data] = match;

  try {
    const response = await fetch(`${GEMINI_URL}?key=${GEMINI_API_KEY}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: buildSystemPrompt(categories) }] },
        contents: [
          {
            role: "user",
            parts: [
              { inlineData: { mimeType: mimeType, data: base64Data } },
              { text: "Analiza esta foto de menú y devuelve el JSON de productos según las reglas del sistema." }
            ]
          }
        ],
        generationConfig: {
          temperature: 0.2,
          responseMimeType: "application/json",
          // Extraer productos de una foto es una tarea simple de percepción,
          // no de razonamiento profundo: "low" evita que el modelo se ponga
          // a "pensar" de más (eso es lo que agregaba los segundos extra).
          thinkingConfig: { thinkingLevel: "low" },
          maxOutputTokens: 4096
        }
      })
    });

    if (!response.ok) {
      const errorBody = await response.text();
      return json({ error: "GEMINI_API_ERROR", detail: errorBody }, 502);
    }

    const data = await response.json();

    const rawText: string = data?.candidates?.[0]?.content?.parts
      ?.map((p: { text?: string }) => p.text ?? "")
      .join("\n")
      .trim() ?? "";

    let parsed: { items?: RawMenuItem[] };
    try {
      parsed = JSON.parse(rawText);
    } catch {
      return json({ error: "MODEL_RESPONSE_NOT_JSON", detail: rawText }, 502);
    }

    const items = (parsed.items ?? [])
      .filter((item) => item && typeof item.nombre === "string" && item.nombre.trim().length > 0)
      .map((item) => {
        // Nunca confiamos ciegamente en lo que devolvió el modelo para la
        // categoría: si no coincide (ni siquiera ignorando mayúsculas) con
        // una categoría real del negocio, cae a "Sin clasificar". Así el
        // modelo jamás puede "crear" una categoría fantasma en el frontend.
        const modelCategory = typeof item.categoria === "string" ? item.categoria.trim() : "";
        const category = categoryByLowerCase.get(modelCategory.toLowerCase()) ?? SIN_CLASIFICAR;

        return {
          name: item.nombre!.trim(),
          price: Math.max(0, Math.round(Number(item.precio) || 0)),
          confidence: typeof item.confianza === "number" ? item.confianza : 1,
          requiresReview: Boolean(item.requiere_revision) || (item.precio ?? 0) <= 0,
          category
        };
      });

    return json({ items });
  } catch (error) {
    return json({ error: "MENU_VISION_REQUEST_FAILED", detail: String(error) }, 500);
  }
});