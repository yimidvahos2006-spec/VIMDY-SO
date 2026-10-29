// tests/unit/insumos-tabla-y-venta-directa.test.ts
/* ===========================================================================
   PRUEBAS — Módulo de Insumos: tabla clara y sin venta directa
   ---------------------------------------------------------------------------
     1. Un insumo nunca guarda código de barras ni precio de venta (crear,
        editar y limpiar uno viejo), y su barcode no choca con el de un producto.
     2. "Se usa en": receta base + tamaños + extras, sin repetir ni contar
        platos desactivados.
     3. Cantidades legibles: sin ruido de coma flotante y con su unidad.
     4. Categorías automáticas: A-Z y "Sin categoría" al final.
=========================================================================== */

import { beforeEach, describe, expect, it } from "vitest";

import type { InventoryMovement, Product } from "../../src/core/entities/Entities";
import { InventoryEngine } from "../../src/core/engines/InventoryEngine";
import { KardexEngine } from "../../src/core/engines/KardexEngine";
import { buildInsumoUsage } from "../../src/core/utils/insumoUsage";
import { formatInsumoAmount, formatInsumoQuantity, insumoUnitLabel } from "../../src/core/utils/insumoDisplay";
import { groupInsumosByCategory, NO_CATEGORY_LABEL } from "../../src/core/utils/insumoGrouping";
import { FakeProductRepository } from "../fakes/FakeProductRepository";
import { InMemoryRepository } from "../fakes/InMemoryRepository";

function buildInventory() {
  const movements = new InMemoryRepository<InventoryMovement>("inventory_movements");
  const products = new FakeProductRepository(movements);
  const kardex = new KardexEngine(movements);
  const inventory = new InventoryEngine(products, kardex);
  return { products, inventory };
}

function prod(partial: Partial<Product> & { id: string; name: string }): Product {
  return { categoryId: "c", price: 0, stock: 0, minStock: 0, active: true, ...partial } as Product;
}

describe("Insumos · nunca se venden sueltos", () => {
  let ctx: ReturnType<typeof buildInventory>;
  beforeEach(() => {
    ctx = buildInventory();
  });

  it("al crear, descarta código de barras y precio de venta", async () => {
    const carne = await ctx.inventory.createProduct({
      name: "Carne molida",
      categoryId: "cat-insumos",
      unit: "kg",
      price: 25000,
      barcode: "7701234567890",
      isIngredient: true
    });
    const saved = await ctx.products.findById(carne.id);
    expect(saved?.barcode).toBeUndefined();
    expect(saved?.price).toBe(0);
    expect(saved?.isIngredient).toBe(true);
  });

  it("al editar, limpia un código de barras que ya tuviera", async () => {
    const harina = await ctx.inventory.createProduct({ name: "Harina", categoryId: "c", unit: "kg", isIngredient: true });
    await ctx.products.update({ ...harina, barcode: "111", price: 5000 } as Product);

    await ctx.inventory.updateProduct(harina.id, { name: "Harina", categoryId: "c", unit: "kg", isIngredient: true });
    const saved = await ctx.products.findById(harina.id);
    expect(saved?.barcode).toBeUndefined();
    expect(saved?.price).toBe(0);
  });

  it("el código de barras de un insumo no estorba al de un producto de venta", async () => {
    await ctx.inventory.createProduct({ name: "Gaseosa", categoryId: "c", price: 3000, barcode: "770", isIngredient: false });
    await expect(
      ctx.inventory.createProduct({ name: "Azúcar", categoryId: "c", unit: "kg", barcode: "770", isIngredient: true })
    ).resolves.toMatchObject({ name: "Azúcar" });
  });

  it("un producto de venta SÍ conserva su código de barras", async () => {
    const soda = await ctx.inventory.createProduct({ name: "Soda", categoryId: "c", price: 2500, barcode: "123", isIngredient: false });
    expect((await ctx.products.findById(soda.id))?.barcode).toBe("123");
  });
});

describe("Insumos · en qué platos se usa", () => {
  it("junta receta base, tamaños y extras sin repetir", () => {
    const queso = prod({ id: "queso", name: "Queso", isIngredient: true });
    const pizza = prod({
      id: "pizza",
      name: "Pizza",
      price: 20000,
      recipe: [{ productId: "queso", quantity: 0.1 }],
      sizes: [{ id: "g", name: "Grande", priceDelta: 5000, recipe: [{ productId: "queso", quantity: 0.2 }] }]
    });
    const pan = prod({
      id: "pan",
      name: "Pan de queso",
      price: 3000,
      extras: [{ id: "e", name: "Extra queso", priceDelta: 1000, recipe: [{ productId: "queso", quantity: 0.05 }] }]
    });

    expect(buildInsumoUsage([queso, pizza, pan]).get("queso")).toEqual(["Pan de queso", "Pizza"]);
  });

  it("ignora platos desactivados e insumos que usan otros insumos", () => {
    const sal = prod({ id: "sal", name: "Sal", isIngredient: true });
    const viejo = prod({ id: "v", name: "Plato viejo", price: 1, active: false, recipe: [{ productId: "sal", quantity: 1 }] });
    const mezcla = prod({ id: "m", name: "Mezcla", isIngredient: true, recipe: [{ productId: "sal", quantity: 1 }] });
    expect(buildInsumoUsage([sal, viejo, mezcla]).get("sal")).toBeUndefined();
  });
});

describe("Insumos · cantidades legibles", () => {
  it("quita el ruido de coma flotante", () => {
    expect(formatInsumoQuantity(9.120000000000001)).toBe("9,12");
    expect(formatInsumoQuantity(0.1 + 0.2)).toBe("0,3");
    expect(formatInsumoQuantity(-0)).toBe("0");
  });

  it("usa la unidad correcta en singular y plural", () => {
    expect(formatInsumoAmount(12.5, "kg")).toBe("12,5 kg");
    expect(formatInsumoAmount(1, "litro")).toBe("1 litro");
    expect(formatInsumoAmount(2, "lt")).toBe("2 litros");
    expect(formatInsumoAmount(3, "unidad")).toBe("3 unidades");
    expect(formatInsumoAmount(1, undefined)).toBe("1 unidad");
    expect(insumoUnitLabel("g", 1)).toBe("g");
  });
});

describe("Insumos · categorías automáticas", () => {
  it("ordena A-Z, deja 'Sin categoría' al final y ordena los insumos por nombre", () => {
    const cats = [
      { id: "v", name: "Verduras" },
      { id: "c", name: "Carnes" }
    ];
    const groups = groupInsumosByCategory(
      [
        prod({ id: "1", name: "Tomate", categoryId: "v", isIngredient: true }),
        prod({ id: "2", name: "Res", categoryId: "c", isIngredient: true }),
        prod({ id: "3", name: "Misterio", categoryId: "borrada", isIngredient: true }),
        prod({ id: "4", name: "Cebolla", categoryId: "v", isIngredient: true })
      ],
      cats
    );
    expect(groups.map((g) => g.name)).toEqual(["Carnes", "Verduras", NO_CATEGORY_LABEL]);
    expect(groups[1].items.map((i) => i.name)).toEqual(["Cebolla", "Tomate"]);
  });
});