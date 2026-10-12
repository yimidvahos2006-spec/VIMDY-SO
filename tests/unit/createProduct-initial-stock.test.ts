import { describe, it, expect, vi } from "vitest";
import { InventoryEngine } from "../../src/core/engines/InventoryEngine";
import { FakeProductRepository } from "../fakes/FakeProductRepository";

/**
 * El kardex (inventory_movements) es de solo lectura para el navegador:
 * el stock inicial de un producto nuevo debe registrarse por el RPC seguro
 * (adjustStockWithKardex), nunca escribiendo directo en la tabla.
 */
describe("InventoryEngine.createProduct — stock inicial", () => {
  it("guarda el producto con stock 0 y aplica el stock inicial por el RPC con motivo 'Stock inicial'", async () => {
    const repository = new FakeProductRepository();
    const adjust = vi.fn(async (params: { productId: string; delta: number }) => ({
      id: params.productId,
      name: "Agua",
      price: 3500,
      stock: params.delta,
      minStock: 0,
      active: true
    }));
    repository.adjustStockWithKardex = adjust as any;
    const engine = new InventoryEngine(repository);

    const created = await engine.createProduct({ name: "Agua", price: 3500, stock: 20 } as any, "actor");

    expect(adjust).toHaveBeenCalledTimes(1);
    expect(adjust.mock.calls[0][0]).toMatchObject({
      delta: 20,
      reason: "Stock inicial",
      type: "INCREASE",
      performedBy: "actor"
    });
    expect(created.stock).toBe(20);
    expect(created.price).toBe(3500);
  });

  it("si el RPC falla, no deja el producto a medias", async () => {
    const repository = new FakeProductRepository();
    repository.adjustStockWithKardex = vi.fn(async () => {
      throw new Error("SUPABASE_ADJUST_STOCK_WITH_KARDEX_FAILED: boom");
    }) as any;
    const engine = new InventoryEngine(repository);

    await expect(engine.createProduct({ name: "Agua", price: 3500, stock: 20 } as any)).rejects.toThrow("boom");
    expect(await repository.findAll()).toHaveLength(0);
  });

  it("sin stock inicial no llama al RPC", async () => {
    const repository = new FakeProductRepository();
    const adjust = vi.fn();
    repository.adjustStockWithKardex = adjust as any;
    const engine = new InventoryEngine(repository);

    await engine.createProduct({ name: "Servicio", price: 10000, stock: 0 } as any);

    expect(adjust).not.toHaveBeenCalled();
  });
});