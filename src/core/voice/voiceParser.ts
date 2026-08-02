export interface VoiceOrder {

  quantity: number;

  product: string;

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

    const words = part.trim().split(" ");

    let quantity = 1;

    if (!isNaN(Number(words[0]))) {

      quantity = Number(words.shift());

    }

    else if (numbers[words[0]] !== undefined) {

      quantity = numbers[words[0]];

      words.shift();

    }

    result.push({

      quantity,

      product: words.join(" ").trim()

    });

  }

  return result;

}