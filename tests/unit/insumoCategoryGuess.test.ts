// tests/unit/insumoCategoryGuess.test.ts
/* ===========================================================================
   PRUEBAS — Autocategorización de insumos por nombre
   ---------------------------------------------------------------------------
   Lógica pura (sin React ni red): dado el nombre que escribe el dueño,
   propone una categoría; y la reconoce entre las que el negocio ya tiene
   para no duplicar "Carnes" si ya existía "Carne".
=========================================================================== */

import { describe, expect, it } from "vitest";

import {
  findExistingCategoryForRule,
  guessInsumoCategory,
  INSUMO_CATEGORY_RULES,
  normalizeInsumoText
} from "../../src/core/utils/insumoCategoryGuess";

const guess = (name: string) => guessInsumoCategory(name)?.name ?? null;

describe("guessInsumoCategory", () => {
  it("reconoce las categorías básicas del negocio de comida", () => {
    expect(guess("Carne molida")).toBe("Carnes");
    expect(guess("Pechuga de pollo")).toBe("Carnes");
    expect(guess("Tomate")).toBe("Verduras");
    expect(guess("Cebolla cabezona")).toBe("Verduras");
    expect(guess("Leche entera")).toBe("Lácteos");
    expect(guess("Queso mozzarella")).toBe("Lácteos");
    expect(guess("Huevos")).toBe("Lácteos");
    expect(guess("Vasos 12oz")).toBe("Empaques");
    expect(guess("Bolsas")).toBe("Empaques");
    expect(guess("Limón")).toBe("Frutas");
    expect(guess("Plátano")).toBe("Verduras");
    expect(guess("Banano")).toBe("Frutas");
    expect(guess("Harina de trigo")).toBe("Despensa");
    expect(guess("Arroz")).toBe("Despensa");
    expect(guess("Gaseosa")).toBe("Bebidas");
    expect(guess("Cloro")).toBe("Aseo");
  });

  it("ignora mayúsculas, tildes y espacios de más", () => {
    expect(guess("  PIÑA  ")).toBe("Frutas");
    expect(guess("MANTEQUILLA")).toBe("Lácteos");
    expect(guess("jamón")).toBe("Carnes");
  });

  it("tolera plurales simples", () => {
    expect(guess("Tomates")).toBe("Verduras");
    expect(guess("Cebollas")).toBe("Verduras");
    expect(guess("Servilletas")).toBe("Empaques");
  });

  it("gana la palabra que aparece primero en el nombre", () => {
    expect(guess("Salsa de tomate")).toBe("Salsas y condimentos");
    expect(guess("Bolsa de papa")).toBe("Empaques");
    expect(guess("Jugo de naranja")).toBe("Bebidas");
    expect(guess("Queso crema")).toBe("Lácteos");
    expect(guess("Caja de pollo")).toBe("Empaques");
  });

  it("no confunde palabras que solo contienen otra", () => {
    // "sal" no debe activarse dentro de "salchicha" ni "salsa".
    expect(guess("Salchicha")).toBe("Carnes");
    expect(guess("Sal")).toBe("Salsas y condimentos");
    // "pan" no debe activarse dentro de "panela" (que es otra cosa en la lista).
    expect(guess("Panela")).toBe("Despensa");
  });

  it("devuelve null cuando no hay señal clara", () => {
    expect(guessInsumoCategory("")).toBeNull();
    expect(guessInsumoCategory("a")).toBeNull();
    expect(guessInsumoCategory("Producto raro XYZ")).toBeNull();
  });
});

describe("findExistingCategoryForRule", () => {
  const carnes = INSUMO_CATEGORY_RULES.find((r) => r.name === "Carnes")!;
  const lacteos = INSUMO_CATEGORY_RULES.find((r) => r.name === "Lácteos")!;

  it("reutiliza la categoría que el negocio ya tiene por nombre exacto", () => {
    const cats = [{ name: "Verduras" }, { name: "Carnes" }];
    expect(findExistingCategoryForRule(carnes, cats)).toBe(cats[1]);
  });

  it("la reconoce por alias y sin tildes ni mayúsculas", () => {
    const cats = [{ name: "CARNE" }, { name: "lacteos" }];
    expect(findExistingCategoryForRule(carnes, cats)).toBe(cats[0]);
    expect(findExistingCategoryForRule(lacteos, cats)).toBe(cats[1]);
  });

  it("devuelve undefined si el negocio no tiene esa categoría", () => {
    expect(findExistingCategoryForRule(carnes, [{ name: "Verduras" }])).toBeUndefined();
  });
});

describe("normalizeInsumoText", () => {
  it("quita tildes, símbolos y espacios repetidos", () => {
    expect(normalizeInsumoText("  Piña   Colada (1kg) ")).toBe("pina colada 1kg");
  });
});