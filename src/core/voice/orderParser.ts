/**
 * Parser de PEDIDOS por voz (Mesas y Caja).
 *
 * Convierte una frase dictada en líneas de pedido ya resueltas contra el
 * catálogo, por ejemplo:
 *
 *   "Mesa 3, dos cervezas águila light y una bandeja paisa sin arroz"
 *     → mesa 3
 *       · 2 × Cerveza Águila Light
 *       · 1 × Bandeja Paisa  (sin arroz)
 *
 * Es una función PURA (sin DOM ni React): el mismo código sirve para la voz,
 * para el texto escrito de corrección y para las pruebas automáticas.
 *
 * Decisiones de diseño (todas pensadas para un bar/restaurante con ruido):
 *  - El producto se busca por FRASES del catálogo (nombre y alias), no por
 *    cortes de texto. Así "arroz con pollo" o "papas a la francesa" no se
 *    rompen por contener "con" / "a la" / "y".
 *  - Tolera errores típicos del reconocedor: plurales, tildes, b/v, c/s/z,
 *    h muda y una letra de diferencia en palabras largas.
 *  - Nunca adivina en silencio: si varios productos encajan queda
 *    "ambiguous" (el mesero elige con un toque) y si no existe queda
 *    "not_found" (se avisa). Solo las líneas "matched" se agregan solas.
 *  - Cantidades enormes (ruido: "cincuenta") piden confirmación.
 */

import type { Product } from "../entities/Entities";

/** Campos mínimos del producto que el parser necesita (el resto viaja intacto). */
export type VoiceCatalogProduct = Pick<Product, "id" | "name" | "aliases" | "active" | "isIngredient">;

export type VoiceLineStatus = "matched" | "ambiguous" | "not_found";

export interface VoiceOrderLine<P extends VoiceCatalogProduct = Product> {
  quantity: number;
  /** Lo que se dijo para nombrar el producto (útil en avisos de "no encontré"). */
  spoken: string;
  status: VoiceLineStatus;
  /** Solo con status "matched". */
  product: P | null;
  /** Con status "ambiguous": opciones entre las que elegir (máx. 5). */
  candidates: P[];
  /** Exclusiones y notas para cocina: "sin arroz", "bien cocida", "para llevar". */
  notes: string[];
  /** Cantidad sospechosamente alta: no se agrega sin confirmación. */
  needsConfirm: boolean;
}

export interface ParsedVoiceOrder<P extends VoiceCatalogProduct = Product> {
  /** Mesa nombrada en la frase ("mesa 3"), o null. */
  tableNumber: number | null;
  lines: VoiceOrderLine<P>[];
  /** Palabras que no se pudieron explicar (para mostrarlas al mesero). */
  unparsed: string[];
  /** Frase normalizada, sin tildes ni signos. */
  normalized: string;
  /** Qué tan bien se explicó la frase; sirve para elegir entre alternativas del reconocedor. */
  score: number;
}

/** Más unidades que esto por línea se consideran ruido hasta que el mesero confirme. */
export const MAX_AUTO_QUANTITY = 20;

/* ------------------------------ normalización ------------------------------ */

function stripAccents(text: string): string {
  return text.normalize("NFD").replace(/[̀-ͯ]/g, "");
}

interface Tokens {
  /** Sin tildes: para comparar. */
  norm: string[];
  /** Con tildes (minúsculas): para mostrar en notas de cocina. */
  shown: string[];
}

function tokenize(text: string): Tokens {
  const prepared = text
    .toLowerCase()
    // "2x" / "x2" → "2" (suele dictarse "dos equis" pero también se escribe así).
    .replace(/(\d)\s*x(?![\p{L}\p{N}])/gu, "$1 ")
    .replace(/(?<![\p{L}\p{N}])x\s*(\d)/gu, "$1");
  const shown = prepared.split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  return { shown, norm: shown.map(stripAccents) };
}

/* -------------------------------- números ---------------------------------- */

const UNITS: Record<string, number> = {
  un: 1, uno: 1, una: 1, otro: 1, otra: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5,
  seis: 6, siete: 7, ocho: 8, nueve: 9, diez: 10, once: 11, doce: 12, trece: 13,
  catorce: 14, quince: 15, dieciseis: 16, diecisiete: 17, dieciocho: 18,
  diecinueve: 19, veinte: 20, veintiun: 21, veintiuno: 21, veintiuna: 21,
  veintidos: 22, veintitres: 23, veinticuatro: 24, veinticinco: 25,
  veintiseis: 26, veintisiete: 27, veintiocho: 28, veintinueve: 29
};

const TENS: Record<string, number> = {
  treinta: 30, cuarenta: 40, cincuenta: 50, sesenta: 60, setenta: 70,
  ochenta: 80, noventa: 90
};

function isNumberToken(token: string | undefined): boolean {
  return token !== undefined && (/^\d{1,3}$/.test(token) || token in UNITS || token in TENS);
}

/** Número hablado o en dígitos que empieza en `i`. "treinta y dos" → 32 (3 tokens). */
function numberAt(tokens: readonly string[], i: number): { value: number; len: number } | null {
  const token = tokens[i];
  if (token === undefined) return null;
  if (/^\d{1,3}$/.test(token)) return { value: Number(token), len: 1 };
  if (token in TENS) {
    const unit = tokens[i + 2];
    if (tokens[i + 1] === "y" && unit !== undefined && unit in UNITS && UNITS[unit] < 10) {
      return { value: TENS[token] + UNITS[unit], len: 3 };
    }
    return { value: TENS[token], len: 1 };
  }
  if (token in UNITS) return { value: UNITS[token], len: 1 };
  return null;
}

/** ¿Todo `span` es una expresión de cantidad? ("dos", "treinta y dos", "media docena de"…) */
function quantityExpression(span: readonly string[]): number | null {
  let words = span;
  if (words[words.length - 1] === "de") words = words.slice(0, -1);
  if (words.length === 0) return null;

  const joined = words.join(" ");
  if (joined === "media docena") return 6;
  if (joined === "docena" || joined === "una docena" || joined === "un docena") return 12;
  if (joined === "par" || joined === "un par") return 2;

  const n = numberAt(words, 0);
  return n && n.len === words.length ? n.value : null;
}

/** Cantidad que termina justo antes de `end`, sin invadir antes de `lowerBound`. */
function quantityBefore(
  norm: readonly string[],
  end: number,
  lowerBound: number
): { value: number; start: number } | null {
  for (let len = Math.min(5, end - lowerBound); len >= 1; len--) {
    const value = quantityExpression(norm.slice(end - len, end));
    if (value !== null) return { value, start: end - len };
  }
  return null;
}

/* ----------------------------- mesa en la frase ---------------------------- */

const TABLE_WORDS = new Set(["mesa", "mesas", "meza", "mezas", "mesita"]);
const TABLE_FILLERS = new Set(["numero", "nro", "no", "n", "la"]);

/** Quita "mesa N" (y "para la", "en la" que la preceden) y devuelve el número. */
function extractTable(tokens: Tokens): { tableNumber: number | null; rest: Tokens } {
  const { norm, shown } = tokens;

  for (let i = 0; i < norm.length; i++) {
    if (!TABLE_WORDS.has(norm[i])) continue;

    let j = i + 1;
    while (j < norm.length && j < i + 3 && TABLE_FILLERS.has(norm[j])) j++;
    const n = numberAt(norm, j);
    if (!n || n.value < 1 || n.value > 999) continue;

    let from = i;
    if ((norm[i - 1] === "la" || norm[i - 1] === "el") && ["para", "en", "de"].includes(norm[i - 2])) from = i - 2;
    else if (norm[i - 1] === "para" || norm[i - 1] === "en") from = i - 1;

    const to = j + n.len;
    return {
      tableNumber: n.value,
      rest: {
        norm: [...norm.slice(0, from), ...norm.slice(to)],
        shown: [...shown.slice(0, from), ...shown.slice(to)]
      }
    };
  }

  return { tableNumber: null, rest: tokens };
}

/* ------------------------- similitud tolerante a ASR ----------------------- */

/** Clave fonética española: b/v, c/s/z, qu/k, h muda, ll/y, letras dobles. */
function phonetic(word: string): string {
  return word
    .replace(/ll/g, "y")
    .replace(/qu/g, "k")
    .replace(/c(?=[aou])/g, "k")
    .replace(/c(?=[ei])/g, "s")
    .replace(/z/g, "s")
    .replace(/v/g, "b")
    .replace(/g(?=[ei])/g, "j")
    .replace(/h/g, "")
    .replace(/(.)\1+/g, "$1");
}

function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  const prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    let diagonal = prev[0];
    prev[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const above = prev[j];
      prev[j] = Math.min(prev[j] + 1, prev[j - 1] + 1, diagonal + (a[i - 1] === b[j - 1] ? 0 : 1));
      diagonal = above;
    }
  }
  return prev[b.length];
}

function isPlural(a: string, b: string): boolean {
  return a + "s" === b || b + "s" === a || a + "es" === b || b + "es" === a;
}

/** 0 = distintas; 1 = idénticas. */
function tokenSimilarity(a: string, b: string): number {
  if (a === b) return 1;
  if (isPlural(a, b)) return 0.97;

  const pa = phonetic(a);
  const pb = phonetic(b);
  if (pa === pb) return 0.92;
  if (isPlural(pa, pb)) return 0.9;

  // Una letra de diferencia solo en palabras largas: "cola" ≠ "coca".
  const shortest = Math.min(a.length, b.length);
  if (shortest >= 5) {
    const distance = levenshtein(pa, pb);
    if (distance === 1) return 0.8;
    if (distance === 2 && shortest >= 9) return 0.7;
  }
  return 0;
}

/* --------------------------------- catálogo -------------------------------- */

const STOPWORDS = new Set([
  "de", "del", "la", "el", "los", "las", "un", "una", "unos", "unas", "y", "e", "a", "al",
  "en", "con", "sin", "para", "por", "lo", "mi", "su", "o", "u"
]);

interface Phrase {
  tokens: string[];
  totalWeight: number;
  weights: number[];
}

interface CatalogEntry<P extends VoiceCatalogProduct> {
  product: P;
  phrases: Phrase[];
}

function buildPhrase(text: string): Phrase | null {
  const tokens = tokenize(text).norm;
  if (tokens.length === 0) return null;
  const weights = tokens.map(t => (STOPWORDS.has(t) ? 0.25 : 1));
  return { tokens, weights, totalWeight: weights.reduce((sum, w) => sum + w, 0) };
}

const indexCache = new WeakMap<readonly unknown[], CatalogEntry<VoiceCatalogProduct>[]>();

function getIndex<P extends VoiceCatalogProduct>(products: readonly P[]): CatalogEntry<P>[] {
  const cached = indexCache.get(products);
  if (cached) return cached as CatalogEntry<P>[];

  const entries: CatalogEntry<P>[] = [];
  for (const product of products) {
    // Solo se vende lo activo y que no sea un insumo.
    if (product.active === false || product.isIngredient === true) continue;
    const phrases = [product.name, ...(product.aliases ?? [])]
      .map(buildPhrase)
      .filter((p): p is Phrase => p !== null);
    if (phrases.length > 0) entries.push({ product, phrases });
  }

  indexCache.set(products, entries as CatalogEntry<VoiceCatalogProduct>[]);
  return entries;
}

/* ------------------------ búsqueda de productos en la frase ----------------- */

const MAX_WINDOW = 6;

/** Palabras de relleno al dar la orden: nunca abren ni cierran el nombre de un producto. */
const FILLER_WORDS = new Set([
  "tambien", "ademas", "luego", "despues", "entonces", "ya", "listo", "favor", "porfa",
  "porfavor", "gracias", "ponme", "ponga", "pon", "dame", "deme", "regalame", "regaleme",
  "traeme", "traigame", "quiero", "queremos", "necesito", "agregame", "anota", "anotame",
  "apunta", "mandame", "me", "nos", "que", "algo", "ah", "eh", "este", "pues", "oiga",
  "senor", "senora", "aca", "alli", "ahi",
  // Comensales ("mesa 3, 4 personas"): eso es de la apertura de mesa, no un producto.
  "persona", "personas", "comensal", "comensales", "pax", "gente", "adulto", "adultos",
  "cliente", "clientes", "invitado", "invitados", "somos", "seremos"
]);

interface Hit<P extends VoiceCatalogProduct> {
  entry: CatalogEntry<P>;
  /** Fracción (ponderada) del nombre del producto que se dijo: 1 = nombre completo. */
  coverage: number;
  quality: number;
}

interface Mention<P extends VoiceCatalogProduct> {
  start: number;
  end: number;
  hits: Hit<P>[];
}

function matchWindow(window: readonly string[], phrase: Phrase): { coverage: number; quality: number } | null {
  if (window.length > phrase.tokens.length) return null;

  const used: boolean[] = new Array(phrase.tokens.length).fill(false);
  let similaritySum = 0;
  let covered = 0;

  for (const word of window) {
    let bestIndex = -1;
    let bestScore = 0;
    for (let j = 0; j < phrase.tokens.length; j++) {
      if (used[j]) continue;
      const score = tokenSimilarity(word, phrase.tokens[j]);
      if (score > bestScore) {
        bestScore = score;
        bestIndex = j;
      }
    }
    if (bestIndex < 0) return null;
    used[bestIndex] = true;
    similaritySum += bestScore;
    covered += phrase.weights[bestIndex];
  }

  return { coverage: covered / phrase.totalWeight, quality: similaritySum / window.length };
}

function canEdgeWindow(token: string): boolean {
  return !STOPWORDS.has(token) && !FILLER_WORDS.has(token);
}

function findMentions<P extends VoiceCatalogProduct>(norm: readonly string[], index: CatalogEntry<P>[]): Mention<P>[] {
  const candidates: Mention<P>[] = [];

  for (let start = 0; start < norm.length; start++) {
    if (!canEdgeWindow(norm[start])) continue;

    for (let len = Math.min(MAX_WINDOW, norm.length - start); len >= 1; len--) {
      const last = norm[start + len - 1];
      if (!canEdgeWindow(last)) continue;
      // Un número suelto jamás es un producto ("dos" ≠ "Dos Equis").
      if (len === 1 && isNumberToken(last)) continue;

      const window = norm.slice(start, start + len);
      const hits: Hit<P>[] = [];

      for (const entry of index) {
        let best: { coverage: number; quality: number } | null = null;
        for (const phrase of entry.phrases) {
          const m = matchWindow(window, phrase);
          if (m && (!best || m.coverage > best.coverage || (m.coverage === best.coverage && m.quality > best.quality))) {
            best = m;
          }
        }
        if (best) hits.push({ entry, ...best });
      }

      if (hits.length > 0) {
        hits.sort((a, b) => b.coverage - a.coverage || b.quality - a.quality);
        candidates.push({ start, end: start + len, hits });
      }
    }
  }

  // Frases largas y bien dichas primero; después se descartan las que se traslapan.
  candidates.sort((a, b) => {
    const lenA = a.end - a.start;
    const lenB = b.end - b.start;
    return lenB - lenA || b.hits[0].quality - a.hits[0].quality || a.start - b.start;
  });

  const taken = new Array(norm.length).fill(false);
  const chosen: Mention<P>[] = [];
  for (const candidate of candidates) {
    let free = true;
    for (let i = candidate.start; i < candidate.end; i++) if (taken[i]) free = false;
    if (!free) continue;
    for (let i = candidate.start; i < candidate.end; i++) taken[i] = true;
    chosen.push(candidate);
  }

  return chosen.sort((a, b) => a.start - b.start);
}

/* ----------------------- modificadores / exclusiones ----------------------- */

/** Palabras que introducen un objeto: "sin ARROZ", "con LIMÓN", "extra QUESO". */
const NEGATIVE_LEADS = new Set(["sin", "ni"]);
const MODIFIER_LEADS = new Set(["extra", "doble", "poco", "poquito", "poca", "poquita", "mucho", "mucha", "bastante", "menos"]);
const ADJECTIVES = new Set([
  "frio", "fria", "helado", "helada", "caliente", "tibio", "tibia", "natural", "grande",
  "pequeno", "pequena", "mediano", "mediana", "personal", "familiar", "aparte", "dorado",
  "dorada", "crudo", "cruda", "quemado", "quemada"
]);
const FILLER_OBJECTS = new Set(["gusto", "permiso", "favor", "amor", "cariño", "carino", "eso", "esto", "nada", "todo"]);
const CONNECTORS = new Set(["y", "e", "ni"]);
const MAX_OBJECT_WORDS = 4;
const MAX_NOTES_PER_LINE = 6;

interface RegionResult {
  notes: string[];
  /** "dos pizzas hawaianas" dicho pero sin producto en el catálogo. */
  orphans: { quantity: number; spoken: string }[];
  leftover: string[];
}

function isLead(token: string): boolean {
  return (
    NEGATIVE_LEADS.has(token) ||
    MODIFIER_LEADS.has(token) ||
    token === "con" ||
    token === "bien" ||
    token === "termino" ||
    token === "al" ||
    token === "para" ||
    token === "pero"
  );
}

/** Interpreta los tokens [from, to) que siguen a un producto. */
function parseRegion(tokens: Tokens, from: number, to: number): RegionResult {
  const { norm, shown } = tokens;
  const result: RegionResult = { notes: [], orphans: [], leftover: [] };

  /** ¿En `i` empieza una cantidad seguida de otro producto ("y dos pizzas")? */
  const startsOrphan = (i: number): { quantity: number; len: number } | null => {
    const n = numberAt(norm, i);
    if (!n) return null;
    const next = norm[i + n.len];
    if (next === undefined || i + n.len >= to) return null;
    if (isNumberToken(next) || isLead(next) || STOPWORDS.has(next) || FILLER_WORDS.has(next) || ADJECTIVES.has(next)) {
      return null;
    }
    return { quantity: n.value, len: n.len };
  };

  /** Lee los objetos que siguen a un "sin"/"con"/"extra": "sin cebolla ni tomate". */
  const readObjects = (start: number): { objects: string[]; next: number } => {
    const objects: string[] = [];
    let current: string[] = [];
    let j = start;

    const flush = () => {
      while (current.length > 0 && (STOPWORDS.has(stripAccents(current[0])))) current.shift();
      const text = current.join(" ");
      if (text && !FILLER_OBJECTS.has(stripAccents(text))) objects.push(text);
      current = [];
    };

    while (j < to) {
      const token = norm[j];
      if (token === "y" || token === "e" || token === "ni") {
        flush();
        j++;
        continue;
      }
      if (token === "sin" || token === "con" || isLead(token) || startsOrphan(j) || FILLER_WORDS.has(token)) break;
      current.push(shown[j]);
      j++;
      if (current.length >= MAX_OBJECT_WORDS) break;
    }
    flush();
    return { objects, next: j };
  };

  let i = from;
  while (i < to) {
    const token = norm[i];

    const orphan = startsOrphan(i);
    if (orphan) {
      let j = i + orphan.len;
      const words: string[] = [];
      while (j < to && words.length < MAX_OBJECT_WORDS && !CONNECTORS.has(norm[j]) && !isLead(norm[j]) && !startsOrphan(j)) {
        words.push(shown[j]);
        j++;
      }
      result.orphans.push({ quantity: orphan.quantity, spoken: words.join(" ") });
      i = j;
      continue;
    }

    // Ojo: "sin", "con", "al", "para" también son stopwords; se evalúan ANTES de saltarlas.
    if (token === "para" && (norm[i + 1] === "llevar" || norm[i + 1] === "aqui")) {
      result.notes.push(`para ${shown[i + 1]}`);
      i += 2;
      continue;
    }

    if (NEGATIVE_LEADS.has(token)) {
      const { objects, next } = readObjects(i + 1);
      objects.forEach(o => result.notes.push(`sin ${o}`));
      i = Math.max(next, i + 1);
      continue;
    }

    if (token === "con") {
      const { objects, next } = readObjects(i + 1);
      objects.forEach(o => result.notes.push(`con ${o}`));
      i = Math.max(next, i + 1);
      continue;
    }

    if (MODIFIER_LEADS.has(token)) {
      const { objects, next } = readObjects(i + 1);
      objects.forEach(o => result.notes.push(`${shown[i]} ${o}`));
      i = Math.max(next, i + 1);
      continue;
    }

    if (token === "bien" && norm[i + 1] !== undefined && !isLead(norm[i + 1]) && !CONNECTORS.has(norm[i + 1])) {
      result.notes.push(`bien ${shown[i + 1]}`);
      i += 2;
      continue;
    }

    if (token === "termino" && norm[i + 1] !== undefined) {
      // "término tres cuartos" (la cantidad aquí NO es un pedido).
      if (isNumberToken(norm[i + 1]) && norm[i + 2] === "cuartos") {
        result.notes.push(`término ${shown[i + 1]} cuartos`);
        i += 3;
      } else {
        result.notes.push(`término ${shown[i + 1]}`);
        i += 2;
      }
      continue;
    }

    if (token === "al" && norm[i + 1] !== undefined) {
      result.notes.push(`al ${shown[i + 1]}`);
      i += 2;
      continue;
    }

    if (ADJECTIVES.has(token)) {
      result.notes.push(shown[i]);
      i++;
      continue;
    }

    if (CONNECTORS.has(token) || FILLER_WORDS.has(token) || STOPWORDS.has(token)) {
      i++;
      continue;
    }

    if (isNumberToken(token) && !startsOrphan(i)) {
      // Número suelto sin producto detrás (ruido): no es una nota.
      i++;
      continue;
    }

    result.leftover.push(shown[i]);
    i++;
  }

  result.notes = Array.from(new Set(result.notes)).slice(0, MAX_NOTES_PER_LINE);
  return result;
}

/* ------------------------------- parser final ------------------------------ */

/** Quien precede al producto y lo convierte en exclusión, no en un ítem: "sin ARROZ". */
const OBJECT_LEADS = new Set([...NEGATIVE_LEADS, ...MODIFIER_LEADS, "con"]);

const MAX_ALTERNATIVES = 5;

function uniqueProducts<P extends VoiceCatalogProduct>(hits: Hit<P>[]): P[] {
  const seen = new Set<string>();
  const products: P[] = [];
  for (const hit of hits) {
    if (seen.has(hit.entry.product.id)) continue;
    seen.add(hit.entry.product.id);
    products.push(hit.entry.product);
  }
  return products;
}

export function parseVoiceOrder<P extends VoiceCatalogProduct>(
  text: string,
  products: readonly P[]
): ParsedVoiceOrder<P> {
  const { tableNumber, rest } = extractTable(tokenize(text));
  const { norm } = rest;
  const index = getIndex(products);

  // 1) Productos nombrados. "sin ARROZ" no es un ítem: es una exclusión.
  const mentions = findMentions(norm, index).filter(m => {
    const before = norm[m.start - 1];
    return !(before !== undefined && OBJECT_LEADS.has(before));
  });

  const lines: { position: number; line: VoiceOrderLine<P> }[] = [];
  const unparsed: string[] = [];

  // 2) Cantidad de cada producto y su región de notas.
  interface Item {
    mention: Mention<P>;
    quantity: number;
    qtyStart: number;
  }
  const items: Item[] = [];
  let lowerBound = 0;
  for (const mention of mentions) {
    const q = quantityBefore(norm, mention.start, lowerBound);
    items.push({ mention, quantity: q?.value ?? 1, qtyStart: q ? q.start : mention.start });
    lowerBound = mention.end;
  }

  // Lo que se dijo antes del primer producto (p. ej. "y dos pizzas…" sin producto).
  const headEnd = items.length > 0 ? items[0].qtyStart : norm.length;
  const head = parseRegion(rest, 0, headEnd);
  head.orphans.forEach(o => lines.push({ position: 0, line: orphanLine<P>(o) }));
  unparsed.push(...head.leftover);

  items.forEach((item, k) => {
    const regionEnd = k + 1 < items.length ? items[k + 1].qtyStart : norm.length;
    const region = parseRegion(rest, item.mention.end, regionEnd);
    unparsed.push(...region.leftover);

    const { hits } = item.mention;
    const spoken = rest.shown.slice(item.mention.start, item.mention.end).join(" ");
    const exact = hits.filter(h => h.coverage >= 0.999);
    const exactProducts = uniqueProducts(exact);
    const allProducts = uniqueProducts(hits);

    let status: VoiceLineStatus;
    let product: P | null = null;
    let candidates: P[] = [];

    if (exactProducts.length === 1) {
      status = "matched";
      product = exactProducts[0];
    } else if (exactProducts.length > 1) {
      status = "ambiguous";
      candidates = exactProducts.slice(0, MAX_ALTERNATIVES);
    } else if (allProducts.length === 1) {
      // Nombre dicho a medias ("bandeja" por "Bandeja Paisa"). Si justo después
      // vienen palabras sin explicar ("pizza DE PEPPERONI"), es más seguro preguntar.
      if (region.leftover.length > 0) {
        status = "ambiguous";
        candidates = allProducts;
      } else {
        status = "matched";
        product = allProducts[0];
      }
    } else {
      status = "ambiguous";
      candidates = allProducts.slice(0, MAX_ALTERNATIVES);
    }

    lines.push({
      position: item.mention.start,
      line: {
        quantity: item.quantity,
        spoken,
        status,
        product,
        candidates,
        notes: region.notes,
        needsConfirm: item.quantity > MAX_AUTO_QUANTITY
      }
    });

    region.orphans.forEach(o => lines.push({ position: item.mention.end, line: orphanLine<P>(o) }));
  });

  lines.sort((a, b) => a.position - b.position);

  const ordered = lines.map(l => l.line);
  const matched = ordered.filter(l => l.status === "matched").length;
  const ambiguous = ordered.filter(l => l.status === "ambiguous").length;
  const notFound = ordered.filter(l => l.status === "not_found").length;
  const score = matched * 3 + ambiguous - notFound * 2 - unparsed.length * 0.3 + (tableNumber !== null ? 0.5 : 0);

  return { tableNumber, lines: ordered, unparsed, normalized: norm.join(" "), score };
}

function orphanLine<P extends VoiceCatalogProduct>(orphan: { quantity: number; spoken: string }): VoiceOrderLine<P> {
  return {
    quantity: orphan.quantity,
    spoken: orphan.spoken,
    status: "not_found",
    product: null,
    candidates: [],
    notes: [],
    needsConfirm: orphan.quantity > MAX_AUTO_QUANTITY
  };
}

/* --------------------------------- helpers --------------------------------- */

/** Nota lista para guardar en la línea del pedido: "sin arroz, para llevar". */
export function orderNoteText(line: Pick<VoiceOrderLine, "notes">): string | undefined {
  return line.notes.length > 0 ? line.notes.join(", ") : undefined;
}

/** "2 × Cerveza Águila Light (sin hielo)" — para avisos y confirmaciones. */
export function describeVoiceLine(line: VoiceOrderLine<VoiceCatalogProduct>): string {
  const name = line.product?.name ?? line.spoken;
  const note = orderNoteText(line);
  return `${line.quantity} × ${name}${note ? ` (${note})` : ""}`;
}

/** Elige, entre las alternativas del reconocedor, la que mejor se explica con el catálogo. */
export function pickBestParse<P extends VoiceCatalogProduct>(
  alternatives: readonly { transcript: string; confidence: number }[],
  products: readonly P[]
): { parsed: ParsedVoiceOrder<P>; transcript: string; confidence: number } | null {
  let best: { parsed: ParsedVoiceOrder<P>; transcript: string; confidence: number } | null = null;

  for (const alt of alternatives) {
    const parsed = parseVoiceOrder(alt.transcript, products);
    // Desempate por orden: la primera alternativa es la preferida del reconocedor.
    if (!best || parsed.score > best.parsed.score) {
      best = { parsed, transcript: alt.transcript, confidence: alt.confidence };
    }
  }
  return best;
}