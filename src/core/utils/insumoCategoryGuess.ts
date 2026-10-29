// src/core/utils/insumoCategoryGuess.ts
//
// Autocategorización de insumos: a partir del nombre que escribe el dueño
// ("Carne molida", "Leche entera", "Vasos 12oz") propone una categoría lógica
// para que no tenga que elegirla. Sin React, sin red, sin IA externa: es una
// tabla de palabras propia de VIMDY, fácil de ampliar.

import type { Category } from "../entities/Entities";

export interface InsumoCategoryRule {
  /** Nombre con el que se crea la categoría si el negocio todavía no la tiene. */
  readonly name: string;
  /** Otros nombres que un negocio pudo haber usado para lo mismo (se comparan sin tildes). */
  readonly aliases: readonly string[];
  /** Palabras (sin tildes, en minúscula) que delatan esta categoría. */
  readonly keywords: readonly string[];
}

/**
 * El orden importa solo como desempate: gana la palabra que aparece PRIMERO en
 * el nombre ("salsa de tomate" → Salsas, "bolsa de papa" → Empaques,
 * "jugo de naranja" → Bebidas). Si dos reglas empatan en posición, gana la de arriba.
 */
export const INSUMO_CATEGORY_RULES: readonly InsumoCategoryRule[] = [
  {
    name: "Empaques",
    aliases: ["empaque", "desechables", "empaques y desechables", "envases"],
    keywords: [
      "bolsa", "vaso", "tapa", "caja", "empaque", "envase", "servilleta", "pitillo", "pajilla",
      "cubierto", "tenedor", "cuchara", "plato", "contenedor", "icopor", "domo", "papel", "aluminio",
      "vinipel", "film", "etiqueta", "bandeja", "termo", "recipiente", "palillo"
    ]
  },
  {
    name: "Aseo",
    aliases: ["limpieza", "aseo y limpieza"],
    keywords: [
      "detergente", "jabon", "cloro", "desinfectante", "esponja", "trapero", "escoba", "limpiador",
      "desengrasante", "guante", "tapabocas", "fabuloso", "límpido", "limpido"
    ]
  },
  {
    name: "Salsas y condimentos",
    aliases: ["condimentos", "salsas", "especias", "aderezos"],
    keywords: [
      "salsa", "aderezo", "mayonesa", "ketchup", "catsup", "mostaza", "vinagre", "comino", "pimienta",
      "oregano", "sazon", "condimento", "especia", "paprika", "curcuma", "canela", "laurel", "ajinomoto",
      "sal", "tomillo", "romero", "chimichurri", "tartara", "bbq", "picante", "aji", "sofrito", "caldo", "consome"
    ]
  },
  {
    name: "Bebidas",
    aliases: ["bebida", "gaseosas", "licores"],
    keywords: [
      "gaseosa", "jugo", "agua", "cerveza", "ron", "aguardiente", "whisky", "vino", "tequila", "vodka",
      "refresco", "energizante", "soda", "te", "cafe", "bebida", "hatsu", "limonada", "malta"
    ]
  },
  {
    name: "Carnes",
    aliases: ["carne", "carnes y pollo", "proteinas", "carnes y embutidos", "pollo y carnes", "pescados"],
    keywords: [
      "carne", "res", "cerdo", "pollo", "pechuga", "muslo", "alas", "costilla", "chorizo", "salchicha",
      "jamon", "tocino", "bacon", "tocineta", "morcilla", "chicharron", "lomo", "solomo", "punta", "chuleta",
      "hamburguesa", "pescado", "salmon", "trucha", "tilapia", "mojarra", "atun", "camaron", "calamar",
      "mariscos", "langostino", "pernil", "higado", "viscera", "mortadela", "salchichon", "butifarra", "bondiola"
    ]
  },
  {
    name: "Lácteos",
    aliases: ["lacteos", "lacteos y huevos", "huevos", "lacteos y derivados"],
    keywords: [
      "leche", "queso", "crema", "mantequilla", "yogur", "yogurt", "kumis", "huevo", "cuajada",
      "mozzarella", "mozarella", "parmesano", "cheddar", "requeson", "suero", "arequipe", "margarina", "nata"
    ]
  },
  {
    name: "Frutas",
    aliases: ["fruta", "frutas y verduras"],
    keywords: [
      "fruta", "limon", "naranja", "mandarina", "mora", "fresa", "mango", "maracuya", "lulo", "banano",
      "manzana", "pera", "uva", "piña", "pina", "papaya", "sandia", "melon", "guanabana",
      "durazno", "coco", "aguacate", "tomate de arbol", "granadilla", "guayaba", "kiwi", "cereza", "arandano"
    ]
  },
  {
    name: "Verduras",
    aliases: ["verdura", "vegetales", "hortalizas", "frutas y verduras", "verduras y frutas"],
    keywords: [
      "verdura", "tomate", "cebolla", "ajo", "papa", "yuca", "zanahoria", "lechuga", "repollo", "pepino",
      "pimenton", "cilantro", "perejil", "espinaca", "brocoli", "coliflor", "champinon", "apio", "remolacha",
      "calabacin", "zucchini", "berenjena", "habichuela", "arveja", "maiz", "mazorca", "ahuyama", "auyama",
      "platano", "cebollin", "cebolla larga", "rucula", "albahaca", "jengibre", "ñame", "name", "pepino", "rabano", "jalapeño", "jalapeno"
    ]
  },
  {
    name: "Despensa",
    aliases: ["granos", "granos y harinas", "abarrotes", "secos", "harinas"],
    keywords: [
      "harina", "arroz", "azucar", "aceite", "pasta", "espagueti", "fideo", "frijol", "lenteja", "garbanzo",
      "avena", "panela", "pan", "tortilla", "masa", "maizena", "levadura", "polvo de hornear", "chocolate",
      "cacao", "miel", "galleta", "cereal", "nuez", "mani", "almendra", "grasa", "manteca", "bicarbonato",
      "gelatina", "esencia", "vainilla", "mermelada", "conserva", "lata", "nachos", "tostada"
    ]
  }
];

/** Minúsculas, sin tildes ni símbolos: "Piña Colada 1kg" → "pina colada 1kg". */
export function normalizeInsumoText(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9ñ\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Posición (en caracteres) donde `keyword` aparece como palabra completa en
 * `text`, tolerando plural simple ("vasos", "huevos", "tomates", "cebollas").
 * -1 si no aparece. "sal" NO coincide con "salsa" ni "salchicha".
 */
function keywordPosition(text: string, keyword: string): number {
  const key = normalizeInsumoText(keyword);
  if (!key) return -1;
  const pattern = new RegExp(`(^|\\s)${escapeRegExp(key)}(es|s)?(?=\\s|$)`);
  const match = pattern.exec(text);
  if (!match) return -1;
  return match.index + match[1].length;
}

/** Categoría sugerida para un nombre de insumo, o null si no hay señal clara. */
export function guessInsumoCategory(name: string): InsumoCategoryRule | null {
  const text = normalizeInsumoText(name);
  if (text.length < 2) return null;

  let best: { rule: InsumoCategoryRule; position: number } | null = null;
  for (const rule of INSUMO_CATEGORY_RULES) {
    for (const keyword of rule.keywords) {
      const position = keywordPosition(text, keyword);
      if (position < 0) continue;
      // Gana la palabra más a la izquierda; a igualdad, la regla que va primero.
      if (!best || position < best.position) best = { rule, position };
    }
  }
  return best?.rule ?? null;
}

/**
 * Busca, entre las categorías que el negocio YA tiene, la que corresponde a la
 * regla (por su nombre o por un alias). Así "Carnes" no se duplica si el
 * dueño ya tenía "Carne" o "Proteínas".
 */
export function findExistingCategoryForRule<T extends Pick<Category, "name">>(
  rule: InsumoCategoryRule,
  categories: readonly T[]
): T | undefined {
  const wanted = new Set([rule.name, ...rule.aliases].map(normalizeInsumoText));
  return categories.find((c) => wanted.has(normalizeInsumoText(c.name)));
}