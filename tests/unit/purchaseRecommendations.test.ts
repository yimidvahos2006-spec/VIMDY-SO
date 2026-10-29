// tests/unit/purchaseRecommendations.test.ts
/* ===========================================================================
   Compras Inteligentes — dominio puro (core/domain/purchasing).
   Dado el stock y el consumo YA medido, valida qué se recomienda comprar,
   cuánto, con qué urgencia y con qué explicación.
=========================================================================== */

import { describe, expect, it } from "vitest";

import type { Product } from "../../src/core/entities/Entities";
import {
  EMPTY_CONSUMPTION_WINDOW,
  buildPurchaseAnalysis,
  buildPurchaseRecommendations,
  isPurchasableProduct,
  resolveUnitCost,
  statusConsumesStock,
  type ConsumptionWindow
} from "../../src/core/domain/purchasing";

function product(overrides: Partial<Product> & { id: string }): Product {
  return {
    name: overrides.id,
    categoryId: "cat",
    price: 1000,
    stock: 0,
    minStock: 0,
    unit: "kg",
    lastUpdated: new Date("2026-10-01T00:00:00Z"),
    ...overrides
  } as Product;
}

/** Ventana con totales y, opcionalmente, qué producto vendido causó cada consumo. */
function window(
  totals: Record<string, number>,
  drivers: Record<string, Record<string, number>> = {}
): ConsumptionWindow {
  return {
    totals: new Map(Object.entries(totals)),
    drivers: new Map(
      Object.entries(totals).map(([id, total]) => [
        id,
        new Map(Object.entries(drivers[id] ?? { [id]: total }))
      ])
    )
  };
}

function run(
  products: Product[],
  recent: ConsumptionWindow,
  options: { previous?: ConsumptionWindow; recentDays?: number; previousDays?: number; coverageDays?: number } = {}
) {
  return buildPurchaseAnalysis({
    products,
    recent,
    previous: options.previous ?? EMPTY_CONSUMPTION_WINDOW,
    recentDays: options.recentDays ?? 7,
    previousDays: options.previousDays ?? 7,
    config: options.coverageDays ? { coverageDays: options.coverageDays } : undefined
  });
}

describe("qué aparece y qué no", () => {
  it("un insumo sin consumo y por encima del mínimo NO se recomienda (nunca 'por si acaso')", () => {
    const { recommendations } = run([product({ id: "sal", stock: 10, minStock: 2 })], window({}));
    expect(recommendations).toEqual([]);
  });

  it("un insumo con stock de sobra para más de 14 días no aparece", () => {
    // 7/día → 14 días = 98; hay 500.
    const { recommendations } = run([product({ id: "arroz", stock: 500 })], window({ arroz: 49 }));
    expect(recommendations).toEqual([]);
  });

  it("bajo el mínimo y sin ventas: sugiere completar hasta el mínimo y lo dice", () => {
    const [rec] = buildPurchaseRecommendations({
      products: [product({ id: "aceite", stock: 1, minStock: 5 })],
      recent: window({}),
      previous: EMPTY_CONSUMPTION_WINDOW,
      recentDays: 7,
      previousDays: 7
    });

    expect(rec.recommendedQuantity).toBe(4);
    expect(rec.basedOnSalesHistory).toBe(false);
    expect(rec.daysUntilStockout).toBeNull();
    expect(rec.reason).toContain("stock mínimo");
  });

  it("productos con receta, servicios (trackStock=false) y por tandas con receta no se compran", () => {
    const products = [
      product({ id: "burger", stock: 0, recipe: [{ productId: "carne", quantity: 0.15 }] }),
      product({ id: "domicilio", stock: 0, trackStock: false }),
      product({ id: "pan", stock: 0, productionMode: "BATCH", recipe: [{ productId: "harina", quantity: 0.5 }] })
    ];

    const { recommendations, summary } = run(products, window({ burger: 100, domicilio: 100, pan: 100 }));

    expect(recommendations).toEqual([]);
    expect(summary.analyzedProducts).toBe(0);
  });

  it("con conteo a ciegas el stock no es real: se omite y se informa en el resumen", () => {
    const { recommendations, summary } = run(
      [product({ id: "carne", stock: 1, stockMasked: true }), product({ id: "pollo", stock: 1 })],
      window({ carne: 70, pollo: 70 })
    );

    expect(recommendations.map((rec) => rec.productId)).toEqual(["pollo"]);
    expect(summary.maskedSkipped).toBe(1);
  });
});

describe("cantidad sugerida y días restantes", () => {
  it("cubre 14 días de consumo menos lo que ya hay", () => {
    // 35 kg en 7 días = 5 kg/día; hay 10 → alcanza 2 días; para 14 días hacen falta 70 → pedir 60.
    const [rec] = run([product({ id: "carne", stock: 10 })], window({ carne: 35 })).recommendations;

    expect(rec.dailyConsumption).toBe(5);
    expect(rec.daysUntilStockout).toBe(2);
    expect(rec.recommendedQuantity).toBe(60);
  });

  it("si el mínimo es mayor que la cobertura, la meta es el mínimo", () => {
    // 0,7 kg/día → 14 días = 9,8; mínimo 20; stock 4 → pedir 16.
    const [rec] = run([product({ id: "sal", stock: 4, minStock: 20 })], window({ sal: 4.9 })).recommendations;
    expect(rec.recommendedQuantity).toBe(16);
  });

  it("redondea hacia arriba pero sin que el ruido de punto flotante suba una unidad de más", () => {
    // 0.1 + 0.2 = 0.30000000000000004 → ×10 días = 3.0000000000000004 → debe pedir 3, no 4.
    const [rec] = run([product({ id: "x", stock: 0 })], window({ x: 0.1 + 0.2 }), {
      recentDays: 1,
      coverageDays: 10
    }).recommendations;

    expect(rec.recommendedQuantity).toBe(3);
  });

  it("stock negativo (se vendió sin stock): 0 días, urgencia alta y la sugerencia cubre el faltante", () => {
    const [rec] = run([product({ id: "queso", stock: -3 })], window({ queso: 7 })).recommendations;

    expect(rec.daysUntilStockout).toBe(0);
    expect(rec.urgency).toBe("ALTA");
    expect(rec.recommendedQuantity).toBe(17); // 1/día × 14 = 14, más los 3 que se debían
    expect(rec.reason).toContain("agotó");
  });

  it("un negocio nuevo promedia con los días realmente observados, no con 7", () => {
    // 10 kg en 2 días de operación = 5 kg/día (no 1,4).
    const [rec] = run([product({ id: "carne", stock: 5 })], window({ carne: 10 }), { recentDays: 2 }).recommendations;

    expect(rec.dailyConsumption).toBe(5);
    expect(rec.observedDays).toBe(2);
    expect(rec.daysUntilStockout).toBe(1);
  });
});

describe("urgencia", () => {
  it("ALTA cuando quedan ≤ 2 días, MEDIA hasta 5, BAJA hasta 14", () => {
    // consumo 7/día (49 en 7 días)
    const products = [
      product({ id: "a", stock: 14 }), // 2 días
      product({ id: "m", stock: 35 }), // 5 días
      product({ id: "b", stock: 70 }) // 10 días
    ];
    const recent = window({ a: 49, m: 49, b: 49 });

    const byId = Object.fromEntries(run(products, recent).recommendations.map((rec) => [rec.productId, rec]));

    expect(byId.a.urgency).toBe("ALTA");
    expect(byId.m.urgency).toBe("MEDIA");
    expect(byId.b.urgency).toBe("BAJA");
  });

  it("bajo el mínimo sin ritmo de consumo es MEDIA; agotado es ALTA", () => {
    const { recommendations } = run(
      [product({ id: "bajo", stock: 1, minStock: 5 }), product({ id: "cero", stock: 0, minStock: 5 })],
      window({})
    );
    const byId = Object.fromEntries(recommendations.map((rec) => [rec.productId, rec]));

    expect(byId.bajo.urgency).toBe("MEDIA");
    expect(byId.cero.urgency).toBe("ALTA");
  });

  it("ordena por urgencia, luego por días restantes y luego por nombre", () => {
    const products = [
      product({ id: "b", name: "Beta", stock: 70 }),
      product({ id: "a2", name: "Zeta", stock: 7 }),
      product({ id: "a1", name: "Alfa", stock: 7 }),
      product({ id: "m", name: "Media", stock: 35 })
    ];
    const order = run(products, window({ b: 49, a2: 49, a1: 49, m: 49 })).recommendations.map((rec) => rec.productName);

    expect(order).toEqual(["Alfa", "Zeta", "Media", "Beta"]);
  });
});

describe("el por qué", () => {
  it("menciona el aumento frente a la semana anterior y deja el detalle con cifras", () => {
    const [rec] = run([product({ id: "carne", stock: 10 })], window({ carne: 70 }), {
      previous: window({ carne: 35 })
    }).recommendations;

    expect(rec.trendPercent).toBe(100);
    expect(rec.reason).toContain("subió 100%");
    expect(rec.reasonDetails.join(" ")).toContain("Consumo: 10 kg por día");
    expect(rec.reasonDetails.join(" ")).toContain("Stock actual: 10 kg");
  });

  it("sin ventana anterior no inventa tendencia", () => {
    const [rec] = run([product({ id: "carne", stock: 10 })], window({ carne: 70 })).recommendations;
    expect(rec.trendPercent).toBeNull();
    expect(rec.reason).toContain("se agota en 1 día(s)");
  });

  it("identifica qué productos vendidos más lo consumen y marca 'vía recetas'", () => {
    const [rec] = run(
      [product({ id: "carne", stock: 5 }), product({ id: "burger" }), product({ id: "combo" })],
      window({ carne: 70 }, { carne: { burger: 50, combo: 20 } })
    ).recommendations;

    expect(rec.consumedViaRecipes).toBe(true);
    expect(rec.drivers.map((driver) => [driver.productId, driver.quantity])).toEqual([
      ["burger", 50],
      ["combo", 20]
    ]);
  });

  it("un insumo que solo se vende suelto no se marca 'vía recetas'", () => {
    const [rec] = run([product({ id: "gaseosa", stock: 1, unit: "und" })], window({ gaseosa: 70 })).recommendations;
    expect(rec.consumedViaRecipes).toBe(false);
  });
});

describe("costo estimado y resumen", () => {
  it("usa el costo promedio sobre el último precio de compra; sin costo queda en null", () => {
    const { recommendations, summary } = run(
      [
        product({ id: "a", stock: 0, averageCost: 3000, purchasePrice: 9999 }),
        product({ id: "b", stock: 0, purchasePrice: 1000 }),
        product({ id: "c", stock: 0 })
      ],
      window({ a: 7, b: 7, c: 7 })
    );
    const byId = Object.fromEntries(recommendations.map((rec) => [rec.productId, rec]));

    expect(byId.a.estimatedCost).toBe(3000 * 14);
    expect(byId.b.estimatedCost).toBe(1000 * 14);
    expect(byId.c.estimatedCost).toBeNull();
    expect(summary.estimatedTotalCost).toBe(3000 * 14 + 1000 * 14);
  });

  it("el resumen cuenta por urgencia y avisa si todavía no hay ventas", () => {
    const withSales = run(
      [product({ id: "a", stock: 7 }), product({ id: "b", stock: 70 })],
      window({ a: 49, b: 49 })
    ).summary;
    expect(withSales).toMatchObject({ urgent: 1, warning: 0, low: 1, hasSalesHistory: true });

    const noSales = run([product({ id: "x", stock: 10 })], window({})).summary;
    expect(noSales.hasSalesHistory).toBe(false);
  });
});

describe("reglas auxiliares", () => {
  it("statusConsumesStock: solo canceladas y reembolsadas no consumen", () => {
    for (const status of ["PAID", "CLOSED", "OPEN", "PENDING_PAYMENT", "paid", undefined, null, ""]) {
      expect(statusConsumesStock(status), String(status)).toBe(true);
    }
    for (const status of ["CANCELLED", "REFUNDED", " cancelled "]) {
      expect(statusConsumesStock(status), status).toBe(false);
    }
  });

  it("isPurchasableProduct y resolveUnitCost", () => {
    expect(isPurchasableProduct(product({ id: "a" }))).toBe(true);
    expect(isPurchasableProduct(product({ id: "b", recipe: [{ productId: "a", quantity: 1 }] }))).toBe(false);
    expect(isPurchasableProduct(product({ id: "c", trackStock: false }))).toBe(false);

    expect(resolveUnitCost(product({ id: "d", averageCost: 5, purchasePrice: 9 }))).toBe(5);
    expect(resolveUnitCost(product({ id: "e", averageCost: 0, purchasePrice: 9 }))).toBe(9);
    expect(resolveUnitCost(product({ id: "f" }))).toBeNull();
  });
});