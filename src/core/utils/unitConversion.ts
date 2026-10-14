/**
 * Conversión de unidades para recetas.
 *
 * Problema que resuelve: la harina se compra y se guarda en kg, pero la
 * receta usa 120 g. Antes había que escribir 0,12 a mano; ahora la persona
 * escribe 120 y elige "g", y VIMDY convierte a la unidad del ingrediente.
 *
 * Solo se convierten unidades de la MISMA familia:
 *  - masa:    g, kg, libra (1 libra = 500 g, como se usa en Colombia)
 *  - volumen: ml, litro
 * Masa <-> volumen NUNCA se convierte (necesitaría la densidad del
 * ingrediente). Cualquier otra unidad (unidad, paquete, caja...) solo
 * coincide con ella misma.
 */

const MASS_IN_GRAMS: Record<string, number> = { g: 1, kg: 1000, libra: 500 };
const VOLUME_IN_ML: Record<string, number> = { ml: 1, litro: 1000 };

const ALIASES: Record<string, string> = {
  gr: "g", gramo: "g", gramos: "g",
  kgs: "kg", kilo: "kg", kilos: "kg", kilogramo: "kg", kilogramos: "kg",
  lb: "libra", lbs: "libra", libras: "libra",
  l: "litro", lt: "litro", lts: "litro", litros: "litro",
  mililitro: "ml", mililitros: "ml",
  unidades: "unidad", und: "unidad", u: "unidad"
};

export function normalizeUnit(unit: string | undefined | null): string {
  const text = String(unit ?? "").trim().toLowerCase();
  if (!text) return "unidad";
  return ALIASES[text] ?? text;
}

function family(unit: string): "masa" | "volumen" | null {
  if (unit in MASS_IN_GRAMS) return "masa";
  if (unit in VOLUME_IN_ML) return "volumen";
  return null;
}

/** Unidades que se pueden elegir en una receta para un ingrediente guardado en `ingredientUnit`. */
export function compatibleUnits(ingredientUnit: string | undefined | null): string[] {
  const unit = normalizeUnit(ingredientUnit);
  const fam = family(unit);
  if (fam === "masa") return ["g", "kg", "libra"];
  if (fam === "volumen") return ["ml", "litro"];
  return [unit];
}

/**
 * Convierte `quantity` de la unidad `from` a la unidad `to`.
 * Devuelve null si las unidades no son compatibles o la cantidad no es válida.
 */
export function convertQuantity(
  quantity: number,
  from: string | undefined | null,
  to: string | undefined | null
): number | null {
  if (!Number.isFinite(quantity)) return null;
  const a = normalizeUnit(from);
  const b = normalizeUnit(to);
  if (a === b) return quantity;

  const famA = family(a);
  if (!famA || famA !== family(b)) return null;

  const table = famA === "masa" ? MASS_IN_GRAMS : VOLUME_IN_ML;
  const result = (quantity * table[a]) / table[b];
  // Evita arrastrar basura de punto flotante (0.12000000000000001).
  return Math.round(result * 1e9) / 1e9;
}