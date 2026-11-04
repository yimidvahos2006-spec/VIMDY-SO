import { describe, expect, it } from "vitest";

import { summarizeFixedExpenses } from "../../src/core/domain/accounting/fixedExpenseSummary";
import {
  buildRealNetProfitBreakdown,
  fixedExpenseFilterForPeriod,
  fixedExpensesAsOperatingExpenses,
  withFixedExpenses
} from "../../src/core/domain/accounting/realNetProfit";
import { computeProfitSummary, type ProfitInput } from "../../src/core/domain/profit/profitEngine";
import type { FixedExpense } from "../../src/core/types/fixedExpense";
import { startOfBusinessMonth } from "../../src/core/utils/businessTime";

const expense = (over: Partial<FixedExpense>): FixedExpense => ({
  id: "e",
  businessId: "b1",
  branchId: null,
  category: "otros",
  amount: 1000,
  expenseDate: "2026-11-03",
  description: "",
  createdAt: "2026-11-03T12:00:00Z",
  ...over
});

/** 10 platos a $10.000; cada plato gasta 2 unidades de insumo a $1.000 → ventas 100.000, insumos 20.000. */
const BASE: ProfitInput = {
  catalog: [
    { id: "insumo", name: "Insumo", unitCost: 1000 },
    { id: "plato", name: "Plato", recipe: [{ ingredientId: "insumo", quantity: 2 }] }
  ],
  sales: [{ productId: "plato", quantity: 10, unitPrice: 10000 }]
};

describe("Utilidad neta real = ventas − costo de insumos − gastos fijos", () => {
  const fixed = summarizeFixedExpenses([
    expense({ category: "arriendo", amount: 30000 }),
    expense({ category: "nomina", amount: 10000 }),
    expense({ category: "servicios", amount: 5000 })
  ]);

  it("cruza ventas, insumos y gastos fijos con el motor de ganancias", () => {
    const profit = computeProfitSummary(withFixedExpenses(BASE, fixed));
    const real = buildRealNetProfitBreakdown(profit, fixed);

    expect(real.sales).toBe(100000);
    expect(real.supplyCosts).toBe(20000);
    expect(real.fixedExpenses).toBe(45000);
    expect(real.otherExpenses).toBe(0);
    expect(real.realNetProfit).toBe(100000 - 20000 - 45000);
    expect(real.realNetProfit).toBe(profit.netProfit);
    expect(real.netMarginPercent).toBeCloseTo(35, 5);
  });

  it("desglosa los gastos fijos por categoría, de mayor a menor, sin categorías vacías", () => {
    const real = buildRealNetProfitBreakdown(computeProfitSummary(withFixedExpenses(BASE, fixed)), fixed);
    expect(real.byCategory.map((l) => [l.category, l.total])).toEqual([
      ["arriendo", 30000],
      ["nomina", 10000],
      ["servicios", 5000]
    ]);
    expect(real.byCategory.map((l) => l.label)).toEqual(["Arriendo", "Nómina", "Servicios"]);
  });

  it("sin gastos fijos la utilidad real es igual a la ganancia bruta", () => {
    const none = summarizeFixedExpenses([]);
    const profit = computeProfitSummary(withFixedExpenses(BASE, none));
    const real = buildRealNetProfitBreakdown(profit, none);
    expect(real.fixedExpenses).toBe(0);
    expect(real.realNetProfit).toBe(profit.grossProfit);
    expect(real.byCategory).toEqual([]);
  });

  it("si los gastos fijos superan la ganancia, la utilidad es negativa (pérdida real)", () => {
    const big = summarizeFixedExpenses([expense({ category: "arriendo", amount: 200000 })]);
    const real = buildRealNetProfitBreakdown(computeProfitSummary(withFixedExpenses(BASE, big)), big);
    expect(real.realNetProfit).toBe(100000 - 20000 - 200000);
    expect(real.realNetProfit).toBeLessThan(0);
  });

  it("sin ventas pero con gastos fijos, la utilidad es −gastos (no se esconde la pérdida)", () => {
    const profit = computeProfitSummary(withFixedExpenses({ ...BASE, sales: [] }, fixed));
    const real = buildRealNetProfitBreakdown(profit, fixed);
    expect(real.sales).toBe(0);
    expect(real.realNetProfit).toBe(-45000);
    expect(real.netMarginPercent).toBe(0); // margen sobre ventas 0 = 0, nunca NaN/Infinity
  });

  it("conserva otros gastos operativos que ya vinieran y los muestra aparte", () => {
    const input: ProfitInput = { ...BASE, operatingExpenses: [{ label: "Publicidad", amount: 7000 }] };
    const profit = computeProfitSummary(withFixedExpenses(input, fixed));
    const real = buildRealNetProfitBreakdown(profit, fixed);
    expect(real.fixedExpenses).toBe(45000);
    expect(real.otherExpenses).toBe(7000);
    // La cuenta cierra: ventas − insumos − fijos − otros = utilidad real.
    expect(real.sales - real.supplyCosts - real.fixedExpenses - real.otherExpenses).toBe(real.realNetProfit);
  });

  it("no muta el input original", () => {
    const input: ProfitInput = { ...BASE, operatingExpenses: [{ label: "Publicidad", amount: 7000 }] };
    const snapshot = JSON.stringify(input);
    withFixedExpenses(input, fixed);
    expect(JSON.stringify(input)).toBe(snapshot);
  });

  it("convierte cada categoría con valor en un gasto operativo del motor", () => {
    expect(fixedExpensesAsOperatingExpenses(fixed)).toEqual([
      { label: "Arriendo", amount: 30000 },
      { label: "Servicios", amount: 5000 },
      { label: "Nómina", amount: 10000 }
    ]);
  });

  it("tolera residuos de decimales al sumar (no inventa 'otros gastos')", () => {
    const decimals = summarizeFixedExpenses([
      expense({ category: "servicios", amount: 0.1 }),
      expense({ category: "servicios", amount: 0.2 })
    ]);
    const real = buildRealNetProfitBreakdown(computeProfitSummary(withFixedExpenses(BASE, decimals)), decimals);
    expect(real.otherExpenses).toBe(0);
  });
});

describe("fixedExpenseFilterForPeriod — rango de fechas en la zona del negocio", () => {
  const TZ = "America/Bogota";
  // 3 nov 2026, 9:30 pm en Bogotá = 4 nov 02:30 UTC. El "hoy" del negocio es el 3, no el 4.
  const NOW = new Date("2026-11-04T02:30:00Z");

  it("hoy en Colombia, no el día UTC", () => {
    expect(fixedExpenseFilterForPeriod(null, NOW, TZ)).toEqual({ to: "2026-11-03" });
  });

  it("'Este mes' va del día 1 hasta hoy", () => {
    expect(fixedExpenseFilterForPeriod(startOfBusinessMonth(NOW, TZ), NOW, TZ)).toEqual({
      from: "2026-11-01",
      to: "2026-11-03"
    });
  });

  it("'Todo' no lleva fecha inicial", () => {
    expect(fixedExpenseFilterForPeriod(null, NOW, TZ).from).toBeUndefined();
  });
});