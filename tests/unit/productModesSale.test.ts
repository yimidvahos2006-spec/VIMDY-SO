import { describe, it, expect } from "vitest";
import { InventoryEngine } from "../../src/core/engines/InventoryEngine";
import { KardexEngine } from "../../src/core/engines/KardexEngine";
import { FakeProductRepository } from "../fakes/FakeProductRepository";
import { InMemoryRepository } from "../fakes/InMemoryRepository";
import { buildProductInput, kindOfProduct } from "../../src/presentation/components/inventory/product-form/buildProductInput";
import type { Category, Product } from "../../src/core/entities/Entities";
import type { RecipeRowDraft } from "../../src/presentation/components/inventory/product-form/productFormTypes";

/**
 * Los 3 modos del formulario de producto (Preparado, Reventa, Servicio) pasan por el MISMO
 * camino que en producción: buildProductInput -> InventoryEngine.createProduct -> venta
 * (consumeForSale). Se comprueba qué stock baja en cada caso y que, al reabrir, el modo es el mismo.
 */
const cats = [{ id: "c1", name: "Todo" }] as unknown as Category[];
const row = (productId: string, quantity: string): RecipeRowDraft => ({ rowId: productId, productId, quantity, unit: "", optional: false });

async function setup() {
  const repository = new FakeProductRepository();
  const engine = new InventoryEngine(repository, new KardexEngine(new InMemoryRepository("inventory_movements")));

  // Insumos (con stock) y catálogo base para armar el formulario.
  const pan = await engine.createProduct({ name: "Pan", isIngredient: true, trackStock: true, unit: "unidad", categoryId: "c1" });
  const carne = await engine.createProduct({ name: "Carne", isIngredient: true, trackStock: true, unit: "unidad", categoryId: "c1" });
  await repository.save({ ...pan, stock: 50 });
  await repository.save({ ...carne, stock: 30 });
  const allProducts = [pan, carne] as Product[];

  const create = async (kind: "preparado" | "reventa" | "servicio", over: Record<string, unknown>, rows: RecipeRowDraft[] = []) => {
    const built = buildProductInput({ name: "X", categoryId: "c1", price: "5.000", station: "", allProducts, categories: cats, kind, rows, ...over });
    if (!built.ok) throw new Error(built.error);
    return engine.createProduct(built.input);
  };

  return { repository, engine, pan, carne, create };
}

describe("venta según el modo del producto", () => {
  it("Preparado con receta: descuenta los ingredientes, no el plato", async () => {
    const { engine, repository, pan, carne, create } = await setup();
    const burger = await create("preparado", { name: "Hamburguesa" }, [row(pan.id, "1"), row(carne.id, "2")]);

    await engine.consumeForSale([{ productId: burger.id, quantity: 3 }]);

    expect((await repository.findById(pan.id))!.stock).toBe(47);
    expect((await repository.findById(carne.id))!.stock).toBe(24);
    expect((await repository.findById(burger.id))!.stock).toBe(0);
  });

  it("Preparado sin ingredientes: se vende sin descontar nada", async () => {
    const { engine, repository, create } = await setup();
    const tinto = await create("preparado", { name: "Tinto", cost: "300" });

    await expect(engine.consumeForSale([{ productId: tinto.id, quantity: 2 }])).resolves.toBeUndefined();
    expect((await repository.findById(tinto.id))!.stock).toBe(0);
    expect(tinto.purchasePrice).toBe(300);
  });

  it("Reventa: descuenta unidades directas, guarda costo y código de barras", async () => {
    const { engine, repository, create } = await setup();
    const soda = await create("reventa", { name: "Gaseosa 400 ml", cost: "1.800", barcode: "7702004003509" });
    await repository.save({ ...soda, stock: 20 });

    await engine.consumeForSale([{ productId: soda.id, quantity: 4 }]);

    const after = (await repository.findById(soda.id))!;
    expect(after.stock).toBe(16);
    expect(after).toMatchObject({ purchasePrice: 1800, barcode: "7702004003509", trackStock: true, requiresKitchen: false });
    expect(kindOfProduct(after)).toBe("reventa");
  });

  it("Reventa sin stock: la venta no se bloquea (Opción B) y queda en negativo", async () => {
    const { engine, repository, create } = await setup();
    const soda = await create("reventa", { name: "Agua" });

    await engine.consumeForSale([{ productId: soda.id, quantity: 2 }]);

    expect((await repository.findById(soda.id))!.stock).toBe(-2);
  });

  it("Servicio: se vende libre, sin tocar inventario ni fallar", async () => {
    const { engine, repository, create } = await setup();
    const domicilio = await create("servicio", { name: "Domicilio", price: "3.000" });

    await expect(engine.consumeForSale([{ productId: domicilio.id, quantity: 1 }])).resolves.toBeUndefined();
    const after = (await repository.findById(domicilio.id))!;
    expect(after.stock).toBe(0);
    expect(after).toMatchObject({ trackStock: false, requiresKitchen: false });
    expect(kindOfProduct(after)).toBe("servicio");
  });

  it("una venta mixta descuenta cada tipo como le corresponde", async () => {
    const { engine, repository, pan, carne, create } = await setup();
    const burger = await create("preparado", { name: "Hamburguesa" }, [row(pan.id, "1"), row(carne.id, "1")]);
    const soda = await create("reventa", { name: "Gaseosa" });
    const domicilio = await create("servicio", { name: "Domicilio" });
    await repository.save({ ...soda, stock: 10 });

    await engine.consumeForSale([
      { productId: burger.id, quantity: 2 },
      { productId: soda.id, quantity: 2 },
      { productId: domicilio.id, quantity: 1 }
    ]);

    expect((await repository.findById(pan.id))!.stock).toBe(48);
    expect((await repository.findById(carne.id))!.stock).toBe(28);
    expect((await repository.findById(soda.id))!.stock).toBe(8);
    expect((await repository.findById(domicilio.id))!.stock).toBe(0);
  });
});

describe("código de barras repetido", () => {
  it("crear o editar con un código que ya existe avisa con un mensaje claro", async () => {
    const { engine, repository, create } = await setup();
    const soda = await create("reventa", { name: "Gaseosa", barcode: "7702004003509" });
    await repository.save({ ...soda, stock: 5 });

    await expect(create("reventa", { name: "Otra gaseosa", barcode: " 7702004003509 " })).rejects.toThrow("BARCODE_DUPLICADO");

    const other = await create("reventa", { name: "Agua", barcode: "7702004003999" });
    await expect(engine.updateProduct(other.id, { ...other, barcode: "7702004003509" })).rejects.toThrow("BARCODE_DUPLICADO");
    // Guardarse a sí mismo con su propio código no es un duplicado.
    await expect(engine.updateProduct(soda.id, { ...soda, price: 4000 })).resolves.toBeDefined();
  });

  it("varios productos sin código no chocan entre sí", async () => {
    const { create } = await setup();
    await create("reventa", { name: "A" });
    await expect(create("reventa", { name: "B" })).resolves.toBeDefined();
  });
});