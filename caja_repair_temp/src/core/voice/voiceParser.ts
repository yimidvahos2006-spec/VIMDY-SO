export interface VoiceOrder {

  quantity: number;

  product: string;

  /** Modificadores extraídos del pedido (ej: "sin arroz", "al punto"). */

  modifiers: string[];

}

const numbers: Record<string, number> = {

  "un": 1,
  "uno": 1,
  "una": 1,

  "dos": 2,

  "tres": 3,

  "cuatro": 4,

  "cinco": 5,

  "seis": 6,

  "siete": 7,

  "ocho": 8,

  "nueve": 9,

  "diez": 10

};

const MODIFIER_PREFIXES = [

  "sin",
  "sin.",
  "sin,",
  "no",
  "no.",
  "no,",
  "con",
  "con.",
  "con,",
  "al",
  "a",
  "poco",
  "mucho",
  "extra",
  "media",
  "medio",
  "mitad",
  "bien",
  "crudo",
  "término",
  "termino",
  "dorado",
  "quemado",
  "frío",
  "frio",
  "caliente",
  "helado"

];

function extractModifiers(words: string[]): { productWords: string[]; modifiers: string[] } {

  const modifiers: string[] = [];

  const productWords: string[] = [];

  let i = 0;

  while (i < words.length) {

    const word = words[i];

    const normalized = word.replace(/[.,]/g, "");

    if (MODIFIER_PREFIXES.includes(normalized) && i + 1 < words.length) {

      const next = words[i + 1];

      const nextClean = next.replace(/[.,]/g, "");

      if (nextClean && nextClean.length > 1) {

        modifiers.push(`${normalized} ${nextClean}`);

        i += 2;

        continue;

      }

    }

    productWords.push(word);

    i++;

  }

  return { productWords, modifiers };

}

function normalize(text: string) {

  return text
    .toLowerCase()
    .replace(/,/g, " ")
    .replace(/\./g, " ")
    .replace(/\s+/g, " ")
    .trim();

}

export function parseVoice(text: string): VoiceOrder[] {

  const result: VoiceOrder[] = [];

  const parts = normalize(text)

    .split(/\sy\s/);

  for (const part of parts) {

    const words = part.trim().split(" ").filter(Boolean);

    let quantity = 1;

    let productWords = words;

    if (words.length > 1) {

      const first = words[0].replace(/[.,]/g, "");

      if (!isNaN(Number(words[0]))) {

        quantity = Number(words.shift()!);

        productWords = words;

      } else if (numbers[first] !== undefined) {

        quantity = numbers[first];

        productWords = words.slice(1);

      }

    }

    const { productWords: cleanProduct, modifiers } = extractModifiers(productWords);

    result.push({

      quantity,

      product: cleanProduct.join(" ").trim(),

      modifiers

    });

  }

  return result;

}