import { describe, it, expect, vi } from "vitest";
import { InventoryEngine } from "../../src/core/engines/InventoryEngine";
import { KardexEngine } from "../../src/core/engines/KardexEngine";
import { FakeProductRepository } from "../fakes/FakeProductRepository";
import { InMemoryRepository } from "../fakes/InMemoryRepository";
import { setCurrentBranchId } from "../../src/infrastructure/supabase/supabaseClient";

describe("InventoryEngine", () => {
  it("routes validated branch transfers through the atomic repository operation", async () => {
    const repository = new FakeProductRepository();
    const transferStock = vi.fn(async () => []);
    repository.transferStock = transferStock;
    const engine = new InventoryEngine(repository);

    await engine.transferStock("product-1", "branch-a", "branch-b", 2, "transfer-op", "actor");

    expect(transferStock).toHaveBeenCalledWith({
      operationId: "transfer-op",
      productId: "product-1",
      fromBranchId: "branch-a",
      toBranchId: "branch-b",
      quantity: 2,
      performedBy: "actor"
    });
    await expect(engine.transferStock("product-1", "branch-a", "branch-a", 2)).rejects.toThrow(
      "INVALID_BRANCH_STOCK_TRANSFER"
    );
    await expect(engine.transferStock("product-1", "branch-a", "branch-b", 0)).rejects.toThrow(
      "INVALID_STOCK_QUANTITY"
    );
  });

  it("routes batch production through the atomic repository operation", async () => {
    const repository = new FakeProductRepository();
    const produceBatch = vi.fn(async () => []);
    repository.produceBatch = produceBatch;
    const engine = new InventoryEngine(repository);
    setCurrentBranchId("branch-a");

    try {
      await engine.produceBatch("product-1", 4, "actor", "production-op");
      expect(produceBatch).toHaveBeenCalledWith({
        operationId: "production-op",
        productId: "product-1",
        branchId: "branch-a",
        quantity: 4,
        performedBy: "actor"
      });
      await expect(engine.produceBatch("product-1", 0)).rejects.toThrow("INVALID_PRODUCTION_QUANTITY");
    } finally {
      setCurrentBranchId(null);
    }
  });

  it("applies recipe, size, and extra consumption through one atomic repository batch", async () => {
    const repository = new FakeProductRepository();
    const kardex = new KardexEngine(new InMemoryRepository("inventory_movements"));
    const adjustStockBatchWithKardex = vi.fn(async () => []);
    repository.adjustStockBatchWithKardex = adjustStockBatchWithKardex;
    const engine = new InventoryEngine(repository, kardex);

    const flour = await engine.createProduct({ name: "Harina", stock: 20, trackStock: true });
    const cheese = await engine.createProduct({ name: "Queso", stock: 20, trackStock: true });
    const sauce = await engine.createProduct({ name: "Salsa", stock: 20, trackStock: true });
    const pizza = await engine.createProduct({
      name: "Pizza",
      stock: 0,
      trackStock: false,
      recipe: [{ productId: flour.id, quantity: 0.25 }]
    });

    await engine.consumeForSale([{
      productId: pizza.id,
      quantity: 2,
      selectedSize: {
        id: "large",
        name: "Grande",
        priceDelta: 0,
        recipe: [
          { productId: flour.id, quantity: 0.25 },
          { productId: cheese.id, quantity: 0.5 }
        ]
      },
      selectedExtras: [{
        id: "extra-sauce",
        name: "Salsa extra",
        priceDelta: 0,
        recipe: [{ productId: sauce.id, quantity: 0.1 }]
      }]
    }], "Venta test", "sale-operation-1");

    expect(adjustStockBatchWithKardex).toHaveBeenCalledTimes(1);
    expect(adjustStockBatchWithKardex).toHaveBeenCalledWith("sale-operation-1", expect.arrayContaining([
      expect.objectContaining({ productId: flour.id, delta: -0.5 }),
      expect.objectContaining({ productId: cheese.id, delta: -1 }),
      expect.objectContaining({ productId: sauce.id, delta: -0.2 })
    ]));
  });

  it("prevents deleting an ingredient that is still used by a recipe", async () => {
    const repository = new FakeProductRepository();
    const kardex = new KardexEngine(new InMemoryRepository("inventory_movements"));
    const engine = new InventoryEngine(repository, kardex);

    const ingredient = await engine.createProduct({
      name: "Pan",
      categoryId: "cat-insumos",
      price: 1200,
      stock: 10,
      minStock: 0,
      unit: "unidad",
      requiresKitchen: false,
      trackStock: true
    });

    await engine.createProduct({
      name: "Hamburguesa",
      categoryId: "cat-cocina",
      price: 18000,
      stock: 0,
      minStock: 0,
      requiresKitchen: true,
      trackStock: false,
      recipe: [{ productId: ingredient.id, quantity: 1 }]
    });

    await expect(engine.deleteProduct(ingredient.id)).rejects.toThrow("PRODUCT_IN_USE");

    const stillExists = await repository.findById(ingredient.id);
    expect(stillExists).not.toBeNull();
  });

  it("rejects duplicate ingredients inside the same recipe", async () => {
    const repository = new FakeProductRepository();
    const kardex = new KardexEngine(new InMemoryRepository("inventory_movements"));
    const engine = new InventoryEngine(repository, kardex);

    const ingredient = await engine.createProduct({
      name: "Harina",
      categoryId: "cat-insumos",
      price: 5000,
      stock: 10,
      minStock: 0,
      unit: "kg",
      requiresKitchen: false,
      trackStock: true
    });

    await expect(
      engine.createProduct({
        name: "Pizza",
        categoryId: "cat-cocina",
        price: 20000,
        stock: 0,
        minStock: 0,
        requiresKitchen: true,
        trackStock: false,
        recipe: [
          { productId: ingredient.id, quantity: 0.5 },
          { productId: ingredient.id, quantity: 0.25 }
        ]
      })
    ).rejects.toThrow("INGREDIENTE_DUPLICADO");
  });

  it("deactivates a product instead of deleting it when it already has stock history", async () => {
    const repository = new FakeProductRepository();
    const kardex = new KardexEngine(new InMemoryRepository("inventory_movements"));
    const engine = new InventoryEngine(repository, kardex);

    const product = await engine.createProduct({
      name: "Queso",
      categoryId: "cat-insumos",
      price: 8000,
      stock: 6,
      minStock: 2,
      unit: "kg",
      requiresKitchen: false,
      trackStock: true
    });

    await engine.increaseStock(product.id, 2, "Reposición de prueba", "tester");
    await engine.deleteProduct(product.id);

    const updated = await repository.findById(product.id);
    expect(updated?.active).toBe(false);
  });

  it("consumes batch product stock even if legacy trackStock is false", async () => {
    const repository = new FakeProductRepository();
    const kardex = new KardexEngine(new InMemoryRepository("inventory_movements"));
    const engine = new InventoryEngine(repository, kardex);

    const ingredient = await engine.createProduct({
      name: "Harina",
      categoryId: "cat-insumos",
      price: 5000,
      stock: 20,
      minStock: 0,
      unit: "kg",
      requiresKitchen: false,
      trackStock: true
    });

    const batchProduct = await engine.createProduct({
      name: "Pan BATCH",
      categoryId: "cat-cocina",
      price: 1200,
      stock: 10,
      minStock: 0,
      unit: "unidad",
      requiresKitchen: true,
      trackStock: false,
      recipe: [{ productId: ingredient.id, quantity: 1 }],
      productionMode: "BATCH"
    });

    await engine.consumeForSale(
      [{ productId: batchProduct.id, quantity: 3 }],
      "Venta de pan batch",
      "tester"
    );

    const updatedBatchProduct = await repository.findById(batchProduct.id);
    const updatedIngredient = await repository.findById(ingredient.id);

    expect(updatedBatchProduct?.stock).toBe(7);
    expect(updatedIngredient?.stock).toBe(20);
  });

  it("transfers stock between branches using separate product records", async () => {
    const repository = new FakeProductRepository();
    const kardex = new KardexEngine(new InMemoryRepository("inventory_movements"));
    const engine = new InventoryEngine(repository, kardex);

    const origin = await engine.createProduct({
      name: "Coca-Cola 400ml",
      categoryId: "cat-bebidas",
      price: 4000,
      stock: 10,
      minStock: 2,
      unit: "unidad",
      requiresKitchen: false,
      trackStock: true,
      sku: "COCA-400"
    });

    const originAtBranch = { ...origin, branchId: "branch-a" };
    await repository.save(originAtBranch);

    const destAtBranch = {
      ...origin,
      id: crypto.randomUUID(),
      stock: 0,
      branchId: "branch-b",
      lastUpdated: new Date(),
      createdAt: new Date(),
      version: 1
    };
    await repository.save(destAtBranch);

    await engine.transferStock(origin.id, "branch-a", "branch-b", 3);

    const updatedOrigin = await repository.findById(origin.id);
    const updatedDest = await repository.findById(destAtBranch.id);

    expect(updatedOrigin?.stock).toBe(7);
    expect(updatedDest?.stock).toBe(3);
  });

  it("creates destination product on transfer when it does not exist yet", async () => {
    const repository = new FakeProductRepository();
    const kardex = new KardexEngine(new InMemoryRepository("inventory_movements"));
    const engine = new InventoryEngine(repository, kardex);

    const origin = await engine.createProduct({
      name: "Coca-Cola 400ml",
      categoryId: "cat-bebidas",
      price: 4000,
      stock: 10,
      minStock: 2,
      unit: "unidad",
      requiresKitchen: false,
      trackStock: true,
      sku: "COCA-400"
    });

    const originAtBranch = { ...origin, branchId: "branch-a" };
    await repository.save(originAtBranch);

    await engine.transferStock(origin.id, "branch-a", "branch-b", 3);

    const updatedOrigin = await repository.findById(origin.id);
    const allProducts = await repository.all();
    const createdDest = allProducts.find((p) => p.sku === "COCA-400" && p.branchId === "branch-b");

    expect(updatedOrigin?.stock).toBe(7);
    expect(createdDest).toBeDefined();
    expect(createdDest?.stock).toBe(3);
  });
});
