import { supabase } from "../../infrastructure/supabase/supabaseClient";
import { Category } from "../entities/Entities";

/**
 * VIMDY Smart Import V2 — Paso 2.
 * ---------------------------------------------------------------------------
 * Reemplaza a MenuOcrAI.ts (OCR genérico con tesseract.js, ~28s, sin entender
 * que la imagen es un menú). Ahora se usa un modelo con visión real
 * (Edge Function `menu-vision` -> Claude), que entiende layout, ignora
 * decoración y devuelve productos ya corregidos — sin descargar ningún
 * motor de OCR en el navegador.
 *
 * Este archivo hace dos cosas:
 * 1) Preprocesa la foto en el navegador (Fase 1 simplificada): la redimensiona
 *    y recomprime con <canvas>. No hace falta OpenCV — el modelo de visión ya
 *    resuelve inclinación/sombras/ruido — pero SÍ hace falta achicar fotos de
 *    12+ MP de un celular, porque eso es lo que agrega segundos de subida
 *    y no aporta nada de precisión extra.
 * 2) Llama a la función `menu-vision` y normaliza la respuesta (Fase 3:
 *    limpieza final de nombres, como red de seguridad extra).
 *
 * Paso 2.2 (Categorías con IA): además de nombre/precio, ahora se le puede
 * pasar la lista de categorías reales del negocio a `readMenuImage`. La
 * función se las manda a la Edge Function (que ya sabe clasificar, ver
 * `supabase/functions/menu-vision/index.ts`) y, con la respuesta, resuelve
 * el `categoryId` real cruzando el nombre que sugirió la IA contra esa misma
 * lista — así el resultado ya viene listo para precargar el selector de
 * categoría de cada fila (eso lo conecta el Paso 2.3 en InventoryDashboard).
 */

const SIN_CLASIFICAR = "Sin clasificar";

export interface MenuVisionItem {
  name: string;
  price: number;
  confidence: number;
  requiresReview: boolean;
  /** Nombre de categoría sugerido por la IA, o "Sin clasificar". Siempre viene. */
  category: string;
  /**
   * Id real de la categoría del negocio si `category` matcheó alguna de las
   * que se le pasó a `readMenuImage`. `null` cuando es "Sin clasificar" o
   * cuando no se le pasó ninguna lista de categorías (compatibilidad con
   * llamadas viejas que todavía no mandan categorías).
   */
  categoryId: string | null;
}

// Compatibilidad con el código existente que importaba MenuOcrItem.
export type MenuOcrItem = MenuVisionItem;

const MAX_DIMENSION = 1600; // px — de sobra para que el modelo lea el texto.
const JPEG_QUALITY = 0.85;

/** Redimensiona y recomprime la imagen antes de subirla (Fase 1). */
async function optimizeImage(dataUrl: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, MAX_DIMENSION / Math.max(img.width, img.height));
      const width = Math.round(img.width * scale);
      const height = Math.round(img.height * scale);

      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;

      const ctx = canvas.getContext("2d");
      if (!ctx) {
        // Si el navegador no soporta canvas por alguna razón, seguimos con
        // la imagen original en vez de romper el flujo.
        resolve(dataUrl);
        return;
      }

      ctx.drawImage(img, 0, 0, width, height);
      resolve(canvas.toDataURL("image/jpeg", JPEG_QUALITY));
    };
    img.onerror = () => reject(new Error("No se pudo procesar la imagen."));
    img.src = dataUrl;
  });
}

/** Limpieza final del nombre: quita basura de OCR/decoración que se haya colado. */
function cleanName(name: string): string {
  return name
    .replace(/\.{2,}/g, " ") // líneas de puntos "......"
    .replace(/[_~`|]+/g, " ")
    .replace(/\s{2,}/g, " ")
    .trim();
}

// Forma cruda que devuelve hoy la Edge Function (ver index.ts del backend).
// `category` puede no venir todavía si el backend desplegado es viejo —
// por eso se trata como opcional acá y se cae a "Sin clasificar" abajo.
interface RawMenuVisionItem {
  name: string;
  price: number;
  confidence: number;
  requiresReview: boolean;
  category?: string;
}

/**
 * Analiza la foto del menú con el modelo de visión y devuelve los productos
 * candidatos, ya limpios, para la pantalla de revisión.
 *
 * @param imageDataUrl foto del menú en base64 (data URL).
 * @param categories categorías reales del negocio, para que la IA sugiera
 *   una por producto. Opcional: si no se pasa (o el negocio no tiene
 *   categorías todavía), todos los productos vuelven como "Sin clasificar".
 */
export async function readMenuImage(
  imageDataUrl: string,
  categories: Category[] = []
): Promise<MenuVisionItem[]> {
  const optimized = await optimizeImage(imageDataUrl);

  // Mapa nombre(minúscula) -> categoría real, para resolver categoryId sin
  // volver a pegarle a la base de datos. Mismo criterio que ya valida el
  // backend (ignora mayúsculas/espacios), así el front y el back nunca
  // discrepan en qué cuenta como "coincide".
  const categoryByLowerName = new Map(
    categories.map((c) => [c.name.trim().toLowerCase(), c])
  );

  const { data, error } = await supabase.functions.invoke("menu-vision", {
    body: {
      image: optimized,
      categories: categories.map((c) => c.name)
    }
  });

  if (error) {
    // supabase-js solo da "Edge Function returned a non-2xx status code" en
    // error.message — el detalle real (por qué falló) viene en el cuerpo de
    // la respuesta HTTP, disponible en error.context.
    let detail = error.message;
    try {
      const body = await error.context?.json?.();
      if (body?.error) {
        detail = body.detail ? `${body.error}: ${String(body.detail).slice(0, 300)}` : body.error;
      }
    } catch {
      // Si el cuerpo no es JSON legible, nos quedamos con el mensaje genérico.
    }

    // Gemini puede devolver errores de modelo no soportado o formato de
    // imagen inválido. Esos no son bugs de VIMDY: se muestran como
    // mensaje amigable en la UI, no como error crudo.
    const lowerDetail = detail.toLowerCase();
    if (
      lowerDetail.includes("model does not support image input") ||
      lowerDetail.includes("cannot read") ||
      lowerDetail.includes("invalid image") ||
      lowerDetail.includes("unsupported")
    ) {
      throw new Error("MENU_VISION_IMAGE_ERROR: La imagen no se pudo procesar. Verifica que sea un menú claro y legible, e intenta de nuevo.");
    }

    throw new Error(`MENU_VISION_UNAVAILABLE: ${detail}`);
  }

  const items = (data?.items ?? []) as RawMenuVisionItem[];

  return items
    .map((item) => {
      const category = item.category?.trim() || SIN_CLASIFICAR;
      const matched = categoryByLowerName.get(category.toLowerCase());

      return {
        name: cleanName(item.name),
        price: item.price,
        confidence: item.confidence,
        requiresReview: item.requiresReview,
        category: matched ? matched.name : SIN_CLASIFICAR,
        categoryId: matched ? matched.id : null
      };
    })
    .filter((item) => item.name.length >= 2);
}