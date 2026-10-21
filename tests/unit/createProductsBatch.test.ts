import { describe, it, expect, vi } from "vitest";
import { InventoryEngine } from "../../src/core/engines/InventoryEngine";
import { FakeProductRepository } from "../fakes/FakeProductRepository";

function setup() {
  const repository = new FakeProductRepository();
  const saveMany = vi.spyOn(repository, "saveMany");
  const findAll = vi.spyOn(repository, "findAll");
  const batch = vi.fn(async () => []);
  repository.adjustStockBatchWithKardex = batch as any;
  return { repository, engine: new InventoryEngine(repository), saveMany, findAll, batch };
}

describe("InventoryEngine.createProductsBatch", () => {
  it("500 productos: carga el catálogo una vez y guarda por lotes (no uno por uno)", async () => {
    const { engine, saveMany, findAll, batch, repository } = setup();
    const inputs = Array.from({ length: 500 }, (_, i) => ({ name: `Producto ${i}`, price: 1000, stock: 2, categoryId: "c" }));

    const result = await engine.createProductsBatch(inputs, "actor");

    expect(result.created).toHaveLength(500);
    expect(result.failed).toHaveLength(0);
    expect(findAll).toHaveBeenCalledTimes(1);
    expect(saveMany).toHaveBeenCalledTimes(5);
    expect(batch).toHaveBeenCalledTimes(5); // un lote de stock por cada lote de 100 guardados
    expect(await repository.findAll()).toHaveLength(500);
  });

  it("registra 'Stock inicial' en el kardex y guarda el producto con stock 0", async () => {
    const { engine, batch, saveMany } = setup();
    await engine.createProductsBatch([{ name: "Agua", price: 3500, stock: 20, categoryId: "c" }]);
    const saved = (saveMany.mock.calls[0][0] as any[])[0];
    expect(saved.stock).toBe(0);
    const [, movements] = batch.mock.calls[0] as any[];
    expect(movements[0]).toMatchObject({ delta: 20, reason: "Stock inicial", type: "INCREASE" });
  });

  it("una fila mala no frena las demás y el motivo viene con su posición", async () => {
    const { engine } = setup();
    const result = await engine.createProductsBatch([
      { name: "Bueno", price: 100, categoryId: "c" },
      { name: "bueno ", price: 100, categoryId: "c" },
      { name: "Malo", price: -5, categoryId: "c" },
      { name: "Otro", price: 100, categoryId: "c" }
    ]);
    expect(result.created.map((p) => p.name)).toEqual(["Bueno", "Otro"]);
    expect(result.failed).toEqual([
      { index: 1, name: "bueno", error: "NOMBRE_DUPLICADO" },
      { index: 2, name: "Malo", error: "PRECIO_INVALIDO" }
    ]);
  });

  it("si el stock inicial falla, deshace esos productos (no quedan a medias)", async () => {
    const { engine, repository } = setup();
    repository.adjustStockBatchWithKardex = vi.fn(async () => {
      throw new Error("SUPABASE_ADJUST_STOCK_BATCH_FAILED: boom");
    }) as any;
    const result = await engine.createProductsBatch([
      { name: "A", price: 1, stock: 5, categoryId: "c" },
      { name: "B", price: 1, stock: 0, categoryId: "c" }
    ]);
    expect(result.failed.map((f) => f.name)).toEqual(["A"]);
    expect((await repository.findAll()).map((p) => p.name)).toEqual(["B"]);
  });

  it("ingredientes: isIngredient, trackStock y sin cocina", async () => {
    const { engine } = setup();
    const { created } = await engine.createProductsBatch([{ name: "Sal", price: 0, isIngredient: true, requiresKitchen: true, categoryId: "i" }]);
    expect(created[0]).toMatchObject({ isIngredient: true, trackStock: true, requiresKitchen: false });
  });
});

describe("InventoryEngine.updateProductsBatch", () => {
  it("actualiza precio sin tocar el stock", async () => {
    const { engine, repository } = setup();
    await repository.save({ id: "p1", name: "Agua", categoryId: "c", price: 1000, stock: 9, minStock: 0, active: true, lastUpdated: new Date() } as any);
    const result = await engine.updateProductsBatch([{ id: "p1", input: { name: "Agua", price: 2000 } }]);
    expect(result.updated).toBe(1);
    expect((await repository.findById("p1"))).toMatchObject({ price: 2000, stock: 9 });
  });
});