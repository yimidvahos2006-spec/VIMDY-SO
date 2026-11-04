// @vitest-environment jsdom
import { createElement as h } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";

import { summarizeFixedExpenses } from "../../src/core/domain/accounting/fixedExpenseSummary";
import type { ProfitInput } from "../../src/core/domain/profit/profitEngine";
import type { FixedExpense } from "../../src/core/types/fixedExpense";
import { ProfitCenterView } from "../../src/presentation/components/profit/ProfitCenterDashboard";

afterEach(cleanup);

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

/** Ventas 100.000, insumos 20.000 (ganancia bruta 80.000). */
const INPUT: ProfitInput = {
  catalog: [
    { id: "insumo", name: "Insumo", unitCost: 1000 },
    { id: "plato", name: "Plato", recipe: [{ ingredientId: "insumo", quantity: 2 }] }
  ],
  sales: [{ productId: "plato", quantity: 10, unitPrice: 10000 }]
};

const FIXED = summarizeFixedExpenses([
  expense({ category: "arriendo", amount: 30000 }),
  expense({ category: "nomina", amount: 10000 }),
  expense({ category: "servicios", amount: 5000 })
]);

const mount = (props: Record<string, unknown> = {}) => render(h(ProfitCenterView, { input: INPUT, ...props }));
const panel = () => screen.getByRole("region", { name: "Utilidad neta real" });

describe("Centro de Ganancias con VIMDY Contable", () => {
  it("muestra la Utilidad neta real = ventas − insumos − gastos fijos", () => {
    mount({ fixedExpenses: FIXED });
    const real = within(panel());

    expect(real.getByText("Ventas").nextSibling?.textContent).toMatch(/100\.000/);
    expect(real.getByText("Costo de insumos").nextSibling?.textContent).toMatch(/20\.000/);
    expect(real.getByText("Gastos fijos").nextSibling?.textContent).toMatch(/45\.000/);
    // 100.000 − 20.000 − 45.000 = 35.000
    expect(real.getByText("Utilidad neta real", { selector: "dt" }).nextSibling?.textContent).toMatch(/35\.000/);
  });

  it("lista cada categoría de gasto fijo", () => {
    mount({ fixedExpenses: FIXED });
    const real = within(panel());
    expect(real.getByText("Arriendo").nextSibling?.textContent).toMatch(/30\.000/);
    expect(real.getByText("Nómina").nextSibling?.textContent).toMatch(/10\.000/);
    expect(real.getByText("Servicios").nextSibling?.textContent).toMatch(/5\.000/);
    expect(real.queryByText("Proveedores")).toBeNull();
  });

  it("la tarjeta principal pasa a llamarse 'Utilidad neta real'", () => {
    mount({ fixedExpenses: FIXED });
    expect(screen.getAllByText("Utilidad neta real").length).toBeGreaterThanOrEqual(2); // tarjeta + panel
    expect(screen.queryByText("Ganancia neta")).toBeNull();
  });

  it("sin VIMDY Contable todo queda como antes: 'Ganancia neta' y sin desglose", () => {
    mount();
    expect(screen.getByText("Ganancia neta")).toBeTruthy();
    expect(screen.queryByRole("region", { name: "Utilidad neta real" })).toBeNull();
    expect(screen.queryByText("Utilidad neta real")).toBeNull();
  });

  it("si los gastos fijos superan la ganancia, la utilidad real se ve negativa", () => {
    const big = summarizeFixedExpenses([expense({ category: "arriendo", amount: 200000 })]);
    mount({ fixedExpenses: big });
    const total = within(panel()).getByText("Utilidad neta real", { selector: "dt" }).nextSibling as HTMLElement;
    expect(total.textContent).toMatch(/-/);
    expect(total.getAttribute("data-tone")).toBe("bad");
  });

  it("sin ventas pero con gastos fijos muestra la pérdida junto al estado vacío", () => {
    mount({ input: { ...INPUT, sales: [] }, fixedExpenses: FIXED });
    expect(within(panel()).getByText("Utilidad neta real", { selector: "dt" }).nextSibling?.textContent).toMatch(/-.*45\.000/);
    expect(screen.getByText("Aún no hay ventas para calcular tus ganancias.")).toBeTruthy();
  });

  it("sin ventas y sin gastos fijos solo se ve el estado vacío", () => {
    mount({ input: { ...INPUT, sales: [] }, fixedExpenses: summarizeFixedExpenses([]) });
    expect(screen.queryByRole("region", { name: "Utilidad neta real" })).toBeNull();
    expect(screen.getByText("Aún no hay ventas para calcular tus ganancias.")).toBeTruthy();
  });

  it("si los gastos fijos no cargaron avisa que la ganancia NO los incluye (no los da por cero)", () => {
    mount({ fixedExpensesError: "sin conexión" });
    const alert = screen.getByRole("alert");
    expect(alert.textContent).toMatch(/sin conexión/);
    expect(alert.textContent).toMatch(/NO los incluye/);
    expect(screen.getByText("Ganancia neta")).toBeTruthy();
    expect(screen.queryByRole("region", { name: "Utilidad neta real" })).toBeNull();
  });

  it("muestra la nota de periodo corto cuando se pide", () => {
    mount({ fixedExpenses: FIXED, fixedExpensesNote: "Elige «Este mes» para ver el mes completo." });
    expect(within(panel()).getByText(/Elige «Este mes»/)).toBeTruthy();
  });
});