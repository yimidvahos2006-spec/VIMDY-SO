import { describe, expect, it } from "vitest";
import type { InventoryMovement, LossCategory as LegacyLossCategory, Product } from "../../src/core/entities/Entities";
import { findExpiryRisk, normalizeLossCategory, summarizeLosses } from "../../src/core/domain/loss/lossEngine";
import {
  buildExpiringLots,
  buildLossRows,
  isoDayToUtcMs,
  movementsToLossRecords,
  UNMAPPED_LOSS_FALLBACK,
  type LossUnitCost
} from "../../src/core/domain/loss/lossCenterAdapter";

const product = (id: string, over: Partial<Product> = {}): Product =>
  ({ id, name: `P-${id}`, categoryId: "c", price: 0, stock: 0, minStock: 0, lastUpdated: new Date(), unit: "kg", ...over }) as Product;

const move = (id: string, over: Partial<InventoryMovement>): InventoryMovement =>
  ({ id, productId: "a", quantity: 1, date: new Date("2026-10-10T15:00:00Z"), type: "DECREASE", reason: "x", ...over }) as InventoryMovement;

const costs = (entries: Record<string, LossUnitCost>) => new Map(Object.entries(entries));
const RELIABLE: LossUnitCost = { cost: 1000, costUnreliable: false };

describe("movementsToLossRecords", () => {
  it("mapea cada categoría legada a una oficial del motor", () => {
    const expected: Record<LegacyLossCategory, string | null> = {
      MERMA: "MERMA_PREPARACION",
      VENCIDO: "VENCIMIENTO",
      CONSUMO_INTERNO: "CORTESIA",
      ROBO: "FALTANTE",
      ERROR: "FALTANTE",
      "DAÑO": "DESPERDICIO",
      AJUSTE_ADMINISTRATIVO: "FALTANTE",
      OTRO: null
    };
    for (const [legacy, official] of Object.entries(expected)) {
      expect(normalizeLossCategory(legacy)).toBe(official);
    }
  });

  it("solo toma DECREASE con motivo de pérdida y cuenta lo no reconocido (OTRO → Faltante)", () => {
    const movements = [
      move("1", { lossCategory: "VENCIDO" }),
      move("2", { lossCategory: "OTRO" }),
      move("3", {}), // venta: sin lossCategory
      move("4", { type: "INCREASE", lossCategory: "MERMA" })
    ];
    const { records, unmappedCount } = movementsToLossRecords(movements, new Map([["a", product("a")]]), costs({ a: RELIABLE }));
    expect(records.map((r) => r.category)).toEqual(["VENCIMIENTO", UNMAPPED_LOSS_FALLBACK]);
    expect(unmappedCount).toBe(1);
  });

  it("costo no confiable => el motor cuenta unidades pero no suma dinero", () => {
    const { records } = movementsToLossRecords(
      [move("1", { lossCategory: "MERMA", quantity: 2 })],
      new Map([["a", product("a")]]),
      costs({ a: { cost: 500, costUnreliable: true } })
    );
    const summary = summarizeLosses({ records, options: { now: new Date("2026-10-29T12:00:00Z") } });
    expect(summary.totalCost).toBe(0);
    expect(summary.unknownCostRecords).toBe(1);
  });
});

describe("buildLossRows", () => {
  it("calcula stock actual, disponible del periodo y desglose por categoría", () => {
    const from = Date.parse("2026-10-01T05:00:00Z");
    const to = Date.parse("2026-10-29T17:00:00Z");
    const movements = [
      move("in", { type: "INCREASE", quantity: 10, date: new Date("2026-10-05T12:00:00Z") }),
      move("out", { type: "DECREASE", quantity: 4, lossCategory: "VENCIDO", date: new Date("2026-10-10T12:00:00Z") }),
      move("sale", { type: "DECREASE", quantity: 2, date: new Date("2026-10-12T12:00:00Z") })
    ];
    const products = [product("a", { stock: 14 })]; // inicio = 14 - (10 - 4 - 2) = 10
    const unitCosts = costs({ a: RELIABLE });
    const { records } = movementsToLossRecords(movements, new Map(products.map((p) => [p.id, p])), unitCosts);

    const [row] = buildLossRows({ records, products, movements, periodFromMs: from, periodToMs: to, unitCosts });
    expect(row.currentStock).toBe(14);
    expect(row.availableQuantity).toBe(20); // 10 inicial + 10 entradas
    expect(row.byCategory.vencimiento).toEqual({ cost: 4000, quantity: 4, incidents: 1 });
    expect(row.unit).toBe("kg");
    expect(row.kind).toBe("producto");
  });

  it("nunca deja la cantidad disponible por debajo de lo perdido", () => {
    const movements = [move("out", { quantity: 5, lossCategory: "MERMA" })];
    const products = [product("a", { stock: 0 })];
    const unitCosts = costs({ a: RELIABLE });
    const { records } = movementsToLossRecords(movements, new Map([["a", products[0]]]), unitCosts);
    const [row] = buildLossRows({ records, products, movements, periodFromMs: null, periodToMs: Date.now() + 1, unitCosts });
    expect(row.availableQuantity).toBeGreaterThanOrEqual(5);
  });
});

describe("buildExpiringLots + findExpiryRisk", () => {
  const today = isoDayToUtcMs("2026-10-29") as number;

  it("el stock restante pertenece a los lotes más recientes (FIFO)", () => {
    const movements = [
      move("old", { type: "INCREASE", quantity: 10, date: new Date("2026-10-01T12:00:00Z"), expiresAt: "2026-10-20" }),
      move("new", { type: "INCREASE", quantity: 10, date: new Date("2026-10-15T12:00:00Z"), expiresAt: "2026-10-30" })
    ];
    // Quedan 4: todo pertenece al lote nuevo; el lote viejo ya se consumió y NO debe alertar.
    const lots = buildExpiringLots(movements, [product("a", { stock: 4 })], costs({ a: RELIABLE }));
    expect(lots).toHaveLength(1);
    const risk = findExpiryRisk(lots, today, 3);
    expect(risk).toHaveLength(1);
    expect(risk[0]).toMatchObject({ itemId: "a", stock: 4, daysLeft: 1, valueAtRisk: 4000 });
  });

  it("vence hoy = 0 días; ayer = vencido (negativo)", () => {
    const movements = [
      move("h", { productId: "a", type: "INCREASE", quantity: 1, expiresAt: "2026-10-29" }),
      move("y", { productId: "b", type: "INCREASE", quantity: 1, expiresAt: "2026-10-28" })
    ];
    const lots = buildExpiringLots(movements, [product("a", { stock: 1 }), product("b", { stock: 1 })], new Map());
    const risk = findExpiryRisk(lots, today, 3);
    expect(risk.map((r) => [r.itemId, r.daysLeft])).toEqual([["b", -1], ["a", 0]]);
  });

  it("ignora productos sin stock o con stock enmascarado", () => {
    const movements = [
      move("1", { productId: "a", type: "INCREASE", expiresAt: "2026-10-29" }),
      move("2", { productId: "b", type: "INCREASE", expiresAt: "2026-10-29" })
    ];
    const lots = buildExpiringLots(movements, [product("a", { stock: 0 }), product("b", { stock: 5, stockMasked: true })], new Map());
    expect(lots).toEqual([]);
  });
});