// tests/unit/purchaseIntelligenceEngine.test.ts
/* ===========================================================================
   Compras Inteligentes — consumo REAL a partir de ventas y recetas.
   Usa el InventoryEngine real (la misma expansión de recetas que descuenta el
   stock en Caja) con repositorios en memoria, sin tocar Supabase.
=========================================================================== */

import { beforeEach, describe, expect, it } from "vitest";

import type { Product, Sale, SaleItem } from "../../src/core/entities/Entities";
import { InventoryEngine } from "../../src/core/engines/InventoryEngine";
import { PurchaseIntelligenceEngine } from "../../src/core/engines/PurchaseIntelligenceEngine";

import { FakeProductRepository } from "../fakes/FakeProductRepository";
import { InMemoryRepository } from "../fakes/InMemoryRepository";

const NOW = new Date("2026-10-29T12:00:00Z");
const DAY = 24 * 60 * 60 * 1000;

function daysAgo(days: number): Date {
  return new Date(NOW.getTime() - days * DAY);
}

function product(overrides: Partial<Product> & { id: string }): Product {
  return {
    name: overrides.id,
    categoryId: "cat",
    price: 1000,
    stock: 0,
    minStock: 0,
    unit: "kg",
    lastUpdated: NOW,
    ...overrides
  } as Product;
}

let saleCounter = 0;

function sale(items: SaleItem[], ageDays: number, overrides: Partial<Sale> = {}): Sale {
  saleCounter += 1;
  return {
    id: `sale-${saleCounter}`,
    customerId: "CLIENTE_GENERAL",
    items,
    total: items.reduce((sum, item) => sum + item.price * item.quantity, 0),
    status: "PAID",
    createdAt: daysAgo(ageDays),
    updatedAt: daysAgo(ageDays),
    ...overrides
  } as Sale;
}

function line(productId: string, quantity: number, extra: Partial<SaleItem> = {}): SaleItem {
  return { productId, quantity, price: 1000, ...extra };
}

/**
 * Venta "ancla" de un servicio sin stock, de hace 6,5 días: no consume nada,
 * pero hace que el negocio lleve una semana completa vendiendo (si no, el
 * promedio diario se calcula con los días que lleva operando).
 */
const WEEK_ANCHOR_PRODUCT = product({ id: "servicio-ancla", trackStock: false });
function weekAnchor(): Sale {
  return sale([line("servicio-ancla", 1)], 6.5);
}

async function setup(products: Product[], sales: Sale[]) {
  const productRepo = new FakeProductRepository();
  for (const item of products) await productRepo.save(item);
  const saleRepo = new InMemoryRepository<Sale>("sales");
  for (const item of sales) await saleRepo.save(item);

  const engine = new PurchaseIntelligenceEngine(new InventoryEngine(productRepo), saleRepo);
  return { engine };
}

function byId(recommendations: { productId: string }[]) {
  return Object.fromEntries(recommendations.map((rec) => [rec.productId, rec])) as Record<string, any>;
}

describe("consumo directo y por recetas", () => {
  it("un producto vendido suelto consume su propio stock", async () => {
    const { engine } = await setup(
      [product({ id: "gaseosa", name: "Gaseosa", unit: "und", stock: 10 }), WEEK_ANCHOR_PRODUCT],
      [weekAnchor(), sale([line("gaseosa", 35)], 1), sale([line("gaseosa", 35)], 3)]
    );

    const { recommendations } = await engine.analyze(NOW);
    const rec = byId(recommendations).gaseosa;

    expect(rec.dailyConsumption).toBe(10); // 70 en 7 días
    expect(rec.daysUntilStockout).toBe(1);
    expect(rec.recommendedQuantity).toBe(130);
    expect(rec.consumedViaRecipes).toBe(false);
  });

  it("vender un plato consume sus ingredientes y dice qué plato lo causó", async () => {
    const { engine } = await setup(
      [
        WEEK_ANCHOR_PRODUCT,
        product({ id: "carne", name: "Carne", stock: 2 }),
        product({ id: "pan", name: "Pan", unit: "und", stock: 500 }),
        product({
          id: "burger",
          name: "Hamburguesa",
          unit: "und",
          recipe: [
            { productId: "carne", quantity: 0.15 },
            { productId: "pan", quantity: 1 }
          ]
        })
      ],
      [weekAnchor(), sale([line("burger", 70)], 2)]
    );

    const { recommendations } = await engine.analyze(NOW);
    const rec = byId(recommendations).carne;

    // 70 hamburguesas × 0,15 kg = 10,5 kg en 7 días = 1,5 kg/día; hay 2 → 1 día.
    expect(rec.windowConsumption).toBe(10.5);
    expect(rec.dailyConsumption).toBe(1.5);
    expect(rec.daysUntilStockout).toBe(1);
    expect(rec.consumedViaRecipes).toBe(true);
    expect(rec.drivers[0]).toMatchObject({ productId: "burger", productName: "Hamburguesa", quantity: 10.5 });

    // Un producto con receta NO se compra: solo sus ingredientes.
    expect(byId(recommendations).burger).toBeUndefined();
    // El pan tiene de sobra (70 en 7 días = 10/día, hay 500).
    expect(byId(recommendations).pan).toBeUndefined();
  });

  it("el tamaño elegido usa SU receta y los extras suman ingredientes", async () => {
    const { engine } = await setup(
      [
        product({ id: "carne", name: "Carne", stock: 0 }),
        product({ id: "queso", name: "Queso", stock: 0 }),
        product({
          id: "burger",
          unit: "und",
          recipe: [{ productId: "carne", quantity: 0.1 }],
          sizes: [{ id: "xl", name: "XL", priceDelta: 5000, recipe: [{ productId: "carne", quantity: 0.25 }] }],
          extras: [{ id: "extra-queso", name: "Queso", priceDelta: 2000, recipe: [{ productId: "queso", quantity: 0.03 }] }]
        })
      ],
      [
        sale(
          [
            line("burger", 10), // receta base: 1 kg
            line("burger", 10, {
              selectedSize: { id: "xl", name: "XL", priceDelta: 5000, recipe: [{ productId: "carne", quantity: 0.25 }] },
              selectedExtras: [
                { id: "extra-queso", name: "Queso", priceDelta: 2000, recipe: [{ productId: "queso", quantity: 0.03 }] }
              ]
            }) // 2,5 kg de carne + 0,3 kg de queso
          ],
          1
        )
      ]
    );

    const found = byId((await engine.analyze(NOW)).recommendations);

    expect(found.carne.windowConsumption).toBe(3.5);
    expect(found.queso.windowConsumption).toBe(0.3);
  });

  it("sigue sub-recetas hasta el insumo final", async () => {
    const { engine } = await setup(
      [
        product({ id: "tomate", name: "Tomate", stock: 0 }),
        product({ id: "salsa", name: "Salsa", recipe: [{ productId: "tomate", quantity: 0.5 }] }),
        product({ id: "pasta", name: "Pasta", unit: "und", recipe: [{ productId: "salsa", quantity: 0.2 }] })
      ],
      [sale([line("pasta", 20)], 1)]
    );

    const found = byId((await engine.analyze(NOW)).recommendations);

    // 20 pastas × 0,2 salsa × 0,5 tomate = 2 kg.
    expect(found.tomate.windowConsumption).toBe(2);
    expect(found.salsa).toBeUndefined();
  });

  it("productos por tandas: vender pan genera demanda de harina (receta por unidad)", async () => {
    const { engine } = await setup(
      [
        product({ id: "harina", name: "Harina", stock: 1 }),
        product({
          id: "pan",
          name: "Pan",
          unit: "und",
          stock: 100,
          productionMode: "BATCH",
          recipe: [{ productId: "harina", quantity: 0.05 }]
        })
      ],
      [sale([line("pan", 200)], 1)]
    );

    const { recommendations } = await engine.analyze(NOW);
    const harina = byId(recommendations).harina;

    expect(harina.windowConsumption).toBe(10); // 200 × 0,05
    expect(harina.consumedViaRecipes).toBe(true);
    expect(harina.drivers[0].productId).toBe("pan");
    expect(byId(recommendations).pan).toBeUndefined();
  });
});

describe("qué ventas cuentan", () => {
  let carne: Product;

  beforeEach(() => {
    carne = product({ id: "carne", name: "Carne", stock: 0 });
  });

  it("canceladas y reembolsadas por completo no cuentan; cobradas y por cobrar sí", async () => {
    const { engine } = await setup(
      [carne],
      [
        sale([line("carne", 7)], 1, { status: "PAID" }),
        sale([line("carne", 7)], 1, { status: "PENDING_PAYMENT" }),
        sale([line("carne", 50)], 1, { status: "CANCELLED" }),
        sale([line("carne", 50)], 1, { status: "REFUNDED" })
      ]
    );

    const rec = byId((await engine.analyze(NOW)).recommendations).carne;
    expect(rec.windowConsumption).toBe(14);
  });

  it("un reembolso parcial descuenta las unidades devueltas", async () => {
    const { engine } = await setup(
      [carne],
      [
        sale([line("carne", 10)], 1, {
          refunds: [{ id: "r1", items: [{ productId: "carne", quantity: 4 }], amount: 4000 }] as Sale["refunds"]
        })
      ]
    );

    const rec = byId((await engine.analyze(NOW)).recommendations).carne;
    expect(rec.windowConsumption).toBe(6);
  });

  it("ventas de hace más de 7 días no suben el ritmo actual, pero sí alimentan la tendencia", async () => {
    const { engine } = await setup(
      [carne],
      [
        sale([line("carne", 70)], 1), // ventana reciente
        sale([line("carne", 35)], 10), // ventana anterior (7–14 días)
        sale([line("carne", 999)], 30) // demasiado vieja: ignorada
      ]
    );

    const rec = byId((await engine.analyze(NOW)).recommendations).carne;

    expect(rec.windowConsumption).toBe(70);
    expect(rec.trendPercent).toBe(100); // 10/día vs 5/día
  });

  it("negocio nuevo: promedia con los días que lleva vendiendo", async () => {
    const { engine } = await setup([carne], [sale([line("carne", 10)], 1.5)]);

    const { recommendations, summary } = await engine.analyze(NOW);
    const rec = byId(recommendations).carne;

    expect(summary.observedDays).toBe(2);
    expect(rec.dailyConsumption).toBe(5); // 10 en 2 días, no 10 en 7
  });

  it("una venta de un producto eliminado no tumba el análisis", async () => {
    const { engine } = await setup(
      [carne],
      [sale([line("fantasma", 5), line("carne", 7)], 1)]
    );

    const rec = byId((await engine.analyze(NOW)).recommendations).carne;
    expect(rec.windowConsumption).toBe(7);
  });

  it("servicios sin stock y conteo a ciegas no generan recomendaciones", async () => {
    const { engine } = await setup(
      [
        product({ id: "domicilio", trackStock: false }),
        product({ id: "secreto", stock: 1, stockMasked: true }),
        carne
      ],
      [sale([line("domicilio", 100), line("secreto", 100), line("carne", 7)], 1)]
    );

    const { recommendations, summary } = await engine.analyze(NOW);

    expect(recommendations.map((rec) => rec.productId)).toEqual(["carne"]);
    expect(summary.maskedSkipped).toBe(1);
  });

  it("sin ventas: no inventa nada y avisa que no hay historial", async () => {
    const { engine } = await setup([product({ id: "sal", stock: 10, minStock: 2 })], []);

    const { recommendations, summary } = await engine.analyze(NOW);

    expect(recommendations).toEqual([]);
    expect(summary.hasSalesHistory).toBe(false);
  });
});

describe("compatibilidad", () => {
  it("getRecommendations() devuelve la misma lista que analyze()", async () => {
    const { engine } = await setup(
      [product({ id: "carne", stock: 0 })],
      [sale([line("carne", 7)], 0.5)]
    );

    const list = await engine.getRecommendations();
    expect(list.map((rec) => rec.productId)).toEqual(["carne"]);
  });
});