import { describe, it, expect } from "vitest";
import { InventoryEngine } from "../../src/core/engines/InventoryEngine";
import { KardexEngine } from "../../src/core/engines/KardexEngine";
import { FakeProductRepository } from "../fakes/FakeProductRepository";
import { InMemoryRepository } from "../fakes/InMemoryRepository";

describe("InventoryEngine", () => {
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
