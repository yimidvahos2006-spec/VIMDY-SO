// @vitest-environment jsdom
import { createElement as h } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

import { buildBusinessOperatingProfile } from "../../src/core/config/businessOperatingProfile";
import type { ModuleId } from "../../src/core/config/modules";
import { DEFAULT_OPERATION_CONFIG } from "../../src/core/config/operation";
import { permissionsForRole } from "../../src/core/config/permissions";
import { businessOperatingProfileStore } from "../../src/core/store/businessOperatingProfileStore";
import type { FixedExpense } from "../../src/core/types/fixedExpense";

const mocks = vi.hoisted(() => ({
  role: "ADMIN" as string,
  listFixedExpenses: vi.fn()
}));

vi.mock("../../src/presentation/context/AuthContext", () => ({
  useAuth: () => {
    const permissions = permissionsForRole(mocks.role);
    return {
      businessId: "b1",
      role: { name: mocks.role, permissions },
      can: (permission: string) => permissions.includes("*") || permissions.includes(permission)
    };
  }
}));

vi.mock("../../src/infrastructure/supabase/fixedExpenseService", () => ({
  listFixedExpenses: mocks.listFixedExpenses
}));

// Ventas y catálogo del POS: 10 platos a $10.000; cada plato gasta 2 insumos a $1.000
// → ventas 100.000, costo de insumos 20.000.
vi.mock("../../src/infrastructure/di/CompositionRoot", () => ({
  productsReady: Promise.resolve(),
  container: {
    salesEngine: {
      get: () => ({
        getAllSales: async () => [
          {
            id: "s1",
            status: "PAID",
            createdAt: new Date(),
            total: 100000,
            discount: 0,
            refunds: [],
            items: [{ productId: "plato", name: "Plato", price: 10000, quantity: 10 }]
          }
        ]
      })
    },
    inventoryEngine: {
      get: () => ({
        listAll: async () => [
          { id: "insumo", name: "Insumo", averageCost: 1000, purchasePrice: 1000, recipe: [] },
          { id: "plato", name: "Plato", price: 10000, recipe: [{ productId: "insumo", quantity: 2 }] }
        ]
      })
    }
  }
}));

import { ProfitCenterDashboard } from "../../src/presentation/components/profit/ProfitCenterDashboard";

const expense = (over: Partial<FixedExpense>): FixedExpense => ({
  id: "e",
  businessId: "b1",
  branchId: null,
  category: "arriendo",
  amount: 30000,
  expenseDate: "2026-11-03",
  description: "",
  createdAt: "2026-11-03T12:00:00Z",
  ...over
});

function setModules(enabledModules: ModuleId[]) {
  businessOperatingProfileStore.ready(
    buildBusinessOperatingProfile({
      businessId: "b1",
      businessType: "restaurante",
      enabledModules,
      operationConfig: DEFAULT_OPERATION_CONFIG
    })
  );
}

/** Fecha de hoy en Colombia (zona horaria del negocio por defecto), sin pasar por UTC. */
const today = () =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "America/Bogota", year: "numeric", month: "2-digit", day: "2-digit" }).format(
    new Date()
  );

beforeEach(() => {
  mocks.role = "ADMIN";
  mocks.listFixedExpenses.mockReset();
  mocks.listFixedExpenses.mockResolvedValue([expense({})]);
  businessOperatingProfileStore.clear();
});
afterEach(() => {
  cleanup();
  businessOperatingProfileStore.clear();
});

describe("ProfitCenterDashboard conectado a VIMDY Contable", () => {
  it("con el módulo activo y rol ADMIN calcula la utilidad neta real en vivo", async () => {
    setModules(["caja", "pedidos", "inventario", "contable"]);
    render(h(ProfitCenterDashboard));

    const region = await screen.findByRole("region", { name: "Utilidad neta real" });
    // 100.000 ventas − 20.000 insumos − 30.000 arriendo = 50.000
    expect(region.textContent).toMatch(/50\.000/);

    expect(mocks.listFixedExpenses).toHaveBeenCalledTimes(1);
    const [businessId, filter] = mocks.listFixedExpenses.mock.calls[0]!;
    expect(businessId).toBe("b1");
    expect(filter.from).toMatch(/^\d{4}-\d{2}-01$/); // "Este mes": desde el día 1
    expect(filter.to).toBe(today()); // hasta hoy (hora de Colombia)
  });

  it("el CONTADOR (solo lectura) también ve la utilidad neta real", async () => {
    mocks.role = "CONTADOR";
    setModules(["caja", "pedidos", "inventario", "contable"]);
    render(h(ProfitCenterDashboard));
    expect(await screen.findByRole("region", { name: "Utilidad neta real" })).toBeTruthy();
    expect(mocks.listFixedExpenses).toHaveBeenCalledTimes(1);
  });

  it("sin el módulo activo NO consulta gastos fijos y todo queda como antes", async () => {
    setModules(["caja", "pedidos", "inventario"]);
    render(h(ProfitCenterDashboard));

    expect(await screen.findByText("Ganancia neta")).toBeTruthy();
    expect(screen.queryByRole("region", { name: "Utilidad neta real" })).toBeNull();
    expect(mocks.listFixedExpenses).not.toHaveBeenCalled();
  });

  it("un rol sin acceso a gastos fijos (INVENTARIO) no los consulta aunque el módulo esté activo", async () => {
    mocks.role = "INVENTARIO"; // tiene reports.view (ve Ganancias) pero no accounting.view
    setModules(["caja", "pedidos", "inventario", "contable"]);
    render(h(ProfitCenterDashboard));

    expect(await screen.findByText("Ganancia neta")).toBeTruthy();
    expect(screen.queryByRole("region", { name: "Utilidad neta real" })).toBeNull();
    expect(mocks.listFixedExpenses).not.toHaveBeenCalled();
  });

  it("si falla la carga de gastos fijos avisa y NO los cuenta como cero", async () => {
    mocks.listFixedExpenses.mockRejectedValue(new Error("sin conexión"));
    setModules(["caja", "pedidos", "inventario", "contable"]);
    render(h(ProfitCenterDashboard));

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toMatch(/NO los incluye/);
    expect(screen.getByText("Ganancia neta")).toBeTruthy();
    expect(screen.queryByRole("region", { name: "Utilidad neta real" })).toBeNull();
  });

  it("al cambiar a 'Hoy' vuelve a consultar solo los gastos de hoy y explica cómo se cuentan", async () => {
    setModules(["caja", "pedidos", "inventario", "contable"]);
    render(h(ProfitCenterDashboard));
    await screen.findByRole("region", { name: "Utilidad neta real" });

    fireEvent.click(screen.getByRole("button", { name: "Hoy" }));

    await waitFor(() => expect(mocks.listFixedExpenses).toHaveBeenCalledTimes(2));
    expect(mocks.listFixedExpenses.mock.calls[1]![1]).toEqual({ from: today(), to: today() });
    const region = await screen.findByRole("region", { name: "Utilidad neta real" });
    expect(region.textContent).toMatch(/Este mes/);
  });
});