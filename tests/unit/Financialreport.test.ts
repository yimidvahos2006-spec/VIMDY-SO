import { describe, expect, it } from "vitest";
import type { InventoryMovement, Product } from "../../src/core/entities/Entities";
import type { LossUnitCost } from "../../src/core/domain/loss/lossCenterAdapter";
import type { ProfitCatalogItem, ProfitSaleLine } from "../../src/core/domain/profit/profitEngine";
import { buildFinancialReport, type FinancialReportInput } from "../../src/core/domain/finance/financialReport";

/* ----------------------------- Fixtures ---------------------------------- */

const product = (id: string, over: Partial<Product> = {}): Product =>
  ({ id, name: `P-${id}`, categoryId: "c", price: 0, stock: 0, minStock: 0, lastUpdated: new Date(), unit: "kg", ...over }) as Product;

const move = (id: string, over: Partial<InventoryMovement>): InventoryMovement =>
  ({ id, productId: "harina", quantity: 1, date: new Date("2026-10-10T15:00:00Z"), type: "DECREASE", reason: "x", ...over }) as InventoryMovement;

const RELIABLE = (cost: number): LossUnitCost => ({ cost, costUnreliable: false });

// Insumo "harina" ($1.000/kg) y producto "pan" (0,5 kg de harina => costo $500, se vende a $2.000).
const CATALOG: ProfitCatalogItem[] = [
  { id: "harina", name: "Harina", unitCost: 1000 },
  { id: "pan", name: "Pan", recipe: [{ ingredientId: "harina", quantity: 0.5 }] }
];

const PRODUCTS: Product[] = [product("harina", { stock: 20, isIngredient: true }), product("pan", { stock: 5, unit: "und" })];
const UNIT_COSTS = new Map<string, LossUnitCost>([
  ["harina", RELIABLE(1000)],
  ["pan", RELIABLE(500)]
]);

// Octubre 2026 en hora Colombia: [1-oct 00:00, 1-nov 00:00).
const PERIOD = { from: Date.parse("2026-10-01T05:00:00Z"), to: Date.parse("2026-11-01T05:00:00Z") };

// 10 vendidos, 2 devueltos, $1.000 de descuento => 8 netos.
//   ventas netas = 8 × 2.000 − 1.000 × (8/10) = 15.200 · COGS = 8 × 500 = 4.000
const SALES: ProfitSaleLine[] = [{ productId: "pan", quantity: 10, unitPrice: 2000, discount: 1000, refundedQuantity: 2 }];

const LOSS_MOVEMENTS: InventoryMovement[] = [
  move("v", { quantity: 2, lossCategory: "VENCIDO" }), //                      2 × 1.000 = 2.000 → Vencimiento
  move("m", { quantity: 1, lossCategory: "MERMA" }), //                        1 × 1.000 = 1.000 → Merma de preparación
  move("c", { productId: "pan", quantity: 2, lossCategory: "CONSUMO_INTERNO" }) // 2 × 500 = 1.000 → Cortesía
];

const NOISE_MOVEMENTS: InventoryMovement[] = [
  move("venta", { quantity: 5 }), //                                   salida por venta: NO es pérdida
  move("entrada", { type: "INCREASE", quantity: 10, lossCategory: "MERMA" }), // una entrada nunca es pérdida
  move("fuera", { quantity: 3, lossCategory: "VENCIDO", date: new Date("2026-09-15T15:00:00Z") }) // fuera del periodo
];

const baseInput = (over: Partial<FinancialReportInput> = {}): FinancialReportInput => ({
  catalog: CATALOG,
  sales: SALES,
  movements: [...LOSS_MOVEMENTS, ...NOISE_MOVEMENTS],
  products: PRODUCTS,
  unitCosts: UNIT_COSTS,
  period: PERIOD,
  now: new Date("2026-10-30T16:00:00Z"),
  ...over
});

/* ------------------------------ Consolidado ------------------------------- */

describe("buildFinancialReport · consolidado", () => {
  it("consolida ventas netas, COGS, utilidad bruta, pérdidas y utilidad real", () => {
    const report = buildFinancialReport(baseInput());

    expect(report.netSales).toBeCloseTo(15200, 6);
    expect(report.cogs).toBeCloseTo(4000, 6);
    expect(report.grossProfit).toBeCloseTo(11200, 6);
    expect(report.grossMarginPercent).toBeCloseTo((11200 / 15200) * 100, 6);

    expect(report.lossCost).toBeCloseTo(4000, 6);
    expect(report.realProfit).toBeCloseTo(7200, 6);
    expect(report.realMarginPercent).toBeCloseTo((7200 / 15200) * 100, 6);
    expect(report.lossPercentOfSales).toBeCloseTo((4000 / 15200) * 100, 6);
  });

  it("desglosa las pérdidas por categoría (siempre las 5) y cuadra con el total", () => {
    const report = buildFinancialReport(baseInput());

    expect(report.lossByCategory).toEqual({
      VENCIMIENTO: 2000,
      DESPERDICIO: 0,
      MERMA_PREPARACION: 1000,
      CORTESIA: 1000,
      FALTANTE: 0
    });
    const sum = Object.values(report.lossByCategory).reduce((a, b) => a + b, 0);
    expect(sum).toBeCloseTo(report.lossCost, 6);
    expect(report.realProfit).toBeCloseTo(report.grossProfit - report.lossCost, 6);
  });

  it("ignora ventas (DECREASE sin motivo), entradas y pérdidas fuera del periodo", () => {
    const report = buildFinancialReport(baseInput());
    expect(report.losses.recordCount).toBe(3);
    expect(report.lossByCategory.VENCIMIENTO).toBe(2000); // no suma los 3 kg de septiembre
  });

  it("sin periodo toma todo el histórico de pérdidas", () => {
    const report = buildFinancialReport(baseInput({ period: undefined }));
    expect(report.lossByCategory.VENCIMIENTO).toBe(5000); // 2.000 de octubre + 3.000 de septiembre
  });

  it("no duplica costos: los movimientos de venta no alteran el COGS ni las pérdidas", () => {
    const onlySales = buildFinancialReport(baseInput({ movements: NOISE_MOVEMENTS.slice(0, 1) }));
    expect(onlySales.lossCost).toBe(0);
    expect(onlySales.cogs).toBeCloseTo(4000, 6);
    expect(onlySales.realProfit).toBeCloseTo(onlySales.grossProfit, 6);
  });

  it("clasifica un motivo desconocido (OTRO) como Faltante y lo avisa sin invalidar los totales", () => {
    const report = buildFinancialReport(baseInput({ movements: [move("o", { quantity: 1, lossCategory: "OTRO" })] }));

    expect(report.lossByCategory.FALTANTE).toBe(1000);
    expect(report.dataQuality.unmappedLossCount).toBe(1);
    const warning = report.dataQuality.warnings.find((w) => w.code === "MOTIVO_PERDIDA_NO_RECONOCIDO");
    expect(warning).toMatchObject({ count: 1, affectsTotals: false });
    expect(report.dataQuality.isComplete).toBe(true);
  });
});

/* ------------------------------ Casos borde ------------------------------- */

describe("buildFinancialReport · casos borde", () => {
  it("sin ventas: márgenes en 0, pérdidas sin porcentaje y utilidad real negativa (sin NaN/Infinity)", () => {
    const report = buildFinancialReport(
      baseInput({ sales: [], movements: [move("m", { quantity: 1, lossCategory: "MERMA" })] })
    );

    expect(report.netSales).toBe(0);
    expect(report.grossMarginPercent).toBe(0);
    expect(report.realMarginPercent).toBe(0);
    expect(report.lossPercentOfSales).toBeNull();
    expect(report.realProfit).toBe(-1000);
    for (const value of [report.netSales, report.cogs, report.grossProfit, report.lossCost, report.realProfit]) {
      expect(Number.isFinite(value)).toBe(true);
    }
  });

  it("todo vacío: ceros, sin avisos y datos completos", () => {
    const report = buildFinancialReport({
      catalog: [],
      sales: [],
      movements: [],
      products: [],
      unitCosts: new Map(),
      now: new Date("2026-10-30T16:00:00Z")
    });

    expect(report).toMatchObject({ netSales: 0, cogs: 0, grossProfit: 0, lossCost: 0, realProfit: 0, realMarginPercent: 0 });
    expect(report.expiryRisk).toEqual([]);
    expect(report.dataQuality.warnings).toEqual([]);
    expect(report.dataQuality.isComplete).toBe(true);
  });

  it("una venta totalmente devuelta no aporta ventas ni COGS", () => {
    const report = buildFinancialReport(
      baseInput({ sales: [{ productId: "pan", quantity: 3, unitPrice: 2000, refundedQuantity: 3 }], movements: [] })
    );
    expect(report.netSales).toBe(0);
    expect(report.cogs).toBe(0);
  });

  it("es determinista y no muta sus argumentos", () => {
    const input = baseInput({ businessToday: "2026-10-30" });
    const snapshot = structuredClone(input);

    const first = buildFinancialReport(input);
    const second = buildFinancialReport(input);

    expect(second).toEqual(first);
    expect(input).toEqual(snapshot);
  });
});

/* ----------------------------- Calidad de datos --------------------------- */

describe("buildFinancialReport · calidad de datos", () => {
  it("costo de pérdida no confiable: cuenta unidades pero no dinero, y marca el reporte como incompleto", () => {
    const report = buildFinancialReport(
      baseInput({
        movements: [move("m", { quantity: 2, lossCategory: "MERMA" })],
        unitCosts: new Map([["harina", { cost: 1000, costUnreliable: true }]])
      })
    );

    expect(report.lossCost).toBe(0);
    expect(report.losses.byItem[0]?.quantity).toBe(2);
    expect(report.dataQuality.unknownCostLossRecords).toBe(1);
    expect(report.dataQuality.warnings.map((w) => w.code)).toContain("COSTO_PERDIDA_DESCONOCIDO");
    expect(report.dataQuality.isComplete).toBe(false);
  });

  it("receta con insumo sin costo: avisa que el COGS está subestimado", () => {
    const catalog: ProfitCatalogItem[] = [
      ...CATALOG,
      { id: "azucar", name: "Azúcar", unitCost: null },
      { id: "jugo", name: "Jugo", recipe: [{ ingredientId: "azucar", quantity: 1 }] }
    ];
    const report = buildFinancialReport(
      baseInput({ catalog, sales: [{ productId: "jugo", quantity: 1, unitPrice: 5000 }], movements: [] })
    );

    expect(report.netSales).toBe(5000);
    expect(report.cogs).toBe(0);
    expect(report.dataQuality.productsWithIncompleteCost).toEqual(["jugo"]);
    expect(report.dataQuality.warnings.find((w) => w.code === "COSTO_VENTAS_INCOMPLETO")).toMatchObject({
      count: 1,
      affectsTotals: true
    });
    expect(report.dataQuality.isComplete).toBe(false);
  });

  it("producto vendido que no está en el catálogo: ingreso sin costo, con aviso", () => {
    const report = buildFinancialReport(
      baseInput({ sales: [{ productId: "fantasma", quantity: 1, unitPrice: 1000 }], movements: [] })
    );

    expect(report.netSales).toBe(1000);
    expect(report.dataQuality.unknownProductIds).toEqual(["fantasma"]);
    expect(report.dataQuality.warnings.map((w) => w.code)).toContain("PRODUCTO_VENDIDO_NO_CATALOGADO");
    expect(report.dataQuality.isComplete).toBe(false);
  });

  it("pérdida con cantidad inválida se descarta y se avisa", () => {
    const report = buildFinancialReport(
      baseInput({ movements: [move("neg", { quantity: -3, lossCategory: "MERMA" }), move("ok", { quantity: 1, lossCategory: "MERMA" })] })
    );

    expect(report.lossCost).toBe(1000);
    expect(report.dataQuality.invalidLossRecords).toBe(1);
    expect(report.dataQuality.isComplete).toBe(false);
  });
});

/* ------------------------------- Vencimientos ----------------------------- */

describe("buildFinancialReport · productos por vencer", () => {
  // Entró un lote de 10 kg que vence mañana; el stock actual (20) lo cubre completo.
  const withLot = [...LOSS_MOVEMENTS, move("lote", { type: "INCREASE", quantity: 10, expiresAt: "2026-10-31", date: new Date("2026-10-20T12:00:00Z") })];

  it("informa la pérdida potencial por vencer pero NO la resta de la utilidad real", () => {
    const withRisk = buildFinancialReport(baseInput({ movements: withLot, businessToday: "2026-10-30" }));
    const withoutRisk = buildFinancialReport(baseInput({ movements: withLot }));

    expect(withRisk.expiryRisk).toHaveLength(1);
    expect(withRisk.expiryRisk[0]).toMatchObject({ itemId: "harina", stock: 10, daysLeft: 1, valueAtRisk: 10000 });
    expect(withRisk.expiryRiskValue).toBe(10000);
    expect(withRisk.realProfit).toBeCloseTo(withoutRisk.realProfit, 6);
  });

  it("sin `businessToday` no evalúa vencimientos", () => {
    const report = buildFinancialReport(baseInput({ movements: withLot }));
    expect(report.expiryRisk).toEqual([]);
    expect(report.expiryRiskValue).toBe(0);
    expect(report.dataQuality.warnings).toEqual([]);
  });

  it("`businessToday` inválido avisa, no lanza y no invalida los totales", () => {
    const report = buildFinancialReport(baseInput({ movements: withLot, businessToday: "30/10/2026" }));

    expect(report.expiryRisk).toEqual([]);
    expect(report.dataQuality.warnings.map((w) => w.code)).toEqual(["FECHA_HOY_INVALIDA"]);
    expect(report.dataQuality.isComplete).toBe(true);
  });
});