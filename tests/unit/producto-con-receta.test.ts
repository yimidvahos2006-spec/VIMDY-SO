// tests/unit/producto-con-receta.test.ts
/* ===========================================================================
   PRUEBAS — Crear un producto con receta (la hamburguesa)
   ---------------------------------------------------------------------------
   Todo en memoria (tests/fakes), sin Supabase. Sigue el mismo camino que el
   formulario de producto:

     1. Las filas de la receta se validan (findRecipeRowProblem) y se
        convierten a la unidad del insumo (150 g -> 0,15 kg).
     2. InventoryEngine.createProduct guarda el producto con su receta.
     3. RecipeEngine calcula costo, margen y cuántas hamburguesas se pueden
        preparar con el stock actual (y qué insumo limita).
     4. Al vender, se descuentan los INSUMOS (no la hamburguesa) y el Kardex
        lo registra.
     5. Editar la receta / quitarla.
     6. Tamaños y extras con receta propia.

   NOTA: `filasARecetaComoElFormulario` copia la conversión que hace
   ProductFormModal al guardar (la lógica vive dentro del componente React y
   el entorno de pruebas es "node", sin DOM). Si cambias esa conversión en el
   formulario, cambia también este helper.
=========================================================================== */

import { beforeEach, describe, expect, it } from "vitest";

import type { InventoryMovement, Product, RecipeItem } from "../../src/core/entities/Entities";
import { InventoryEngine } from "../../src/core/engines/InventoryEngine";
import { KardexEngine } from "../../src/core/engines/KardexEngine";
import { RecipeEngine } from "../../src/core/engines/RecipeEngine";
import { convertQuantity, normalizeUnit } from "../../src/core/utils/unitConversion";
import { parseDecimalInput } from "../../src/presentation/components/inventory/importHelpers";
import {
  findRecipeRowProblem,
  sanitizeQuantityInput
} from "../../src/presentation/components/inventory/recipeFormHelpers";
import { FakeProductRepository } from "../fakes/FakeProductRepository";
import { InMemoryRepository } from "../fakes/InMemoryRepository";

interface RecipeRow {
  rowId: string;
  productId: string;
  quantity: string;
  unit: string;
  optional: boolean;
}

/** Copia de la conversión de ProductFormModal.handleSubmit (ver nota arriba). */
function filasARecetaComoElFormulario(rows: RecipeRow[], allProducts: Product[]): RecipeItem[] | { error: string } {
  const nameOf = (id: string) => allProducts.find((p) => p.id === id)?.name ?? "un ingrediente";
  const problem = findRecipeRowProblem(rows, nameOf);
  if (problem) return { error: problem.message };

  const items: RecipeItem[] = [];
  for (const row of rows.filter((r) => r.productId)) {
    const typed = parseDecimalInput(row.quantity);
    const ingredient = allProducts.find((p) => p.id === row.productId);
    const converted = convertQuantity(typed, row.unit || ingredient?.unit, ingredient?.unit);
    if (converted === null || converted <= 0) {
      return { error: `La unidad elegida para "${ingredient?.name}" no se puede convertir.` };
    }
    const item: RecipeItem = { productId: row.productId, quantity: converted, optional: row.optional };
    items.push(
      row.unit && normalizeUnit(row.unit) !== normalizeUnit(ingredient?.unit)
        ? { ...item, entryQuantity: typed, entryUnit: row.unit }
        : item
    );
  }
  return items;
}

const row = (productId: string, quantity: string, unit = "", optional = false): RecipeRow => ({
  rowId: `row-${productId}`,
  productId,
  quantity,
  unit,
  optional
});

function buildWorld() {
  const movements = new InMemoryRepository<InventoryMovement>("inventory_movements");
  const products = new FakeProductRepository(movements);
  const kardex = new KardexEngine(movements);
  const inventory = new InventoryEngine(products, kardex);
  const recipes = new RecipeEngine(products);
  return { products, kardex, inventory, recipes };
}

type World = ReturnType<typeof buildWorld>;

async function sembrarInsumos(w: World) {
  const make = (input: Partial<Product> & { name: string }) =>
    w.inventory.createProduct({ categoryId: "cat-insumos", isIngredient: true, ...input });

  const carne = await make({ name: "Carne molida", unit: "kg", stock: 3, minStock: 0.5, purchasePrice: 28000 });
  const pan = await make({ name: "Pan de hamburguesa", unit: "unidad", stock: 40, minStock: 5, purchasePrice: 800 });
  const queso = await make({ name: "Queso cheddar", unit: "unidad", stock: 30, minStock: 5, purchasePrice: 500 });
  const tocineta = await make({ name: "Tocineta", unit: "kg", stock: 1, minStock: 0.2, purchasePrice: 40000 });
  return { carne, pan, queso, tocineta };
}

describe("Receta · del formulario a un producto guardado", () => {
  let w: World;
  let ins: Awaited<ReturnType<typeof sembrarInsumos>>;

  beforeEach(async () => {
    w = buildWorld();
    ins = await sembrarInsumos(w);
  });

  async function crearHamburguesa(extra: Partial<Product> = {}) {
    const all = await w.products.findAll();
    const receta = filasARecetaComoElFormulario(
      [
        row(ins.carne.id, "150", "g"),
        row(ins.pan.id, "1"),
        row(ins.queso.id, "1"),
        row(ins.tocineta.id, "30", "g", true)
      ],
      all
    ) as RecipeItem[];

    return w.inventory.createProduct({
      name: "Hamburguesa clásica",
      categoryId: "cat-hamburguesas",
      price: 18000,
      requiresKitchen: true,
      recipe: receta,
      productionMode: "ON_DEMAND",
      ...extra
    });
  }

  it("convierte 150 g de carne a 0,15 kg y recuerda lo que escribió la persona", async () => {
    const all = await w.products.findAll();
    const receta = filasARecetaComoElFormulario([row(ins.carne.id, "150", "g")], all) as RecipeItem[];

    expect(receta).toEqual([
      { productId: ins.carne.id, quantity: 0.15, optional: false, entryQuantity: 150, entryUnit: "g" }
    ]);
  });

  it("acepta coma decimal y la misma unidad del insumo sin guardar entryUnit", async () => {
    const all = await w.products.findAll();
    const receta = filasARecetaComoElFormulario([row(ins.carne.id, "0,2")], all) as RecipeItem[];

    expect(receta[0]).toEqual({ productId: ins.carne.id, quantity: 0.2, optional: false });
  });

  it("bloquea el guardado si no hay ingredientes, hay repetidos o falta la cantidad", async () => {
    const all = await w.products.findAll();

    expect(filasARecetaComoElFormulario([], all)).toMatchObject({ error: expect.stringMatching(/al menos un ingrediente/i) });
    expect(
      filasARecetaComoElFormulario([row(ins.pan.id, "1"), { ...row(ins.pan.id, "2"), rowId: "otra" }], all)
    ).toMatchObject({ error: expect.stringMatching(/repetido/i) });
    expect(filasARecetaComoElFormulario([row(ins.pan.id, "")], all)).toMatchObject({
      error: expect.stringMatching(/cantidad/i)
    });
    expect(filasARecetaComoElFormulario([row(ins.pan.id, "0")], all)).toMatchObject({
      error: expect.stringMatching(/cantidad/i)
    });
  });

  it("no deja convertir unidades de otra clase (g contra un insumo en unidades)", async () => {
    const all = await w.products.findAll();
    expect(filasARecetaComoElFormulario([row(ins.pan.id, "100", "g")], all)).toMatchObject({
      error: expect.stringMatching(/no se puede convertir/i)
    });
  });

  it("el campo de cantidad descarta la letra 'e' y otros caracteres (bug de '150e')", () => {
    expect(sanitizeQuantityInput("150e")).toBe("150");
    expect(sanitizeQuantityInput("1e3")).toBe("13");
    expect(sanitizeQuantityInput("-5")).toBe("5");
    expect(sanitizeQuantityInput("0,1,5")).toBe("0,15");
    expect(sanitizeQuantityInput("12.5.3")).toBe("12.53");
  });

  it("guarda la hamburguesa con su receta, precio y que requiere cocina", async () => {
    const burger = await crearHamburguesa();
    const saved = await w.products.findById(burger.id);

    expect(saved).toMatchObject({
      name: "Hamburguesa clásica",
      price: 18000,
      requiresKitchen: true,
      isIngredient: false,
      stock: 0
    });
    expect(saved?.recipe).toHaveLength(4);
    expect(saved?.recipe?.find((r) => r.productId === ins.carne.id)?.quantity).toBe(0.15);
    expect(saved?.recipe?.find((r) => r.productId === ins.tocineta.id)?.optional).toBe(true);
  });

  it("crear el producto NO mueve el stock de los insumos ni escribe en su Kardex", async () => {
    const before = (await w.products.findAll()).map((p) => [p.id, p.stock]);
    const movesBefore = (await w.kardex.getAllMovements()).length;

    await crearHamburguesa();

    for (const [id, stock] of before) {
      expect((await w.products.findById(id as string))?.stock).toBe(stock);
    }
    expect((await w.kardex.getAllMovements()).length).toBe(movesBefore);
  });

  it("rechaza crear dos hamburguesas con el mismo nombre", async () => {
    await crearHamburguesa();
    await expect(crearHamburguesa()).rejects.toThrow("NOMBRE_DUPLICADO");
  });
});

describe("Receta · costo, margen y capacidad de producción", () => {
  let w: World;
  let ins: Awaited<ReturnType<typeof sembrarInsumos>>;
  let burger: Product;

  beforeEach(async () => {
    w = buildWorld();
    ins = await sembrarInsumos(w);
    burger = await w.inventory.createProduct({
      name: "Hamburguesa clásica",
      categoryId: "cat-hamburguesas",
      price: 18000,
      requiresKitchen: true,
      recipe: [
        { productId: ins.carne.id, quantity: 0.15 },
        { productId: ins.pan.id, quantity: 1 },
        { productId: ins.queso.id, quantity: 1 }
      ]
    });
  });

  const mapa = async () => new Map((await w.products.findAll()).map((p) => [p.id, p]));

  it("costo = 0,15 kg × 28.000 + 1 pan × 800 + 1 queso × 500 = $5.500; margen sobre $18.000", async () => {
    const profit = w.recipes.getProfitability(burger, await mapa());
    expect(profit.cost).toBeCloseTo(5500, 6);
    expect(profit.profit).toBeCloseTo(12500, 6);
    expect(profit.marginPercent).toBeCloseTo((12500 / 18000) * 100, 6);
    expect(profit.costUnreliable).toBe(false);
  });

  it("capacidad: con 3 kg de carne, 40 panes y 30 quesos alcanzan 20 hamburguesas y la carne limita", async () => {
    const capacity = w.recipes.getProductionCapacity(burger, await mapa())!;
    expect(capacity.maxUnits).toBe(20);
    expect(capacity.limitingIngredient?.name).toBe("Carne molida");
  });

  it("estado de producción: DISPONIBLE / OK con stock sano", async () => {
    const status = w.recipes.getProductionStatus(burger, await mapa())!;
    expect(status).toMatchObject({ status: "DISPONIBLE", maxUnits: 20, level: "OK", costUnreliable: false });
  });

  it("si se acaba un insumo, el estado pasa a AGOTADO / CRITICO", async () => {
    await w.inventory.decreaseStock(ins.queso.id, 30, "Merma");
    const status = w.recipes.getProductionStatus(burger, await mapa())!;
    expect(status).toMatchObject({ status: "AGOTADO", maxUnits: 0, level: "CRITICO" });
    expect(status.limitingIngredient?.name).toBe("Queso cheddar");
  });

  it("un producto sin receta no tiene capacidad de producción", async () => {
    const gaseosa = await w.inventory.createProduct({ name: "Gaseosa", categoryId: "cat-bebidas", price: 4000, stock: 10 });
    expect(w.recipes.getProductionCapacity(gaseosa, await mapa())).toBeNull();
  });
});

describe("Receta · venta descuenta insumos", () => {
  let w: World;
  let ins: Awaited<ReturnType<typeof sembrarInsumos>>;
  let burger: Product;

  beforeEach(async () => {
    w = buildWorld();
    ins = await sembrarInsumos(w);
    burger = await w.inventory.createProduct({
      name: "Hamburguesa clásica",
      categoryId: "cat-hamburguesas",
      price: 18000,
      recipe: [
        { productId: ins.carne.id, quantity: 0.15 },
        { productId: ins.pan.id, quantity: 1 },
        { productId: ins.queso.id, quantity: 1 }
      ]
    });
  });

  it("vender 2 hamburguesas descuenta 0,3 kg de carne, 2 panes y 2 quesos; la hamburguesa queda en 0", async () => {
    await w.inventory.consumeForSale([{ productId: burger.id, quantity: 2 }]);

    expect((await w.products.findById(ins.carne.id))?.stock).toBeCloseTo(2.7, 9);
    expect((await w.products.findById(ins.pan.id))?.stock).toBe(38);
    expect((await w.products.findById(ins.queso.id))?.stock).toBe(28);
    expect((await w.products.findById(burger.id))?.stock).toBe(0);
  });

  it("deja el Kardex de cada insumo con motivo, cantidad y stock antes/después", async () => {
    await w.inventory.consumeForSale([{ productId: burger.id, quantity: 2 }], "SALE");

    const carneMoves = await w.kardex.getHistory(ins.carne.id);
    const salida = carneMoves.find((m) => m.type === "DECREASE")!;
    expect(salida.reason).toBe("SALE");
    expect(salida.quantity).toBeCloseTo(0.3, 9);
    expect(salida.stockBefore).toBe(3);
    expect(salida.stockAfter).toBeCloseTo(2.7, 9);

    expect(await w.kardex.getHistory(burger.id)).toHaveLength(0);
  });

  it("previsualizar la venta calcula lo mismo sin tocar el stock", async () => {
    const preview = w.inventory.previewSaleConsumption(
      [{ productId: burger.id, quantity: 3 }],
      await w.products.findAll()
    );

    expect(preview.get(ins.carne.id)).toBeCloseTo(0.45, 9);
    expect(preview.get(ins.pan.id)).toBe(3);
    expect(preview.has(burger.id)).toBe(false);
    expect((await w.products.findById(ins.carne.id))?.stock).toBe(3);
  });

  it("anular la venta (restoreForSale) devuelve los insumos", async () => {
    await w.inventory.consumeForSale([{ productId: burger.id, quantity: 2 }]);
    await w.inventory.restoreForSale([{ productId: burger.id, quantity: 2 }]);

    expect((await w.products.findById(ins.carne.id))?.stock).toBeCloseTo(3, 9);
    expect((await w.products.findById(ins.pan.id))?.stock).toBe(40);
  });

  it("rechaza cantidades de venta inválidas", async () => {
    await expect(w.inventory.consumeForSale([{ productId: burger.id, quantity: 0 }])).rejects.toThrow(
      "INVALID_SALE_QUANTITY"
    );
    await expect(w.inventory.consumeForSale([{ productId: "no-existe", quantity: 1 }])).rejects.toThrow(
      "PRODUCT_NOT_FOUND"
    );
  });
});

describe("Receta · editar y quitar", () => {
  let w: World;
  let ins: Awaited<ReturnType<typeof sembrarInsumos>>;
  let burger: Product;

  beforeEach(async () => {
    w = buildWorld();
    ins = await sembrarInsumos(w);
    burger = await w.inventory.createProduct({
      name: "Hamburguesa clásica",
      categoryId: "cat-hamburguesas",
      price: 18000,
      recipe: [
        { productId: ins.carne.id, quantity: 0.15 },
        { productId: ins.pan.id, quantity: 1 }
      ]
    });
  });

  it("cambiar la receta actualiza los ingredientes pero no toca el stock del producto", async () => {
    const updated = await w.inventory.updateProduct(burger.id, {
      name: "Hamburguesa clásica",
      categoryId: "cat-hamburguesas",
      price: 19000,
      stock: 999,
      recipe: [
        { productId: ins.carne.id, quantity: 0.2 },
        { productId: ins.pan.id, quantity: 1 },
        { productId: ins.queso.id, quantity: 1 }
      ]
    });

    expect(updated.recipe).toHaveLength(3);
    expect(updated.price).toBe(19000);
    expect(updated.stock).toBe(0);
  });

  it("enviar recipe: [] borra la receta", async () => {
    const updated = await w.inventory.updateProduct(burger.id, {
      name: "Hamburguesa clásica",
      categoryId: "cat-hamburguesas",
      price: 18000,
      recipe: []
    });
    expect(updated.recipe).toBeUndefined();
    expect((await w.products.findById(burger.id))?.recipe).toBeUndefined();
  });

  it("un producto no puede usarse a sí mismo en su receta", async () => {
    await expect(
      w.inventory.updateProduct(burger.id, {
        name: "Hamburguesa clásica",
        categoryId: "cat-hamburguesas",
        price: 18000,
        recipe: [{ productId: burger.id, quantity: 1 }]
      })
    ).rejects.toThrow(/a sí mismo/i);
  });

  it("editar sin cambiar el nombre no se confunde con 'nombre duplicado'", async () => {
    await expect(
      w.inventory.updateProduct(burger.id, { name: "Hamburguesa clásica", categoryId: "cat-hamburguesas", price: 18500 })
    ).resolves.toMatchObject({ price: 18500 });
  });
});

describe("Receta · tamaños y extras con receta propia", () => {
  it("la receta del tamaño reemplaza a la base y los extras se suman, tanto en costo como en descuento de stock", async () => {
    const w = buildWorld();
    const ins = await sembrarInsumos(w);

    const doble = {
      id: "size-doble",
      name: "Doble",
      priceDelta: 6000,
      recipe: [
        { productId: ins.carne.id, quantity: 0.3 },
        { productId: ins.pan.id, quantity: 1 }
      ]
    };
    const conTocineta = {
      id: "extra-tocineta",
      name: "Tocineta",
      priceDelta: 3000,
      recipe: [{ productId: ins.tocineta.id, quantity: 0.03 }]
    };

    const burger = await w.inventory.createProduct({
      name: "Hamburguesa clásica",
      categoryId: "cat-hamburguesas",
      price: 18000,
      recipe: [
        { productId: ins.carne.id, quantity: 0.15 },
        { productId: ins.pan.id, quantity: 1 }
      ],
      sizes: [doble],
      extras: [conTocineta]
    });

    const all = new Map((await w.products.findAll()).map((p) => [p.id, p]));

    // Costo: base = 0,15×28000 + 800 = 5000. Doble + tocineta = 0,3×28000 + 800 + 0,03×40000 = 10400.
    expect(w.recipes.getRecipeCost(burger, all)!.totalCost).toBeCloseTo(5000, 6);
    expect(w.recipes.getRecipeCost(burger, all, doble, [conTocineta])!.totalCost).toBeCloseTo(10400, 6);

    await w.inventory.consumeForSale([
      { productId: burger.id, quantity: 1, selectedSize: doble, selectedExtras: [conTocineta] }
    ]);

    expect((await w.products.findById(ins.carne.id))?.stock).toBeCloseTo(2.7, 9);
    expect((await w.products.findById(ins.tocineta.id))?.stock).toBeCloseTo(0.97, 9);
    expect((await w.products.findById(ins.pan.id))?.stock).toBe(39);
  });
});