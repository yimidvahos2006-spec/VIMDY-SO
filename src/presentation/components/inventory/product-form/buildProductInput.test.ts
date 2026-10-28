import { describe, expect, it } from "vitest";
import type { Category, Product } from "../../../../core/entities/Entities";
import { buildProductInput, resolveFormType, resolveStationOverride } from "./buildProductInput";
import type { RecipeRowDraft } from "./productFormTypes";

const product = (over: Partial<Product> & { id: string; name: string }): Product =>
  ({ categoryId: "c-insumos", price: 0, stock: 0, minStock: 0, lastUpdated: new Date(), ...over }) as Product;

const harina = product({ id: "harina", name: "Harina", unit: "kg", isIngredient: true });
const huevo = product({ id: "huevo", name: "Huevo", unit: "unidad", isIngredient: true });
const cats = [{ id: "c1", name: "Platos", printStation: "Barra" }] as unknown as Category[];

const row = (productId: string, quantity: string, unit = ""): RecipeRowDraft => ({
  rowId: `r-${productId}`,
  productId,
  quantity,
  unit,
  optional: false
});

const base = { name: " Pan ", categoryId: "c1", price: "4.500", station: "", allProducts: [harina, huevo], categories: cats };

describe("buildProductInput", () => {
  it("plato nuevo con receta: convierte g -> kg y marca cocina_receta", () => {
    const r = buildProductInput({ ...base, rows: [row("harina", "250", "g"), row("huevo", "2")] });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.input.name).toBe("Pan");
    expect(r.input.price).toBe(4500);
    expect(r.input.requiresKitchen).toBe(true);
    expect(r.input.trackStock).toBe(false);
    expect(r.input.stock).toBe(0);
    expect(r.input.recipe).toEqual([
      { productId: "harina", quantity: 0.25, optional: false, entryQuantity: 250, entryUnit: "g" },
      { productId: "huevo", quantity: 2, optional: false }
    ]);
  });

  it("sin ingredientes: plato de cocina sin receta", () => {
    const r = buildProductInput({ ...base, rows: [] });
    expect(r.ok && r.input.recipe).toBeFalsy();
    expect(r.ok && r.input.requiresKitchen).toBe(true);
    expect(r.ok && r.input.productionMode).toBeUndefined();
  });

  it("pide nombre, categoría y precio", () => {
    expect(buildProductInput({ ...base, name: " ", rows: [] })).toMatchObject({ ok: false });
    expect(buildProductInput({ ...base, categoryId: "", rows: [] })).toMatchObject({ ok: false });
    expect(buildProductInput({ ...base, price: "", rows: [] })).toMatchObject({ ok: false });
  });

  it("señala la fila sin cantidad", () => {
    const r = buildProductInput({ ...base, rows: [row("harina", "")] });
    expect(r).toMatchObject({ ok: false, rowId: "r-harina" });
  });

  it("rechaza unidades incompatibles (ml en un insumo por kg)", () => {
    const r = buildProductInput({ ...base, rows: [row("harina", "100", "ml")] });
    expect(r).toMatchObject({ ok: false, rowId: "r-harina" });
  });

  it("editar: vaciar la receta envía [] para que se borre", () => {
    const editing = product({ id: "p", name: "Pan", categoryId: "c1", price: 4500, requiresKitchen: true, recipe: [{ productId: "huevo", quantity: 1 }] });
    const r = buildProductInput({ ...base, product: editing, rows: [] });
    expect(r.ok && r.input.recipe).toEqual([]);
  });

  it("editar un producto de inventario respeta su tipo (no lo manda a cocina)", () => {
    const soda = product({ id: "s", name: "Soda", categoryId: "c1", price: 3000, trackStock: true, requiresKitchen: false, stock: 12 });
    expect(resolveFormType(soda, false)).toBe("inventario");
    const r = buildProductInput({ ...base, product: soda, rows: [] });
    expect(r.ok && r.input.requiresKitchen).toBe(false);
    expect(r.ok && r.input.trackStock).toBe(true);
    expect(r.ok && r.input.stock).toBe(12);
  });
});

describe("resolveStationOverride", () => {
  it("vacío o igual a la de la categoría -> sin override", () => {
    expect(resolveStationOverride("", cats[0])).toBeUndefined();
    expect(resolveStationOverride("barra", cats[0])).toBeUndefined();
    expect(resolveStationOverride("Cocina", undefined)).toBeUndefined();
  });
  it("distinta -> se guarda", () => {
    expect(resolveStationOverride("Cocina", cats[0])).toBe("Cocina");
    expect(resolveStationOverride("Barra", undefined)).toBe("Barra");
  });
});