import { describe, expect, it } from "vitest";
import { sanitizeDishResult, type DishAIResult } from "../../src/core/ia/DishAI";
import {
  buildDishDraft,
  formatDishQuantity,
  matchIngredient,
  planRecipeRow,
  storedUnitFor
} from "../../src/presentation/components/inventory/dishDraft";

const insumos = [
  { id: "p-carne", name: "Carne molida", unit: "kg" },
  { id: "p-pan", name: "Pan de hamburguesa", unit: "unidad" },
  { id: "p-queso", name: "Queso cheddar lonchas", unit: "unidad" },
  { id: "p-huevo", name: "Huevos", unit: "unidad" },
  { id: "p-leche", name: "Leche", unit: "litro" }
];

const categories = [
  { id: "c-ham", name: "Hamburguesas" },
  { id: "c-beb", name: "Bebidas" }
];

describe("VIMDY IA · matchIngredient", () => {
  it("encuentra el insumo ignorando tildes, mayúsculas y plurales", () => {
    expect(matchIngredient("carne MOLIDA", insumos)?.productId).toBe("p-carne");
    expect(matchIngredient("Huevo", insumos)?.productId).toBe("p-huevo");
  });

  it("une 'queso cheddar' con 'Queso cheddar lonchas' (uno contiene al otro)", () => {
    expect(matchIngredient("Queso cheddar", insumos)?.productId).toBe("p-queso");
  });

  it("devuelve null si el insumo no existe todavía (nunca inventa un match)", () => {
    expect(matchIngredient("Tocineta", insumos)).toBeNull();
    expect(matchIngredient("Queso mozzarella", insumos)).toBeNull();
    expect(matchIngredient("", insumos)).toBeNull();
  });

  it("prefiere el nombre más parecido cuando hay varios candidatos", () => {
    const list = [
      { id: "a", name: "Queso", unit: "kg" },
      { id: "b", name: "Queso cheddar lonchas", unit: "unidad" }
    ];
    expect(matchIngredient("Queso", list)?.productId).toBe("a");
    expect(matchIngredient("Queso cheddar", list)?.productId).toBe("b");
  });
});

describe("VIMDY IA · buildDishDraft", () => {
  const ai: DishAIResult = {
    name: "Hamburguesa Especial",
    category: "hamburguesas",
    suggestedCategory: null,
    station: "Parrilla",
    price: 22000,
    ingredients: [
      { name: "Carne molida", quantity: 150, unit: "g", estimated: false },
      { name: "Pan", quantity: 1, unit: "unidad", estimated: true },
      { name: "Tocineta", quantity: 30, unit: "g", estimated: true }
    ]
  };

  it("resuelve la categoría real y marca qué insumos ya existen", () => {
    const draft = buildDishDraft(ai, categories, insumos);
    expect(draft.categoryId).toBe("c-ham");
    expect(draft.suggestedCategory).toBeNull();
    expect(draft.price).toBe(22000);
    expect(draft.ingredients.map((i) => i.match?.productId ?? null)).toEqual(["p-carne", "p-pan", null]);
  });

  it("si la categoría no existe, no elige ninguna y deja la sugerencia", () => {
    const draft = buildDishDraft({ ...ai, category: null, suggestedCategory: "Parrilla" }, categories, insumos);
    expect(draft.categoryId).toBeNull();
    expect(draft.suggestedCategory).toBe("Parrilla");
  });
});

describe("VIMDY IA · planRecipeRow", () => {
  it("150 g contra un insumo en kg: conserva 150 y la unidad g (el formulario convierte)", () => {
    expect(planRecipeRow({ quantity: 150, unit: "g" }, "kg")).toEqual({
      quantity: "150",
      unit: "g",
      needsManualQuantity: false
    });
  });

  it("misma unidad: no guarda unidad aparte", () => {
    expect(planRecipeRow({ quantity: 1, unit: "unidad" }, "unidad")).toEqual({
      quantity: "1",
      unit: "",
      needsManualQuantity: false
    });
  });

  it("unidades incompatibles (unidad vs kg): deja la cantidad vacía en vez de adivinar", () => {
    expect(planRecipeRow({ quantity: 1, unit: "unidad" }, "kg")).toEqual({
      quantity: "",
      unit: "",
      needsManualQuantity: true
    });
    expect(planRecipeRow({ quantity: 100, unit: "g" }, "litro").needsManualQuantity).toBe(true);
  });
});

describe("VIMDY IA · unidades y formato", () => {
  it("storedUnitFor guarda los insumos nuevos en la unidad de compra habitual", () => {
    expect(storedUnitFor("g")).toBe("kg");
    expect(storedUnitFor("ml")).toBe("litro");
    expect(storedUnitFor("libra")).toBe("libra");
    expect(storedUnitFor("unidad")).toBe("unidad");
  });

  it("formatDishQuantity", () => {
    expect(formatDishQuantity(150, "g")).toBe("150 g");
    expect(formatDishQuantity(0.5, "libra")).toBe("0,5 lb");
    expect(formatDishQuantity(1, "unidad")).toBe("1 und");
  });
});

describe("VIMDY IA · sanitizeDishResult (no se confía en la respuesta)", () => {
  it("descarta ingredientes inválidos y normaliza el precio", () => {
    const result = sanitizeDishResult({
      name: "  Hamburguesa  ",
      category: "",
      suggestedCategory: "Hamburguesas",
      station: null,
      price: 21999.6,
      ingredients: [
        { name: "Carne", quantity: 150, unit: "g", estimated: false },
        { name: "Sin cantidad", quantity: 0, unit: "g" },
        { name: "Unidad rara", quantity: 2, unit: "tazas" },
        { name: "", quantity: 1, unit: "unidad" },
        null
      ]
    });
    expect(result.name).toBe("Hamburguesa");
    expect(result.category).toBeNull();
    expect(result.suggestedCategory).toBe("Hamburguesas");
    expect(result.price).toBe(22000);
    expect(result.ingredients).toEqual([{ name: "Carne", quantity: 150, unit: "g", estimated: false }]);
  });

  it("respuesta vacía o basura no rompe nada", () => {
    expect(sanitizeDishResult(null)).toEqual({
      name: "",
      category: null,
      suggestedCategory: null,
      station: null,
      price: null,
      ingredients: []
    });
    expect(sanitizeDishResult({ price: -5, ingredients: "x" }).price).toBeNull();
  });
});