// tests/unit/productType.test.ts
/* ===========================================================================
   REGRESIÓN — Bug cocina_receta ON_DEMAND (FASE 1)
   ---------------------------------------------------------------------------
   Reproduce EXACTAMENTE el bug reportado:
   - InventoryDashboard.handleSave guardaba trackStock=false para
     cocina_receta + ON_DEMAND (correcto: consume ingredientes directo).
   - inferProductType() revisaba trackStock === false ANTES que la receta,
     así que al recargar el producto se interpretaba como "servicio".

   Estos tests garantizan que la representación persistida sea ESTABLE:
   crear -> guardar -> cargar -> inferir tipo devuelve SIEMPRE el mismo tipo.
   =========================================================================== */

import { describe, it, expect } from "vitest";
import { Product } from "../../src/core/entities/Entities";
import { inferProductType, resolveProductFlags, ProductType } from "../../src/core/types/productType";
import { InventoryEngine } from "../../src/core/engines/InventoryEngine";
import { KardexEngine } from "../../src/core/engines/KardexEngine";
import { FakeProductRepository } from "../fakes/FakeProductRepository";
import { InMemoryRepository } from "../fakes/InMemoryRepository";

function buildProduct(overrides: Partial<Product> = {}): Product {
  return {
    id: "prod-test",
    name: "Producto de prueba",
    categoryId: "cat-test",
    price: 10000,
    stock: 0,
    minStock: 0,
    lastUpdated: new Date(),
    ...overrides
  };
}

function buildEngine() {
  const repository = new FakeProductRepository();
  const kardex = new KardexEngine(new InMemoryRepository("inventory_movements"));
  const engine = new InventoryEngine(repository, kardex);
  return { repository, kardex, engine };
}

describe("Regresión: tipos de producto estables (bug cocina_receta ON_DEMAND)", () => {
  // TEST 1: cocina_receta ON_DEMAND -> guardar -> cargar -> inferir -> cocina_receta
  it("TEST 1: cocina_receta ON_DEMAND se conserva como cocina_receta al recargar", async () => {
    const { repository, kardex, engine } = buildEngine();

    // Crear ingrediente primero (la receta lo requiere)
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

    // Crear cocina_receta ON_DEMAND (lo que hace el formulario al guardar)
    const created = await engine.createProduct({
      name: "Pizza ON_DEMAND",
      categoryId: "cat-cocina",
      price: 20000,
      stock: 0,
      minStock: 0,
      requiresKitchen: true,
      trackStock: false, // ON_DEMAND: no maneja stock propio
      recipe: [{ productId: ingredient.id, quantity: 0.5 }],
      productionMode: "ON_DEMAND"
    });

    // Simular "recargar" desde el repositorio (lo que pasa al reabrir la app)
    const loaded = await repository.findById(created.id);
    expect(loaded).not.toBeNull();

    // El tipo inferido debe ser cocina_receta, NO servicio
    const inferred = inferProductType(loaded!);
    expect(inferred).toBe("cocina_receta");

    // La receta y el modo de producción deben conservarse
    expect(loaded!.recipe).toHaveLength(1);
    expect(loaded!.productionMode).toBe("ON_DEMAND");
    expect(loaded!.requiresKitchen).toBe(true);
  });

  // TEST 2: cocina_receta BATCH -> guardar -> cargar -> cocina_receta
  it("TEST 2: cocina_receta BATCH se conserva como cocina_receta al recargar", async () => {
    const { repository, kardex, engine } = buildEngine();

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

    const created = await engine.createProduct({
      name: "Pan BATCH",
      categoryId: "cat-cocina",
      price: 1200,
      stock: 10,
      minStock: 0,
      requiresKitchen: true,
      trackStock: true, // BATCH: maneja stock propio
      recipe: [{ productId: ingredient.id, quantity: 1 }],
      productionMode: "BATCH"
    });

    const loaded = await repository.findById(created.id);
    expect(loaded).not.toBeNull();

    const inferred = inferProductType(loaded!);
    expect(inferred).toBe("cocina_receta");

    expect(loaded!.recipe).toHaveLength(1);
    expect(loaded!.productionMode).toBe("BATCH");
    expect(loaded!.requiresKitchen).toBe(true);
    expect(loaded!.trackStock).toBe(true);
  });

  // TEST 3: servicio -> guardar -> cargar -> servicio
  it("TEST 3: servicio se conserva como servicio al recargar", async () => {
    const { repository, kardex, engine } = buildEngine();

    const created = await engine.createProduct({
      name: "Domicilio",
      categoryId: "cat-servicios",
      price: 5000,
      stock: 0,
      minStock: 0,
      requiresKitchen: false,
      trackStock: false
    });

    const loaded = await repository.findById(created.id);
    expect(loaded).not.toBeNull();

    const inferred = inferProductType(loaded!);
    expect(inferred).toBe("servicio");

    expect(loaded!.requiresKitchen).toBe(false);
    expect(loaded!.trackStock).toBe(false);
  });

  // TEST 4: inventario -> guardar -> cargar -> inventario
  it("TEST 4: inventario se conserva como inventario al recargar", async () => {
    const { repository, kardex, engine } = buildEngine();

    const created = await engine.createProduct({
      name: "Gaseosa",
      categoryId: "cat-bebidas",
      price: 3000,
      stock: 50,
      minStock: 5,
      requiresKitchen: false,
      trackStock: true
    });

    const loaded = await repository.findById(created.id);
    expect(loaded).not.toBeNull();

    const inferred = inferProductType(loaded!);
    expect(inferred).toBe("inventario");

    expect(loaded!.requiresKitchen).toBe(false);
    expect(loaded!.trackStock).toBe(true);
  });

  // TEST 5: receta ON_DEMAND llega a InventoryEngine y consume ingredientes
  it("TEST 5: receta ON_DEMAND consume ingredientes correctamente via InventoryEngine", async () => {
    const { repository, kardex, engine } = buildEngine();

    const ingredient = await engine.createProduct({
      name: "Carne",
      categoryId: "cat-insumos",
      price: 30000,
      stock: 10,
      minStock: 0,
      unit: "kg",
      requiresKitchen: false,
      trackStock: true
    });

    const burger = await engine.createProduct({
      name: "Hamburguesa",
      categoryId: "cat-cocina",
      price: 18000,
      stock: 0,
      minStock: 0,
      requiresKitchen: true,
      trackStock: false,
      recipe: [{ productId: ingredient.id, quantity: 0.2 }],
      productionMode: "ON_DEMAND"
    });

    // Vender 3 hamburguesas
    await engine.consumeForSale(
      [{ productId: burger.id, quantity: 3 }],
      "Venta de prueba",
      "tester"
    );

    const burgerAfter = await repository.findById(burger.id);
    const ingredientAfter = await repository.findById(ingredient.id);

    // El producto terminado NO se descuenta (stock propio no se toca)
    expect(burgerAfter?.stock).toBe(0);
    // El ingrediente SÍ se descuenta: 0.2 * 3 = 0.6
    expect(ingredientAfter?.stock).toBeCloseTo(9.4, 6);
  });

  // TEST 6: servicio no genera consumo de inventario
  it("TEST 6: servicio no genera consumo de inventario", async () => {
    const { repository, kardex, engine } = buildEngine();

    const service = await engine.createProduct({
      name: "Domicilio",
      categoryId: "cat-servicios",
      price: 5000,
      stock: 0,
      minStock: 0,
      requiresKitchen: false,
      trackStock: false
    });

    // Vender el servicio: no debe tocar ningún stock
    await engine.consumeForSale(
      [{ productId: service.id, quantity: 1 }],
      "Venta de servicio",
      "tester"
    );

    const serviceAfter = await repository.findById(service.id);
    expect(serviceAfter?.stock).toBe(0);
  });

  // TEST 7: BATCH conserva su comportamiento actual
  it("TEST 7: BATCH descuenta stock propio, no ingredientes, al vender", async () => {
    const { repository, kardex, engine } = buildEngine();

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
      requiresKitchen: true,
      trackStock: true,
      recipe: [{ productId: ingredient.id, quantity: 1 }],
      productionMode: "BATCH"
    });

    // Vender 3 panes: descuenta stock propio, NO ingredientes
    await engine.consumeForSale(
      [{ productId: batchProduct.id, quantity: 3 }],
      "Venta de pan",
      "tester"
    );

    const batchAfter = await repository.findById(batchProduct.id);
    const ingredientAfter = await repository.findById(ingredient.id);

    expect(batchAfter?.stock).toBe(7);
    expect(ingredientAfter?.stock).toBe(20);
  });

  // TEST 8: editar un producto no destruye recipe, productionMode, requiresKitchen
  it("TEST 8: editar un producto conserva recipe, productionMode y requiresKitchen", async () => {
    const { repository, kardex, engine } = buildEngine();

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

    const created = await engine.createProduct({
      name: "Pizza",
      categoryId: "cat-cocina",
      price: 20000,
      stock: 0,
      minStock: 0,
      requiresKitchen: true,
      trackStock: false,
      recipe: [{ productId: ingredient.id, quantity: 0.5 }],
      productionMode: "ON_DEMAND"
    });

    // Editar solo el precio (como haría el formulario al guardar cambios)
    const updated = await engine.updateProduct(created.id, {
      name: "Pizza",
      categoryId: "cat-cocina",
      price: 22000,
      stock: 0,
      minStock: 0,
      requiresKitchen: true,
      trackStock: false,
      recipe: [{ productId: ingredient.id, quantity: 0.5 }],
      productionMode: "ON_DEMAND"
    });

    // Nada relevante se pierde
    expect(updated.recipe).toHaveLength(1);
    expect(updated.productionMode).toBe("ON_DEMAND");
    expect(updated.requiresKitchen).toBe(true);
    expect(updated.trackStock).toBe(false);
    expect(updated.price).toBe(22000);

    // Al recargar sigue siendo cocina_receta
    const loaded = await repository.findById(created.id);
    expect(inferProductType(loaded!)).toBe("cocina_receta");
  });
});

describe("resolveProductFlags: inversa exacta de inferProductType", () => {
  it("inventario -> trackStock=true, requiresKitchen=false, sin receta", () => {
    const flags = resolveProductFlags("inventario", "ON_DEMAND");
    expect(flags).toEqual({ trackStock: true, requiresKitchen: false, hasRecipe: false });

    const product = buildProduct({
      trackStock: flags.trackStock,
      requiresKitchen: flags.requiresKitchen
    });
    expect(inferProductType(product)).toBe("inventario");
  });

  it("cocina -> trackStock=false, requiresKitchen=true, sin receta", () => {
    const flags = resolveProductFlags("cocina", "ON_DEMAND");
    expect(flags).toEqual({ trackStock: false, requiresKitchen: true, hasRecipe: false });

    const product = buildProduct({
      trackStock: flags.trackStock,
      requiresKitchen: flags.requiresKitchen
    });
    expect(inferProductType(product)).toBe("cocina");
  });

  it("cocina_receta ON_DEMAND -> trackStock=false, requiresKitchen=true, con receta", () => {
    const flags = resolveProductFlags("cocina_receta", "ON_DEMAND");
    expect(flags).toEqual({ trackStock: false, requiresKitchen: true, hasRecipe: true });

    const product = buildProduct({
      trackStock: flags.trackStock,
      requiresKitchen: flags.requiresKitchen,
      recipe: [{ productId: "ing-1", quantity: 1 }],
      productionMode: "ON_DEMAND"
    });
    expect(inferProductType(product)).toBe("cocina_receta");
  });

  it("cocina_receta BATCH -> trackStock=true, requiresKitchen=true, con receta", () => {
    const flags = resolveProductFlags("cocina_receta", "BATCH");
    expect(flags).toEqual({ trackStock: true, requiresKitchen: true, hasRecipe: true });

    const product = buildProduct({
      trackStock: flags.trackStock,
      requiresKitchen: flags.requiresKitchen,
      recipe: [{ productId: "ing-1", quantity: 1 }],
      productionMode: "BATCH"
    });
    expect(inferProductType(product)).toBe("cocina_receta");
  });

  it("servicio -> trackStock=false, requiresKitchen=false, sin receta", () => {
    const flags = resolveProductFlags("servicio", "ON_DEMAND");
    expect(flags).toEqual({ trackStock: false, requiresKitchen: false, hasRecipe: false });

    const product = buildProduct({
      trackStock: flags.trackStock,
      requiresKitchen: flags.requiresKitchen
    });
    expect(inferProductType(product)).toBe("servicio");
  });

  it("un producto con receta NUNCA se infiere como servicio aunque trackStock sea false", () => {
    // Este es el caso EXACTO del bug: cocina_receta ON_DEMAND se guarda
    // con trackStock=false, y la inferencia anterior lo convertía en servicio.
    const product = buildProduct({
      trackStock: false,
      requiresKitchen: true,
      recipe: [{ productId: "ing-1", quantity: 1 }],
      productionMode: "ON_DEMAND"
    });

    expect(inferProductType(product)).toBe("cocina_receta");
  });

  it("ingrediente se infiere como ingrediente aunque tenga requiresKitchen=true", () => {
    const product = buildProduct({
      trackStock: true,
      requiresKitchen: true,
      isIngredient: true
    });

    expect(inferProductType(product)).toBe("ingrediente");
  });

  it("resolveProductFlags: ingrediente -> trackStock=true, requiresKitchen=false, sin receta", () => {
    const flags = resolveProductFlags("ingrediente", "ON_DEMAND");
    expect(flags).toEqual({ trackStock: true, requiresKitchen: false, hasRecipe: false });

    const product = buildProduct({
      trackStock: flags.trackStock,
      requiresKitchen: flags.requiresKitchen,
      isIngredient: true
    });
    expect(inferProductType(product)).toBe("ingrediente");
  });

  it("crear un ingrediente fuerza requiresKitchen=false y trackStock=true", async () => {
    const { engine } = buildEngine();

    const created = await engine.createProduct({
      name: "Carne",
      categoryId: "cat-insumos",
      price: 30000,
      stock: 20,
      minStock: 5,
      unit: "kg",
      isIngredient: true,
      requiresKitchen: true,
      trackStock: false
    });

    expect(created.isIngredient).toBe(true);
    expect(created.requiresKitchen).toBe(false);
    expect(created.trackStock).toBe(true);
    expect(inferProductType(created)).toBe("ingrediente");
  });
});