import { describe, expect, it } from "vitest";
import type { Category, Product } from "../../../../core/entities/Entities";
import { buildProductInput, formTypeForKind, kindOfProduct, resolveFormType, resolveStationOverride } from "./buildProductInput";
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

describe("buildProductInput: costo directo y foto", () => {
  it("sin ingredientes: guarda el costo de compra escrito", () => {
    const r = buildProductInput({ ...base, cost: "8.500", rows: [] });
    expect(r.ok && r.input.purchasePrice).toBe(8500);
  });

  it("sin ingredientes y costo vacío: queda sin costo", () => {
    const r = buildProductInput({ ...base, cost: "", rows: [] });
    expect(r.ok && r.input.purchasePrice).toBeUndefined();
  });

  it("costo inválido se rechaza", () => {
    expect(buildProductInput({ ...base, cost: "abc", rows: [] })).toMatchObject({ ok: false });
    expect(buildProductInput({ ...base, cost: "-5", rows: [] })).toMatchObject({ ok: false });
  });

  it("con ingredientes: el costo escrito se ignora (manda la receta)", () => {
    const r = buildProductInput({ ...base, cost: "8.500", rows: [row("huevo", "2")] });
    expect(r.ok && r.input.purchasePrice).toBeUndefined();
    const editing = product({ id: "p", name: "Pan", categoryId: "c1", price: 4500, purchasePrice: 1200 });
    const e = buildProductInput({ ...base, product: editing, cost: "8.500", rows: [row("huevo", "2")] });
    expect(e.ok && e.input.purchasePrice).toBe(1200);
  });

  it("cost undefined (sin permiso de costos) conserva el costo guardado", () => {
    const editing = product({ id: "p", name: "Pan", categoryId: "c1", price: 4500, purchasePrice: 1200 });
    const r = buildProductInput({ ...base, product: editing, rows: [] });
    expect(r.ok && r.input.purchasePrice).toBe(1200);
  });

  it("foto: se conserva, se cambia o se quita", () => {
    const editing = product({ id: "p", name: "Pan", categoryId: "c1", price: 4500, image: "data:old" });
    expect(buildProductInput({ ...base, product: editing, rows: [] })).toMatchObject({ ok: true, input: { image: "data:old" } });
    expect(buildProductInput({ ...base, product: editing, image: "data:new", rows: [] })).toMatchObject({ ok: true, input: { image: "data:new" } });
    const removed = buildProductInput({ ...base, product: editing, image: "", rows: [] });
    expect(removed.ok && removed.input.image).toBeUndefined();
  });
});

describe("buildProductInput: tipo de producto (selector)", () => {
  it("kindOfProduct: nuevo = preparado; editar respeta lo guardado", () => {
    expect(kindOfProduct(undefined)).toBe("preparado");
    expect(kindOfProduct(product({ id: "a", name: "A", requiresKitchen: true }))).toBe("preparado");
    expect(kindOfProduct(product({ id: "b", name: "B", trackStock: true, requiresKitchen: false }))).toBe("reventa");
    expect(kindOfProduct(product({ id: "c", name: "C", trackStock: false, requiresKitchen: false }))).toBe("servicio");
    expect(kindOfProduct(product({ id: "d", name: "D", isIngredient: true }))).toBe("ingrediente");
    expect(formTypeForKind("preparado", true)).toBe("cocina_receta");
    expect(formTypeForKind("preparado", false)).toBe("cocina");
    expect(resolveFormType(undefined, true, "reventa")).toBe("inventario");
  });

  it("reventa: con stock, sin cocina, costo y código de barras; ignora ingredientes", () => {
    const r = buildProductInput({ ...base, kind: "reventa", cost: "1.800", barcode: " 7702004003509 ", rows: [row("huevo", "2")] });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.input.trackStock).toBe(true);
    expect(r.input.requiresKitchen).toBe(false);
    expect(r.input.isIngredient).toBe(false);
    expect(r.input.purchasePrice).toBe(1800);
    expect(r.input.barcode).toBe("7702004003509");
    expect(r.input.recipe).toBeUndefined();
    expect(r.input.productionMode).toBeUndefined();
    expect(r.input.printStationOverride).toBeUndefined();
  });

  it("reventa con código vacío: queda sin código (no guarda texto vacío)", () => {
    const r = buildProductInput({ ...base, kind: "reventa", barcode: "  ", rows: [] });
    expect(r.ok && r.input.barcode).toBeUndefined();
  });

  it("servicio: sin stock ni cocina, sin ingredientes; el costo es opcional", () => {
    const r = buildProductInput({ ...base, kind: "servicio", rows: [row("huevo", "2")] });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.input.trackStock).toBe(false);
    expect(r.input.requiresKitchen).toBe(false);
    expect(r.input.recipe).toBeUndefined();
    expect(r.input.purchasePrice).toBeUndefined();
  });

  it("preparado sin receta: se queda en cocina, sin código de barras nuevo", () => {
    const r = buildProductInput({ ...base, kind: "preparado", rows: [] });
    expect(r.ok && r.input.requiresKitchen).toBe(true);
    expect(r.ok && r.input.barcode).toBeUndefined();
  });

  it("editar un preparado con receta y pasarlo a reventa borra la receta", () => {
    const editing = product({ id: "p", name: "Pan", categoryId: "c1", price: 4500, requiresKitchen: true, recipe: [{ productId: "harina", quantity: 1 }] });
    const r = buildProductInput({ ...base, product: editing, kind: "reventa", rows: [row("harina", "1")] });
    expect(r.ok && r.input.recipe).toEqual([]);
    expect(r.ok && r.input.trackStock).toBe(true);
  });

  it("un insumo editado conserva su tipo", () => {
    const r = buildProductInput({ ...base, product: harina, kind: "ingrediente", price: "", rows: [] });
    expect(r.ok && r.input.isIngredient).toBe(true);
  });
});

describe("buildProductInput: crear -> reabrir carga el modo correcto y no pierde datos", () => {
  const reopen = (input: Record<string, unknown>) => product({ id: "x", ...input } as never);

  it.each([
    ["preparado", []],
    ["preparado", [row("huevo", "2")]],
    ["reventa", []],
    ["servicio", []]
  ] as const)("modo %s se vuelve a abrir en el mismo modo", (kind, rows) => {
    const r = buildProductInput({ ...base, kind, rows: [...rows], cost: "1.000", barcode: "123" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const reopened = reopen({ ...r.input, id: "x" });
    expect(kindOfProduct(reopened)).toBe(kind);
  });

  it("reventa guardada conserva costo, código y foto al reabrir y guardar sin cambios", () => {
    const first = buildProductInput({ ...base, kind: "reventa", cost: "1.800", barcode: "770", image: "data:img", rows: [] });
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const saved = reopen({ ...first.input, id: "x", stock: 7 });
    const again = buildProductInput({ ...base, product: saved, kind: kindOfProduct(saved), cost: "1.800", barcode: "770", rows: [] });
    expect(again.ok && again.input).toMatchObject({ purchasePrice: 1800, barcode: "770", image: "data:img", stock: 7, trackStock: true });
  });

  it("pasar una reventa a servicio no borra su costo ni su código guardados", () => {
    const saved = product({ id: "x", name: "Soda", categoryId: "c1", price: 3000, trackStock: true, purchasePrice: 1800, barcode: "770", estimatedPrepMinutes: 5 });
    const r = buildProductInput({ ...base, product: saved, kind: "servicio", rows: [] });
    expect(r.ok && r.input).toMatchObject({ purchasePrice: 1800, barcode: "770", estimatedPrepMinutes: 5, trackStock: false });
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