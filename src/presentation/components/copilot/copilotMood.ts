import type { CopilotOrbState } from "./CopilotOrb";

/** Reacciones que el orbe puede mostrar además de sus estados de trabajo. */
export type CopilotReaction = Extract<CopilotOrbState, "angry" | "wink" | "success" | "warning">;

/** Minúsculas, sin tildes y con espacios simples: así "INÚTIL" y "inutil" son lo mismo. */
function normalize(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Palabras como "marica" o "bruto" se usan de forma normal en Colombia ("utilidad
 * bruta"), por eso no están. Solo insultos claros, buscados como palabra completa.
 */
const INSULTS = [
  "hijueputa", "hijoeputa", "hijo de puta", "hijo de la gran puta", "gonorrea", "malparido",
  "malparida", "pendejo", "pendeja", "idiota", "estupido", "estupida", "imbecil", "inutil",
  "mierda", "puta", "puto", "carajo", "maldito", "maldita", "tonto", "tonta", "cabron",
  "fuck", "shit", "stupid", "idiot", "useless"
];

const PRAISE = [
  "felicitaciones", "felicidades", "buen trabajo", "buen trabajo", "bien hecho", "excelente",
  "genial", "eres el mejor", "eres la mejor", "eres un crack", "bravo", "me encanta", "gracias",
  "thank you", "great job", "well done"
];

const RECORD = /\brecord\b/;

function hasPhrase(normalized: string, phrase: string): boolean {
  const escaped = phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[^a-z0-9])${escaped}($|[^a-z0-9])`).test(normalized);
}

/** Insulto o grosería en lo que escribió el usuario. */
export function containsInsult(text: string): boolean {
  const n = normalize(text);
  return INSULTS.some((word) => hasPhrase(n, word));
}

/** Felicitación o agradecimiento, o mención de un récord. */
export function containsPraise(text: string): boolean {
  const n = normalize(text);
  return PRAISE.some((word) => hasPhrase(n, word)) || RECORD.test(n);
}

/** Reacción del orbe al mensaje del usuario. El enojo manda sobre el guiño. */
export function detectUserReaction(text: string): "angry" | "wink" | null {
  if (containsInsult(text)) return "angry";
  if (containsPraise(text)) return "wink";
  return null;
}

const WARNING_HINTS = [
  "🔴", "🟠", "alerta", "agotad", "stock bajo", "se esta acabando", "por acabarse", "pierdes",
  "perdida", "retrasad", "cayeron", "bajaron", "caja descuadrada", "diferencia"
];
const SUCCESS_HINTS = [
  "🟢", "meta cumplida", "superaste", "crecieron", "crecimiento", "subieron", "todo en orden",
  "buen dia", "excelente dia", "ganancia"
];

/**
 * Estado de negocio que se nota en la respuesta de la IA. Ella ya marca sus alertas con
 * 🔴 🟠 🟢; además se buscan palabras clave. Un récord de ventas devuelve "wink".
 * Lo urgente (alertas) pesa más que lo bueno cuando vienen las dos cosas.
 */
export function detectReplyReaction(reply: string): "wink" | "success" | "warning" | null {
  const n = normalize(reply);
  if (WARNING_HINTS.some((h) => n.includes(normalize(h)))) return "warning";
  if (/\brecord\b/.test(n) && /(venta|ventas|vendiste|ingreso)/.test(n)) return "wink";
  if (SUCCESS_HINTS.some((h) => n.includes(normalize(h)))) return "success";
  return null;
}