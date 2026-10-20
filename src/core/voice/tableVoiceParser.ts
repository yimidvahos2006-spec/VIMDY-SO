/**
 * Parser de comandos de voz para MESAS (módulo Meseros).
 *
 * Entiende frases como:
 *   "Mesa 3, 4 personas"      → mesa 3, 4 comensales
 *   "mesa tres para cuatro"   → mesa 3, 4 comensales
 *   "mesa 12 somos 6"         → mesa 12, 6 comensales
 *   "3 4"  (texto escrito)    → mesa 3, 4 comensales
 *   "mesa 7"                  → solo mesa (los comensales quedan por defecto)
 *
 * Es una función PURA (sin DOM ni React) para poder probarla fácil y
 * reutilizarla tanto con voz como con el texto escrito del fallback.
 */

export interface TableVoiceCommand {
  /** Número de mesa dicho por el mesero (ej. 3 para "Mesa 3"). */
  tableNumber: number | null;
  /** Cantidad de comensales, si se dijo. */
  peopleCount: number | null;
  /** Texto normalizado que se analizó (útil para mostrarlo en el aviso). */
  normalized: string;
}

const UNITS: Record<string, number> = {
  un: 1, uno: 1, una: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6,
  siete: 7, ocho: 8, nueve: 9, diez: 10, once: 11, doce: 12, trece: 13,
  catorce: 14, quince: 15, dieciseis: 16, diecisiete: 17, dieciocho: 18,
  diecinueve: 19, veinte: 20, veintiun: 21, veintiuno: 21, veintiuna: 21,
  veintidos: 22, veintitres: 23, veinticuatro: 24, veinticinco: 25,
  veintiseis: 26, veintisiete: 27, veintiocho: 28, veintinueve: 29
};

const TENS: Record<string, number> = {
  treinta: 30, cuarenta: 40, cincuenta: 50, sesenta: 60, setenta: 70,
  ochenta: 80, noventa: 90
};

/** Palabras que significan "comensales" y marcan el número que las precede. */
const PEOPLE_WORDS = new Set([
  "persona", "personas", "comensal", "comensales", "pax", "cliente",
  "clientes", "gente", "invitado", "invitados", "adulto", "adultos"
]);

/** Palabras que anuncian la cantidad de comensales: "para 4", "somos 4". */
const PEOPLE_LEAD_WORDS = new Set(["para", "somos", "son", "seremos", "con"]);

/** "meza" es el error más común del reconocedor de voz al oír "mesa". */
const TABLE_WORDS = new Set(["mesa", "mesas", "mesita", "meza", "mezas"]);

/** Relleno permitido entre "mesa" y el número: "mesa número 3". */
const TABLE_FILLER_WORDS = new Set(["numero", "nro", "no", "n"]);

/**
 * Modo estricto (voz): una frase más larga que esto es una conversación
 * ambiente, no una orden. "Mesa 3, 4 personas" son solo 4 piezas.
 */
const STRICT_MAX_TOKENS = 8;

function stripAccents(text: string): string {
  return text.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

function normalize(text: string): string {
  return stripAccents(text.toLowerCase())
    .replace(/[,.;:!?¿¡"'()]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

type Token =
  | { kind: "num"; value: number }
  | { kind: "word"; value: string };

/**
 * Convierte la frase en tokens, uniendo números hablados:
 * "treinta y cinco" → 35, "veintiuno" → 21, "3" → 3.
 */
function tokenize(normalized: string): Token[] {
  const words = normalized.split(" ").filter(Boolean);
  const tokens: Token[] = [];

  for (let i = 0; i < words.length; i++) {
    const word = words[i];

    if (/^\d+$/.test(word)) {
      tokens.push({ kind: "num", value: Number(word) });
      continue;
    }

    if (word in TENS) {
      let value = TENS[word];
      // "treinta y cinco" — consume "y" + unidad (solo 1-9)
      if (words[i + 1] === "y" && words[i + 2] in UNITS && UNITS[words[i + 2]] < 10) {
        value += UNITS[words[i + 2]];
        i += 2;
      }
      tokens.push({ kind: "num", value });
      continue;
    }

    if (word in UNITS) {
      tokens.push({ kind: "num", value: UNITS[word] });
      continue;
    }

    tokens.push({ kind: "word", value: word });
  }

  return tokens;
}

/** Límites sensatos: evita que un "ruido" produzca mesa 4000 o 900 personas. */
const MAX_TABLE_NUMBER = 999;
const MAX_PEOPLE = 99;

export interface ParseTableOptions {
  /**
   * Filtro estricto para la VOZ: solo cuenta si se dijo la palabra "mesa"
   * seguida de un número, en una frase corta. Todo lo demás (ruido, charla
   * de fondo, precios, números sueltos) se ignora. El texto ESCRITO por el
   * mesero no usa este modo: "3 4" sigue valiendo.
   */
  strict?: boolean;
}

export function parseTableCommand(text: string, options: ParseTableOptions = {}): TableVoiceCommand {
  const normalized = normalize(text);
  const tokens = tokenize(normalized);
  const strict = options.strict === true;

  if (strict && tokens.length > STRICT_MAX_TOKENS) {
    return { tableNumber: null, peopleCount: null, normalized };
  }

  let tableNumber: number | null = null;
  let peopleCount: number | null = null;

  // 1) "mesa N" → N es la mesa.
  for (let i = 0; i < tokens.length - 1; i++) {
    const t = tokens[i];
    if (t.kind !== "word" || !TABLE_WORDS.has(t.value)) continue;

    let next = tokens[i + 1];
    if (next.kind === "word" && TABLE_FILLER_WORDS.has(next.value) && i + 2 < tokens.length) {
      next = tokens[i + 2];
    }
    if (next.kind === "num") {
      tableNumber = next.value;
      break;
    }
  }

  // Estricto: sin "mesa + número" no hay orden, y no se adivina nada más.
  if (strict && tableNumber === null) {
    return { tableNumber: null, peopleCount: null, normalized };
  }

  // 2) "N personas" → N son los comensales.
  for (let i = 1; i < tokens.length; i++) {
    const t = tokens[i];
    const prev = tokens[i - 1];
    if (t.kind === "word" && PEOPLE_WORDS.has(t.value) && prev.kind === "num") {
      peopleCount = prev.value;
      break;
    }
  }

  // 3) "para N" / "somos N" / "con N" → N son los comensales.
  if (peopleCount === null) {
    for (let i = 0; i < tokens.length - 1; i++) {
      const t = tokens[i];
      const next = tokens[i + 1];
      if (t.kind === "word" && PEOPLE_LEAD_WORDS.has(t.value) && next.kind === "num") {
        // No tomar como comensales el número que ya quedó como mesa.
        if (!(tableNumber !== null && next.value === tableNumber && !hasSecondNumber(tokens))) {
          peopleCount = next.value;
          break;
        }
      }
    }
  }

  // 4) Sin palabras clave: los números sueltos van en orden → mesa, personas.
  //    Cubre "3 4" escrito rápido o un reconocimiento que omitió "mesa".
  const loose = tokens
    .filter((t): t is { kind: "num"; value: number } => t.kind === "num")
    .map(t => t.value);

  if (!strict && tableNumber === null && loose.length > 0) {
    // Si ya sabemos los comensales, la mesa es el primer número distinto de ellos.
    tableNumber = loose[0];
    if (peopleCount !== null && loose.length > 1 && loose[0] === peopleCount) {
      tableNumber = loose[1];
    }
  }

  if (!strict && peopleCount === null && loose.length > 1 && tableNumber !== null) {
    const rest = removeFirst(loose, tableNumber);
    if (rest.length > 0) peopleCount = rest[0];
  }

  if (tableNumber !== null && (tableNumber < 1 || tableNumber > MAX_TABLE_NUMBER)) {
    tableNumber = null;
  }
  if (peopleCount !== null && (peopleCount < 1 || peopleCount > MAX_PEOPLE)) {
    peopleCount = null;
  }

  return { tableNumber, peopleCount, normalized };
}

function hasSecondNumber(tokens: Token[]): boolean {
  return tokens.filter(t => t.kind === "num").length > 1;
}

function removeFirst(list: number[], value: number): number[] {
  const index = list.indexOf(value);
  if (index === -1) return list;
  return [...list.slice(0, index), ...list.slice(index + 1)];
}