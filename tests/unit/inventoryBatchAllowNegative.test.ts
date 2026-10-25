import { describe, it, expect, vi } from "vitest";
import { InventoryEngine } from "../../src/core/engines/InventoryEngine";
import { KardexEngine } from "../../src/core/engines/KardexEngine";
import { FakeProductRepository } from "../fakes/FakeProductRepository";
import { InMemoryRepository } from "../fakes/InMemoryRepository";

/**
 * Opción B en el lote atómico: la venta (DECREASE) manda allowNegative=true en cada
 * movimiento; la reposición (INCREASE) nunca lo manda. El SQL lo aplica
 * (supabase/tests/inventory_batch_allow_negative.test.sql); aquí se fija el contrato
 * del lado de la app.
 */
async function setup() {
  const repository = new FakeProductRepository();
  const kardex = new KardexEngine(new InMemoryRepository("inventory_movements"));
  const adjustStockBatchWithKardex = vi.fn(async () => []);
  repository.adjustStockBatchWithKardex = adjustStockBatchWithKardex;
  const engine = new InventoryEngine(repository, kardex);
  const flour = await engine.createProduct({ name: "Harina", stock: 1, trackStock: true });
  return { engine, adjustStockBatchWithKardex, flour };
}

describe("lote atómico de inventario — allowNegative (Opción B)", () => {
  it("la venta pide allowNegative=true en cada descuento del lote", async () => {
    const { engine, adjustStockBatchWithKardex, flour } = await setup();

    await engine.consumeForSale([{ productId: flour.id, quantity: 3 }], "Venta test", "sale-op-1");

    expect(adjustStockBatchWithKardex).toHaveBeenCalledWith("sale-op-1", [
      expect.objectContaining({ productId: flour.id, delta: -3, type: "DECREASE", allowNegative: true })
    ]);
  });

  it("restaurar una venta (INCREASE) no manda allowNegative", async () => {
    const { engine, adjustStockBatchWithKardex, flour } = await setup();

    await engine.restoreForSale([{ productId: flour.id, quantity: 3 }], "Anulación test", "restore-op-1");

    const [, movements] = adjustStockBatchWithKardex.mock.calls[0] as unknown as [string, Array<Record<string, unknown>>];
    expect(movements[0]).toMatchObject({ productId: flour.id, delta: 3, type: "INCREASE" });
    expect(movements[0]).not.toHaveProperty("allowNegative");
  });
});