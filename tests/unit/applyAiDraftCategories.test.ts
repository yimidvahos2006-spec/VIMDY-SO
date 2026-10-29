// tests/unit/applyAiDraftCategories.test.ts
/* ===========================================================================
   PRUEBAS — VIMDY IA: categoría de los insumos nuevos que crea el borrador
   ---------------------------------------------------------------------------
   Prueba el applyAiDraft REAL (no una copia). La fábrica de insumos se
   reemplaza por una en memoria: no hay base de datos ni red.
=========================================================================== */

import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Category, Product } from "../../src/core/entities/Entities";

const store = vi.hoisted(() => ({
  categories: [] as Array<{ id: string; name: string; kind: string }>,
  insumos: [] as Array<{ id: string; name: string; categoryId: string; unit: string }>,
  rejectCategoryNames: [] as string[]
}));

vi.mock("../../src/presentation/components/inventory/product-form/insumoFactory", () => ({
  createInsumoCategory: async (name: string) => {
    if (store.rejectCategoryNames.includes(name)) return null;
    const created = { id: `cat-${store.categories.length + 1}`, name, kind: "INSUMO" };
    store.categories.push(created);
    return created;
  },
  createInsumo: async (input: { name: string; categoryId: string; unit: string }) => {
    const created = { id: `ins-${store.insumos.length + 1}`, ...input };
    store.insumos.push(created);
    return created;
  }
}));

import { applyAiDraft } from "../../src/presentation/components/inventory/product-form/applyAiDraft";
import type { DishDraft } from "../../src/presentation/components/inventory/dishDraft";

const cat = (id: string, name: string): Category =>
  ({ id, name, active: true, createdAt: new Date(), requiresKitchenByDefault: false, kind: "INSUMO" }) as Category;

function draftWith(...names: string[]): DishDraft {
  return {
    name: "Hamburguesa",
    price: 18000,
    categoryId: null,
    suggestedCategory: null,
    station: null,
    ingredients: names.map((name) => ({ name, quantity: 100, unit: "g" as const, estimated: false, match: null }))
  };
}

const categoryOf = (insumoName: string) =>
  store.insumos.find((i) => i.name === insumoName)?.categoryId;

beforeEach(() => {
  store.categories = [];
  store.insumos = [];
  store.rejectCategoryNames = [];
});

describe("applyAiDraft — categorías de insumos nuevos", () => {
  it("cada insumo va a la categoría que sugiere su nombre, no a la primera de la lista", async () => {
    const existing = [cat("c-aseo", "Aseo"), cat("c-carnes", "Carnes")];
    const result = await applyAiDraft(draftWith("Carne molida", "Tomate", "Queso"), [], existing, [] as Product[]);

    expect(categoryOf("Carne molida")).toBe("c-carnes"); // ya existía: se reutiliza
    expect(result.createdCategories.map((c) => c.name).sort()).toEqual(["Lácteos", "Verduras"]);
    const verduras = result.createdCategories.find((c) => c.name === "Verduras")!;
    expect(categoryOf("Tomate")).toBe(verduras.id);
    expect(categoryOf("Queso")).not.toBe("c-aseo"); // jamás la primera por defecto
  });

  it("no crea dos veces la misma categoría para varios insumos parecidos", async () => {
    const result = await applyAiDraft(draftWith("Tomate", "Cebolla", "Lechuga"), [], [], [] as Product[]);
    expect(result.createdCategories.map((c) => c.name)).toEqual(["Verduras"]);
    expect(store.categories).toHaveLength(1);
    const id = result.createdCategories[0].id;
    expect(["Tomate", "Cebolla", "Lechuga"].map(categoryOf)).toEqual([id, id, id]);
  });

  it("sin pista clara va a 'Otros'", async () => {
    const result = await applyAiDraft(draftWith("Producto raro XYZ"), [], [cat("c-aseo", "Aseo")], [] as Product[]);
    expect(result.createdCategories.map((c) => c.name)).toEqual(["Otros"]);
    expect(categoryOf("Producto raro XYZ")).not.toBe("c-aseo");
  });

  it("un insumo que ya existe en el inventario no crea ni categoría ni insumo", async () => {
    const draft = draftWith("Tomate");
    draft.ingredients[0].match = { productId: "p-1", name: "Tomate", unit: "kg" };
    const result = await applyAiDraft(draft, [], [], [] as Product[]);
    expect(result.createdCategories).toEqual([]);
    expect(store.insumos).toEqual([]);
    expect(result.rows).toHaveLength(1);
  });

  it("si no se puede crear la categoría, avisa y deja agregar ese insumo a mano", async () => {
    store.rejectCategoryNames = ["Carnes", "Carnes (insumos)"];
    const result = await applyAiDraft(draftWith("Pollo", "Tomate"), [], [], [] as Product[]);
    expect(result.rows).toHaveLength(1); // solo el tomate
    expect(result.notices.join(" ")).toContain("Pollo");
  });
});