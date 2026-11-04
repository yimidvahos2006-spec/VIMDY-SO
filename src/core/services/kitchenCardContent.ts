/* ===========================================================================
   kitchenCardContent
   ---------------------------------------------------------------------------
   Lógica pura (sin React) del contenido de la tarjeta de Cocina:

   1. splitOrigin: separa "Mesa 5" en etiqueta ("MESA") y valor ("5") para
      pintar la mesa en grande. Cualquier otro origen ("Mostrador",
      "Domicilio") se muestra completo como valor, sin etiqueta.

   2. classifyKitchenNote: decide cómo se resalta una nota libre. NO inventa
      datos: el modelo no tiene un campo de alergias, solo la nota libre del
      cajero/mesero (SaleItem.note / Sale.notes). Solo cambia el ESTILO del
      recuadro según lo que el propio texto dice:
        - "allergy":     menciona alergia / alérgico / celíaco / intolerancia
        - "restriction": pide quitar algo ("sin cebolla", "no picante")
        - "info":        cualquier otra nota ("para llevar", "bien cocido")
=========================================================================== */

export interface SplitOrigin {
  /** Prefijo en mayúsculas (ej. "MESA"). undefined si el origen no es una mesa. */
  label?: string;
  /** Lo que se pinta en grande (ej. "5", o "Mostrador"). */
  value: string;
}

const TABLE_ORIGIN_RE = /^(mesa)\s+(.+)$/i;

export function splitOrigin(origin: string | undefined, fallback: string): SplitOrigin {
  const text = origin?.trim();
  if (!text) return { value: fallback };

  const match = TABLE_ORIGIN_RE.exec(text);
  if (match) {
    return { label: match[1].toUpperCase(), value: match[2] };
  }

  return { value: text };
}

export type KitchenNoteSeverity = "allergy" | "restriction" | "info";

/** Minúsculas y sin tildes, para que "ALÉRGICO" y "alergico" se traten igual. */
function normalize(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();
}

const ALLERGY_RE = /\b(alergi\w*|alergic\w*|celiac\w*|intoleran\w*|anafila\w*)/;
const RESTRICTION_RE = /(^|\s)(sin|no)\s+\S+/;

export function classifyKitchenNote(note: string): KitchenNoteSeverity {
  const text = normalize(note);
  if (ALLERGY_RE.test(text)) return "allergy";
  if (RESTRICTION_RE.test(text)) return "restriction";
  return "info";
}