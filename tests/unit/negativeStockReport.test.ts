import { describe, it, expect } from "vitest";
import { buildNegativeStockReport, isNegativeStock } from "../../src/core/utils/negativeStockReport";
import type { InventoryMovement, Product } from "../../src/core/entities/Entities";

function makeProduct(overrides: Partial<Product> = {}): Product {
  return {
    id: "p1",
    name: "Producto",
    categoryId: "cat-1",
    price: 0,
    stock: 10,
    minStock: 2,
    unit: "kg",
    active: true,
    trackStock: true,
    requiresKitchen: false,
    recipe: [],
    productionMode: "ON_DEMAND",
    lastUpdated: new Date(),
    ...overrides
  } as Product;
}

function makeMovement(overrides: Partial<InventoryMovement>): InventoryMovement {
  return {
    id: crypto.randomUUID(),
    productId: "p1",
    quantity: 1,
    date: new Date("2026-10-20T10:00:00Z"),
    type: "DECREASE",
    reason: "Venta",
    ...overrides
  } as InventoryMovement;
}

describe("isNegativeStock", () => {
  it("solo cuenta activos, con control de stock, sin máscara y con stock < 0", () => {
    expect(isNegativeStock(makeProduct({ stock: -1 }))).toBe(true);
    expect(isNegativeStock(makeProduct({ stock: 0 }))).toBe(false);
    expect(isNegativeStock(makeProduct({ stock: -1, active: false }))).toBe(false);
    expect(isNegativeStock(makeProduct({ stock: -1, trackStock: false }))).toBe(false);
    expect(isNegativeStock(makeProduct({ stock: -1, stockMasked: true }))).toBe(false);
    expect(isNegativeStock(makeProduct({ stock: Number.NaN }))).toBe(false);
  });
});

describe("buildNegativeStockReport", () => {
  it("reporte vacío cuando todo está en orden", () => {
    const report = buildNegativeStockReport([makeProduct({ stock: 5 }), makeProduct({ id: "p2", stock: 0 })]);
    expect(report.rows).toEqual([]);
    expect(report.totalCount).toBe(0);
    expect(report.totalShortageCost).toBeNull();
    expect(report.maskedCount).toBe(0);
  });

  it("calcula faltante, tipo y cuenta insumos y productos por separado", () => {
    const report = buildNegativeStockReport([
      makeProduct({ id: "ins", name: "Harina", isIngredient: true, stock: -2.5 }),
      makeProduct({ id: "prod", name: "Gaseosa", price: 3000, stock: -4 }),
      makeProduct({ id: "ok", name: "Pan", stock: 3 })
    ]);
    expect(report.totalCount).toBe(2);
    expect(report.insumoCount).toBe(1);
    expect(report.productCount).toBe(1);
    const harina = report.rows.find((r) => r.productId === "ins");
    expect(harina).toMatchObject({ kind: "insumo", stock: -2.5, shortage: 2.5, unit: "kg" });
    expect(report.rows.find((r) => r.productId === "prod")?.kind).toBe("producto");
  });

  it("ordena del más negativo al menos negativo, con desempate por nombre", () => {
    const report = buildNegativeStockReport([
      makeProduct({ id: "a", name: "Zanahoria", stock: -1 }),
      makeProduct({ id: "b", name: "Cebolla", stock: -5 }),
      makeProduct({ id: "c", name: "Ajo", stock: -1 })
    ]);
    expect(report.rows.map((r) => r.productId)).toEqual(["b", "c", "a"]);
  });

  it("sin permiso de costos nunca calcula costo ni total", () => {
    const report = buildNegativeStockReport([makeProduct({ stock: -2, purchasePrice: 1000 })]);
    expect(report.rows[0].shortageCost).toBeNull();
    expect(report.totalShortageCost).toBeNull();
  });

  it("con permiso de costos calcula faltante × costo y el total", () => {
    const report = buildNegativeStockReport(
      [
        makeProduct({ id: "a", stock: -2, purchasePrice: 1000 }),
        makeProduct({ id: "b", stock: -0.5, purchasePrice: 4000 })
      ],
      { includeCosts: true }
    );
    expect(report.rows.find((r) => r.productId === "a")?.shortageCost).toBe(2000);
    expect(report.rows.find((r) => r.productId === "b")?.shortageCost).toBe(2000);
    expect(report.totalShortageCost).toBe(4000);
  });

  it("si a un producto le falta el costo, el total es null (nunca una suma parcial)", () => {
    const report = buildNegativeStockReport(
      [makeProduct({ id: "a", stock: -2, purchasePrice: 1000 }), makeProduct({ id: "b", stock: -1 })],
      { includeCosts: true }
    );
    expect(report.rows.find((r) => r.productId === "a")?.shortageCost).toBe(2000);
    expect(report.rows.find((r) => r.productId === "b")?.shortageCost).toBeNull();
    expect(report.totalShortageCost).toBeNull();
  });

  it("excluye los productos enmascarados y los cuenta aparte", () => {
    const report = buildNegativeStockReport([
      makeProduct({ id: "m1", stock: 0, stockMasked: true }),
      makeProduct({ id: "m2", stock: -9, stockMasked: true }),
      makeProduct({ id: "m3", stock: 5, stockMasked: true, active: false }),
      makeProduct({ id: "neg", stock: -1 })
    ]);
    expect(report.rows.map((r) => r.productId)).toEqual(["neg"]);
    expect(report.maskedCount).toBe(2);
  });

  it("negativeSince es el inicio de la racha actual en negativo según el Kardex", () => {
    const report = buildNegativeStockReport([makeProduct({ stock: -3 })], {
      movements: [
        // Primera racha negativa que luego se corrige: no debe contar.
        makeMovement({ date: new Date("2026-10-01T10:00:00Z"), stockBefore: 1, stockAfter: -1 }),
        makeMovement({ date: new Date("2026-10-02T10:00:00Z"), type: "INCREASE", stockBefore: -1, stockAfter: 5 }),
        // Racha actual.
        makeMovement({ date: new Date("2026-10-10T10:00:00Z"), stockBefore: 1, stockAfter: -1 }),
        makeMovement({ date: new Date("2026-10-12T10:00:00Z"), stockBefore: -1, stockAfter: -3 })
      ]
    });
    expect(report.rows[0].negativeSince?.toISOString()).toBe("2026-10-10T10:00:00.000Z");
    expect(report.rows[0].lastMovementAt?.toISOString()).toBe("2026-10-12T10:00:00.000Z");
  });

  it("si el historial está recortado a mitad de la racha, negativeSince es null (no inventa una fecha)", () => {
    const report = buildNegativeStockReport([makeProduct({ stock: -3 })], {
      movements: [
        // El primer movimiento que tenemos ya venía en negativo (stockBefore < 0).
        makeMovement({ date: new Date("2026-10-10T10:00:00Z"), stockBefore: -1, stockAfter: -2 }),
        makeMovement({ date: new Date("2026-10-12T10:00:00Z"), stockBefore: -2, stockAfter: -3 })
      ]
    });
    expect(report.rows[0].negativeSince).toBeNull();
    expect(report.rows[0].lastMovementAt?.toISOString()).toBe("2026-10-12T10:00:00.000Z");
  });

  it("no depende del orden de entrada de los movimientos ni de otros productos", () => {
    const report = buildNegativeStockReport([makeProduct({ stock: -1 })], {
      movements: [
        makeMovement({ date: new Date("2026-10-12T10:00:00Z"), stockBefore: -1, stockAfter: -2 }),
        makeMovement({ date: new Date("2026-10-10T10:00:00Z"), stockBefore: 1, stockAfter: -1 }),
        makeMovement({ productId: "otro", date: new Date("2026-09-01T10:00:00Z"), stockBefore: 1, stockAfter: -1 })
      ]
    });
    expect(report.rows[0].negativeSince?.toISOString()).toBe("2026-10-10T10:00:00.000Z");
  });

  it("sin Kardex (o sin stockAfter) las fechas quedan en null sin romper", () => {
    const sinKardex = buildNegativeStockReport([makeProduct({ stock: -1 })]);
    expect(sinKardex.rows[0].negativeSince).toBeNull();
    expect(sinKardex.rows[0].lastMovementAt).toBeNull();

    const sinStockAfter = buildNegativeStockReport([makeProduct({ stock: -1 })], {
      movements: [makeMovement({ date: new Date("2026-10-10T10:00:00Z") })]
    });
    expect(sinStockAfter.rows[0].negativeSince).toBeNull();
    expect(sinStockAfter.rows[0].lastMovementAt?.toISOString()).toBe("2026-10-10T10:00:00.000Z");
  });
});