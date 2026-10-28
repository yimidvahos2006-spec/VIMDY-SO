// tests/unit/inventario-insumos.test.ts
/* ===========================================================================
   PRUEBAS — Panel de Inventario: insumos (stock, costos, unidades)
   ---------------------------------------------------------------------------
   Todo corre en memoria (tests/fakes), sin Supabase ni red. Prueban las
   mismas reglas que usa el panel de Inventario al crear, comprar y ajustar
   insumos:

     1. Crear un insumo (stock inicial + Kardex "Stock inicial").
     2. Reglas de validación (precio/costo/stock negativos, nombre repetido).
     3. Entradas de stock con costo de compra (actualiza purchasePrice).
     4. Salidas de stock (merma) y protección contra stock negativo manual.
     5. Idempotencia del Kardex (reintento con el mismo movementId).
     6. Alerta de stock bajo.
     7. Conversión de unidades (g/kg/libra, ml/litro) que usa la receta.
     8. Costo por receta usando el costo del insumo (RecipeEngine).
=========================================================================== */

import { beforeEach, describe, expect, it } from "vitest";

import type { InventoryMovement, Product } from "../../src/core/entities/Entities";
import { InventoryEngine } from "../../src/core/engines/InventoryEngine";
import { KardexEngine } from "../../src/core/engines/KardexEngine";
import { RecipeEngine } from "../../src/core/engines/RecipeEngine";
import { compatibleUnits, convertQuantity, normalizeUnit } from "../../src/core/utils/unitConversion";
import { FakeProductRepository } from "../fakes/FakeProductRepository";
import { InMemoryRepository } from "../fakes/InMemoryRepository";

function buildInventory() {
  const movements = new InMemoryRepository<InventoryMovement>("inventory_movements");
  const products = new FakeProductRepository(movements);
  const kardex = new KardexEngine(movements);
  const inventory = new InventoryEngine(products, kardex);
  const recipes = new RecipeEngine(products);
  return { movements, products, kardex, inventory, recipes };
}

type Ctx = ReturnType<typeof buildInventory>;

/** Atajo: crea un insumo igual que lo hace el panel (isIngredient: true). */
function crearInsumo(ctx: Ctx, input: Partial<Product> & { name: string }) {
  return ctx.inventory.createProduct({
    categoryId: "cat-insumos",
    price: 0,
    isIngredient: true,
    ...input
  });
}

describe("Inventario · crear insumo", () => {
  let ctx: Ctx;
  beforeEach(() => {
    ctx = buildInventory();
  });

  it("guarda el insumo con su unidad, stock inicial y mínimo", async () => {
    const carne = await crearInsumo(ctx, {
      name: "Carne molida",
      unit: "kg",
      stock: 10,
      minStock: 2,
      purchasePrice: 28000
    });

    const saved = await ctx.products.findById(carne.id);
    expect(saved).toMatchObject({
      name: "Carne molida",
      unit: "kg",
      stock: 10,
      minStock: 2,
      purchasePrice: 28000,
      isIngredient: true
    });
  });

  it("un insumo nunca va a cocina y siempre controla stock, aunque se pida lo contrario", async () => {
    const pan = await crearInsumo(ctx, {
      name: "Pan de hamburguesa",
      unit: "unidad",
      stock: 20,
      requiresKitchen: true,
      trackStock: false
    });

    expect(pan.requiresKitchen).toBe(false);
    expect(pan.trackStock).toBe(true);
  });

  it("registra el stock inicial en el Kardex con stock antes = 0 y después = inicial", async () => {
    const carne = await crearInsumo(ctx, { name: "Carne molida", unit: "kg", stock: 10 });

    const history = await ctx.kardex.getHistory(carne.id);
    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({
      type: "INCREASE",
      reason: "Stock inicial",
      quantity: 10,
      stockBefore: 0,
      stockAfter: 10
    });
  });

  it("sin stock inicial no inventa movimientos en el Kardex", async () => {
    const queso = await crearInsumo(ctx, { name: "Queso cheddar", unit: "unidad" });
    expect(queso.stock).toBe(0);
    expect(await ctx.kardex.hasMovements(queso.id)).toBe(false);
  });

  it("un insumo creado sin precio de compra queda SIN costo (undefined), no en $0", async () => {
    const tocineta = await crearInsumo(ctx, { name: "Tocineta", unit: "kg" });
    expect(tocineta.purchasePrice).toBeUndefined();
  });
});

describe("Inventario · reglas de validación", () => {
  let ctx: Ctx;
  beforeEach(async () => {
    ctx = buildInventory();
    await crearInsumo(ctx, { name: "Carne molida", unit: "kg", stock: 5 });
  });

  it("rechaza un nombre vacío", async () => {
    await expect(crearInsumo(ctx, { name: "   " })).rejects.toThrow("PRODUCT_NAME_REQUIRED");
  });

  it("rechaza costo, precio, stock inicial y mínimo negativos", async () => {
    await expect(crearInsumo(ctx, { name: "A", purchasePrice: -1 })).rejects.toThrow(/costo/i);
    await expect(crearInsumo(ctx, { name: "B", price: -5 })).rejects.toThrow("PRECIO_INVALIDO");
    await expect(crearInsumo(ctx, { name: "C", stock: -3 })).rejects.toThrow(/stock inicial/i);
    await expect(crearInsumo(ctx, { name: "D", minStock: -1 })).rejects.toThrow(/stock mínimo/i);
  });

  it("rechaza números inválidos (NaN / Infinity)", async () => {
    await expect(crearInsumo(ctx, { name: "E", purchasePrice: Number.NaN })).rejects.toThrow();
    await expect(crearInsumo(ctx, { name: "F", stock: Number.POSITIVE_INFINITY })).rejects.toThrow();
  });

  it("rechaza un insumo repetido ignorando tildes, mayúsculas y espacios", async () => {
    await expect(crearInsumo(ctx, { name: "  CARNE   molida " })).rejects.toThrow("NOMBRE_DUPLICADO");
  });

  it("permite el mismo nombre en un producto de venta y en un insumo (son listas distintas)", async () => {
    const producto = await ctx.inventory.createProduct({
      name: "Carne molida",
      categoryId: "cat-venta",
      price: 15000
    });
    expect(producto.isIngredient).toBe(false);
  });

  it("no deja guardar una receta con ingrediente inexistente, repetido o con cantidad inválida", async () => {
    const carne = (await ctx.inventory.listAll()).find((p) => p.name === "Carne molida")!;

    await expect(
      ctx.inventory.createProduct({
        name: "Plato 1",
        categoryId: "cat-venta",
        price: 10000,
        recipe: [{ productId: "no-existe", quantity: 1 }]
      })
    ).rejects.toThrow("INGREDIENTE_INEXISTENTE");

    await expect(
      ctx.inventory.createProduct({
        name: "Plato 2",
        categoryId: "cat-venta",
        price: 10000,
        recipe: [
          { productId: carne.id, quantity: 0.1 },
          { productId: carne.id, quantity: 0.2 }
        ]
      })
    ).rejects.toThrow("INGREDIENTE_DUPLICADO");

    await expect(
      ctx.inventory.createProduct({
        name: "Plato 3",
        categoryId: "cat-venta",
        price: 10000,
        recipe: [{ productId: carne.id, quantity: 0 }]
      })
    ).rejects.toThrow("INGREDIENTE_CANTIDAD_INVALIDA");
  });
});

describe("Inventario · entradas y salidas de stock", () => {
  let ctx: Ctx;
  let carneId: string;

  beforeEach(async () => {
    ctx = buildInventory();
    const carne = await crearInsumo(ctx, {
      name: "Carne molida",
      unit: "kg",
      stock: 10,
      minStock: 2,
      purchasePrice: 28000
    });
    carneId = carne.id;
  });

  it("una compra suma stock, actualiza el costo de compra y deja Kardex con antes/después", async () => {
    await ctx.inventory.increaseStock(carneId, 5, "Compra", "admin", undefined, 30000);

    const after = await ctx.products.findById(carneId);
    expect(after?.stock).toBe(15);
    expect(after?.purchasePrice).toBe(30000);

    const history = await ctx.kardex.getHistory(carneId);
    const compra = history.find((m) => m.reason === "Compra")!;
    expect(compra).toMatchObject({ type: "INCREASE", quantity: 5, stockBefore: 10, stockAfter: 15 });
  });

  it("acepta cantidades decimales (0,25 kg) sin perder precisión", async () => {
    await ctx.inventory.decreaseStock(carneId, 0.25, "Merma");
    await ctx.inventory.decreaseStock(carneId, 0.25, "Merma");
    expect((await ctx.products.findById(carneId))?.stock).toBeCloseTo(9.5, 9);
  });

  it("una salida (merma) resta stock y registra la categoría de pérdida", async () => {
    await ctx.inventory.decreaseStock(carneId, 3, "Se dañó", "admin", "SPOILAGE" as never);

    expect((await ctx.products.findById(carneId))?.stock).toBe(7);
    const history = await ctx.kardex.getHistory(carneId);
    const salida = history.find((m) => m.type === "DECREASE")!;
    expect(salida).toMatchObject({ quantity: 3, stockBefore: 10, stockAfter: 7, lossCategory: "SPOILAGE" });
  });

  it("no permite sacar más de lo que hay (INSUFFICIENT_STOCK) y no toca el Kardex", async () => {
    await expect(ctx.inventory.decreaseStock(carneId, 11, "Merma")).rejects.toThrow("INSUFFICIENT_STOCK");

    expect((await ctx.products.findById(carneId))?.stock).toBe(10);
    const history = await ctx.kardex.getHistory(carneId);
    expect(history.filter((m) => m.type === "DECREASE")).toHaveLength(0);
  });

  it("rechaza cantidades negativas o inválidas y no hace nada con 0", async () => {
    await expect(ctx.inventory.increaseStock(carneId, -1, "x")).rejects.toThrow("INVALID_STOCK_QUANTITY");
    await expect(ctx.inventory.decreaseStock(carneId, Number.NaN, "x")).rejects.toThrow("INVALID_STOCK_QUANTITY");
    await expect(ctx.inventory.increaseStock(carneId, 0, "x")).resolves.toBeUndefined();
    expect((await ctx.products.findById(carneId))?.stock).toBe(10);
  });

  it("un precio de compra inválido en la entrada no cambia el stock", async () => {
    await expect(
      ctx.inventory.increaseStock(carneId, 5, "Compra", "admin", undefined, -100)
    ).rejects.toThrow("PURCHASE_PRICE_INVALID");
    expect((await ctx.products.findById(carneId))?.stock).toBe(10);
  });

  it("falla con PRODUCT_NOT_FOUND si el insumo no existe", async () => {
    await expect(ctx.inventory.increaseStock("fantasma", 1, "x")).rejects.toThrow("PRODUCT_NOT_FOUND");
  });

  it("reintentar la misma entrada con el mismo movementId NO duplica el stock (idempotencia)", async () => {
    await ctx.inventory.increaseStock(carneId, 5, "Compra", "admin", undefined, undefined, "mov-1");
    await ctx.inventory.increaseStock(carneId, 5, "Compra", "admin", undefined, undefined, "mov-1");

    expect((await ctx.products.findById(carneId))?.stock).toBe(15);
    const history = await ctx.kardex.getHistory(carneId);
    expect(history.filter((m) => m.id === "mov-1")).toHaveLength(1);
  });
});

describe("Inventario · alerta de stock bajo", () => {
  it("lista los insumos con stock igual o por debajo del mínimo, y no los demás", async () => {
    const ctx = buildInventory();
    await crearInsumo(ctx, { name: "Carne molida", unit: "kg", stock: 10, minStock: 2 });
    await crearInsumo(ctx, { name: "Pan", unit: "unidad", stock: 3, minStock: 5 });
    await crearInsumo(ctx, { name: "Queso", unit: "unidad", stock: 5, minStock: 5 });
    await crearInsumo(ctx, { name: "Sal", unit: "kg", stock: 0, minStock: 0, active: false });

    const low = (await ctx.inventory.getLowStockProducts()).map((p) => p.name).sort();
    expect(low).toEqual(["Pan", "Queso"]);
  });
});

describe("Inventario · conversión de unidades", () => {
  it("convierte dentro de la misma familia (masa y volumen)", () => {
    expect(convertQuantity(150, "g", "kg")).toBe(0.15);
    expect(convertQuantity(2, "kg", "g")).toBe(2000);
    expect(convertQuantity(1, "libra", "g")).toBe(500);
    expect(convertQuantity(250, "ml", "litro")).toBe(0.25);
    expect(convertQuantity(2, "litro", "ml")).toBe(2000);
  });

  it("no arrastra basura de punto flotante (120 g -> 0,12 kg exacto)", () => {
    expect(convertQuantity(120, "g", "kg")).toBe(0.12);
    expect(convertQuantity(30, "g", "kg")).toBe(0.03);
  });

  it("NO convierte entre familias distintas ni con unidades sueltas", () => {
    expect(convertQuantity(100, "g", "litro")).toBeNull();
    expect(convertQuantity(1, "unidad", "kg")).toBeNull();
    expect(convertQuantity(Number.NaN, "g", "kg")).toBeNull();
  });

  it("la misma unidad devuelve la misma cantidad, incluso para unidades no medibles", () => {
    expect(convertQuantity(3, "unidad", "unidad")).toBe(3);
    expect(convertQuantity(2, "paquete", "paquete")).toBe(2);
  });

  it("entiende alias comunes en español", () => {
    expect(normalizeUnit("Kilos")).toBe("kg");
    expect(normalizeUnit("gr")).toBe("g");
    expect(normalizeUnit("LBS")).toBe("libra");
    expect(normalizeUnit("lt")).toBe("litro");
    expect(normalizeUnit("und")).toBe("unidad");
    expect(normalizeUnit("")).toBe("unidad");
    expect(normalizeUnit(undefined)).toBe("unidad");
    expect(convertQuantity(500, "gramos", "kilos")).toBe(0.5);
  });

  it("compatibleUnits ofrece solo unidades de la misma clase que el insumo", () => {
    expect(compatibleUnits("kg")).toEqual(["g", "kg", "libra"]);
    expect(compatibleUnits("litro")).toEqual(["ml", "litro"]);
    expect(compatibleUnits("unidad")).toEqual(["unidad"]);
  });
});

describe("Inventario · costo de receta a partir del costo del insumo", () => {
  it("costo = costo del insumo × cantidad en la unidad del insumo (150 g de carne a $28.000/kg = $4.200)", async () => {
    const ctx = buildInventory();
    const carne = await crearInsumo(ctx, { name: "Carne molida", unit: "kg", stock: 10, purchasePrice: 28000 });
    const pan = await crearInsumo(ctx, { name: "Pan", unit: "unidad", stock: 20, purchasePrice: 800 });

    const burger = await ctx.inventory.createProduct({
      name: "Hamburguesa",
      categoryId: "cat-venta",
      price: 18000,
      recipe: [
        { productId: carne.id, quantity: convertQuantity(150, "g", "kg")! },
        { productId: pan.id, quantity: 1 }
      ]
    });

    const all = new Map((await ctx.products.findAll()).map((p) => [p.id, p]));
    const cost = ctx.recipes.getRecipeCost(burger, all)!;
    expect(cost.totalCost).toBeCloseTo(4200 + 800, 6);
    expect(cost.missingCostIngredients).toEqual([]);

    const profit = ctx.recipes.getProfitability(burger, all);
    expect(profit.profit).toBeCloseTo(18000 - 5000, 6);
    expect(profit.costUnreliable).toBe(false);
  });

  it("un insumo sin costo marca el costo como NO confiable, en vez de asumir $0", async () => {
    const ctx = buildInventory();
    const carne = await crearInsumo(ctx, { name: "Carne molida", unit: "kg", stock: 10, purchasePrice: 28000 });
    const tocineta = await crearInsumo(ctx, { name: "Tocineta", unit: "kg", stock: 2 });

    const burger = await ctx.inventory.createProduct({
      name: "Hamburguesa",
      categoryId: "cat-venta",
      price: 18000,
      recipe: [
        { productId: carne.id, quantity: 0.15 },
        { productId: tocineta.id, quantity: 0.03 }
      ]
    });

    const all = new Map((await ctx.products.findAll()).map((p) => [p.id, p]));
    const cost = ctx.recipes.getRecipeCost(burger, all)!;
    expect(cost.missingCostIngredients).toEqual(["Tocineta"]);
    expect(ctx.recipes.getProfitability(burger, all).costUnreliable).toBe(true);
  });

  it("al cargar el costo del insumo con una compra, el costo de la receta deja de ser dudoso", async () => {
    const ctx = buildInventory();
    const tocineta = await crearInsumo(ctx, { name: "Tocineta", unit: "kg", stock: 0 });
    const plato = await ctx.inventory.createProduct({
      name: "Perro",
      categoryId: "cat-venta",
      price: 12000,
      recipe: [{ productId: tocineta.id, quantity: 0.05 }]
    });

    await ctx.inventory.increaseStock(tocineta.id, 2, "Compra", "admin", undefined, 40000);

    const all = new Map((await ctx.products.findAll()).map((p) => [p.id, p]));
    expect(ctx.recipes.getProfitability(plato, all)).toMatchObject({ cost: 2000, costUnreliable: false });
  });
});