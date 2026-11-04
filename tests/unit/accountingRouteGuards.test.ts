// @vitest-environment jsdom
import { createElement as h } from "react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

import { buildBusinessOperatingProfile } from "../../src/core/config/businessOperatingProfile";
import type { ModuleId } from "../../src/core/config/modules";
import { DEFAULT_OPERATION_CONFIG } from "../../src/core/config/operation";
import { permissionsForRole } from "../../src/core/config/permissions";
import { ROUTE_PERMISSIONS } from "../../src/core/config/roleAccess";
import { businessOperatingProfileStore } from "../../src/core/store/businessOperatingProfileStore";

// La sesión se simula por rol, con los permisos REALES de cada rol.
const auth = vi.hoisted(() => ({ role: "ADMIN" as string }));
vi.mock("../../src/presentation/context/AuthContext", () => ({
  useAuth: () => {
    const permissions = permissionsForRole(auth.role);
    return {
      isAuthenticated: true,
      isReady: true,
      role: { name: auth.role, permissions },
      can: (permission: string) => permissions.includes("*") || permissions.includes(permission)
    };
  }
}));

import { ProtectedRoute } from "../../src/presentation/navigation/ProtectedRoute";
import { RequireModule } from "../../src/presentation/navigation/RequireModule";

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

/** La misma envoltura que usa routes/App.tsx para /gastos-fijos. */
function renderRoute() {
  return render(
    h(
      MemoryRouter,
      { initialEntries: ["/gastos-fijos"] },
      h(
        Routes,
        null,
        h(Route, {
          path: "/gastos-fijos",
          element: h(
            ProtectedRoute,
            { requires: ROUTE_PERMISSIONS["/gastos-fijos"] },
            h(RequireModule, { module: "contable" }, h("div", null, "PANEL DE GASTOS FIJOS"))
          )
        }),
        h(Route, { path: "/dashboard", element: h("div", null, "INICIO") }),
        h(Route, { path: "/meseros", element: h("div", null, "INICIO MESERO") })
      )
    )
  );
}

beforeEach(() => businessOperatingProfileStore.clear());
afterEach(() => {
  cleanup();
  businessOperatingProfileStore.clear();
});

describe("/gastos-fijos: rol Y módulo VIMDY Contable activo", () => {
  it.each(["ADMIN", "GERENTE", "CONTADOR"])("%s con el módulo activo entra al panel", (role) => {
    auth.role = role;
    setModules(["caja", "pedidos", "contable"]);
    renderRoute();
    expect(screen.getByText("PANEL DE GASTOS FIJOS")).toBeTruthy();
  });

  it.each(["ADMIN", "GERENTE", "CONTADOR"])("%s con el módulo APAGADO es redirigido al inicio", (role) => {
    auth.role = role;
    setModules(["caja", "pedidos"]);
    renderRoute();
    expect(screen.queryByText("PANEL DE GASTOS FIJOS")).toBeNull();
    expect(screen.getByText("INICIO")).toBeTruthy();
  });

  it.each(["CAJERO", "MESERO", "COCINA", "INVENTARIO", "SOPORTE"])(
    "%s NO entra aunque el módulo esté activo",
    (role) => {
      auth.role = role;
      setModules(["caja", "pedidos", "contable"]);
      renderRoute();
      expect(screen.queryByText("PANEL DE GASTOS FIJOS")).toBeNull();
    }
  );

  it("mientras se carga la configuración del negocio no muestra el panel", () => {
    auth.role = "ADMIN";
    businessOperatingProfileStore.loading("b1");
    renderRoute();
    expect(screen.queryByText("PANEL DE GASTOS FIJOS")).toBeNull();
    expect(screen.getByRole("status").textContent).toMatch(/Cargando/);
  });

  it("si la configuración falló, no abre el módulo", () => {
    auth.role = "ADMIN";
    businessOperatingProfileStore.fail("b1", "sin red");
    renderRoute();
    expect(screen.queryByText("PANEL DE GASTOS FIJOS")).toBeNull();
  });
});