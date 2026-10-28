// src/presentation/components/inventory/restockValidation.ts
/* ===========================================================================
   Validación pura de la cantidad a sumar (sin React → fácil de testear).
   Reglas:
     · Solo dígitos y UN separador decimal (coma o punto, ambos = decimal).
       En Colombia "." suele ser miles, pero aquí un campo de "unidades
       nuevas" nunca lleva miles: "1.500" se leería como 1,5. Por eso el
       modal muestra la vista previa del nuevo stock antes de confirmar.
     · Productos por "unidad" → solo enteros. Kg / litros / ml → hasta 3 decimales.
     · Mayor que 0 y con tope duro (MAX_RESTOCK_UNITS) contra typos de ceros.
=========================================================================== */

export const MAX_RESTOCK_UNITS = 100_000;
const MAX_DECIMALS = 3;
const INTEGER_UNITS = new Set(["", "unidad", "unidades", "und", "u"]);

export type RestockParse =
  | { status: "empty" }
  | { status: "invalid"; message: string }
  | { status: "valid"; quantity: number; unusuallyLarge: boolean };

/** ¿La unidad del producto admite decimales? (kg, litro, ml… sí; unidad no). */
export function allowsDecimals(unit?: string): boolean {
  return !INTEGER_UNITS.has((unit ?? "").trim().toLowerCase());
}

/** Limpia lo que escribe/pega el usuario. Nunca deja pasar letras, signos ni "e". */
export function sanitizeQuantityInput(raw: string, decimals: boolean): string {
  const cleaned = raw.replace(/[^\d.,]/g, "");
  if (!decimals) return cleaned.replace(/[.,]/g, "");

  const sepIndex = cleaned.search(/[.,]/);
  if (sepIndex === -1) return cleaned;

  const intPart = cleaned.slice(0, sepIndex);
  const decPart = cleaned
    .slice(sepIndex + 1)
    .replace(/[.,]/g, "")
    .slice(0, MAX_DECIMALS);
  return `${intPart},${decPart}`;
}

/**
 * @param currentStock stock REAL actual, o null si está enmascarado
 *        (conteo a ciegas): sin cifra real no se puede juzgar "inusual".
 */
export function parseRestockQuantity(
  input: string,
  currentStock: number | null
): RestockParse {
  const text = input.trim();
  if (text === "" || text === "," || text === ".") return { status: "empty" };

  const value = Number(text.replace(",", "."));
  if (!Number.isFinite(value)) {
    return { status: "invalid", message: "Escribe un número válido." };
  }

  const quantity = Math.round(value * 10 ** MAX_DECIMALS) / 10 ** MAX_DECIMALS;
  if (quantity <= 0) {
    return { status: "invalid", message: "La cantidad debe ser mayor que 0." };
  }
  if (quantity > MAX_RESTOCK_UNITS) {
    return {
      status: "invalid",
      message: `Máximo ${MAX_RESTOCK_UNITS.toLocaleString("es-CO")} por ingreso. ¿Sobran ceros?`
    };
  }

  const unusuallyLarge =
    currentStock !== null && quantity > Math.max(100, currentStock * 10);

  return { status: "valid", quantity, unusuallyLarge };
}