import { createWorker } from "tesseract.js";

/**
 * VIMDY Smart Import — Paso 2.
 * ---------------------------------------------------------------------------
 * Lee el texto de una foto de menú (OCR real, vía tesseract.js, corriendo
 * en el navegador — no requiere backend ni API key) y lo convierte en una
 * lista de productos + precio candidata para que el usuario la revise y
 * corrija en pantalla.
 *
 * Es intencionalmente una heurística simple, no un modelo entrenado para
 * menús: asume que cada renglón del menú tiene el precio al final de la
 * línea (el formato más común: "Hamburguesa Premium ...... $35.000").
 * Los renglones que no calzan con ese patrón se ignoran — el usuario podrá
 * agregarlos a mano en la tabla de revisión.
 */

export interface MenuOcrItem {
  name: string;
  price: number;
}

/** Toma el precio al final del renglón: $18.000 / 18.000 / $18,000 / 18000 */
const PRICE_AT_END = /\$?\s*(\d{1,3}(?:[.,]\d{3})+|\d{4,7})\s*(?:cop|pesos)?\s*$/i;

export function parseMenuText(rawText: string): MenuOcrItem[] {
  const lines = rawText
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  const items: MenuOcrItem[] = [];

  for (const line of lines) {
    const match = line.match(PRICE_AT_END);
    if (!match || match.index === undefined) continue;

    const price = Number(match[1].replace(/[.,]/g, ""));
    // Descarta ruido (números de página, horas, cantidades sueltas, etc.)
    if (!price || price < 500) continue;

    const name = line
      .slice(0, match.index)
      .replace(/[-.\s]+$/, "")
      .trim();

    if (!name || name.length < 2) continue;

    items.push({ name, price });
  }

  return items;
}

/**
 * Corre el OCR sobre la imagen del menú (data URL) y devuelve los productos
 * candidatos. No crea nada en InventoryEngine: eso es el Paso 3.
 */
export async function readMenuImage(imageDataUrl: string): Promise<MenuOcrItem[]> {
  const worker = await createWorker("spa");

  try {
    const { data } = await worker.recognize(imageDataUrl);
    return parseMenuText(data.text);
  } finally {
    await worker.terminate();
  }
}