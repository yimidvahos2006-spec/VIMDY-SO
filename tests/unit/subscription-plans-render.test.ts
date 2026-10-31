import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { BusinessTierSelector } from "../../src/presentation/components/subscription/BusinessTierSelector";
import { PlansShowcase } from "../../src/presentation/components/subscription/PlansShowcase";

const noop = vi.fn();

function renderPlans(tier: "single" | "multi", countryCode = "CO"): string {
  return renderToStaticMarkup(
    React.createElement(PlansShowcase, { onSelectPlan: noop, countryCode, tier })
  );
}

function normalize(markup: string): string {
  return markup.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").replace(/&nbsp;| /g, " ");
}

describe("PlansShowcase — render", () => {
  it("1 sede muestra $59.900 y $599.000 COP", () => {
    const text = normalize(renderPlans("single"));
    expect(text).toContain("$59.900");
    expect(text).toContain("$599.000");
    expect(text).not.toContain("$110.900");
    expect(text).not.toContain("$1.109.000");
    expect(text).toContain("POS y Mesas Ilimitadas");
    expect(text).toContain("Reporte Diario Automático al Correo (al cerrar caja)");
    expect(text).toContain("Ahorras 2 meses");
  });

  it("multi-sucursal muestra $110.900 y $1.109.000 COP", () => {
    const text = normalize(renderPlans("multi"));
    expect(text).toContain("$110.900");
    expect(text).toContain("$1.109.000");
    expect(text).not.toContain("$59.900");
    expect(text).toContain("Reportes Consolidados y por Sede");
    expect(text).toContain("Reporte Diario por Correo para Cada Sede");
    expect(text).toContain("Soporte VIP Prioritario");
    expect(text).toContain("Ahorras 2 meses");
  });

  it("muestra dos tarjetas por nivel con su botón de compra", () => {
    for (const tier of ["single", "multi"] as const) {
      const markup = renderPlans(tier);
      expect(markup.match(/Elegir este plan/g)).toHaveLength(2);
    }
  });
});

describe("BusinessTierSelector — render", () => {
  it("expone un radiogroup con los dos niveles y marca el activo", () => {
    const markup = renderToStaticMarkup(
      React.createElement(BusinessTierSelector, { value: "multi", onChange: noop })
    );
    expect(markup).toContain('role="radiogroup"');
    expect(markup.match(/role="radio"/g)).toHaveLength(2);
    expect(markup).toContain("Negocio de 1 sede");
    expect(markup).toContain("Multi-Sucursal");
    expect(markup).toContain("2 o más sedes");
    expect(markup.match(/aria-checked="true"/g)).toHaveLength(1);
    expect(markup).toMatch(/aria-checked="true"[^>]*>(?:(?!<\/button>).)*Multi-Sucursal/s);
  });

  it("solo muestra los niveles disponibles", () => {
    const markup = renderToStaticMarkup(
      React.createElement(BusinessTierSelector, {
        value: "single",
        onChange: noop,
        availableTiers: ["single"]
      })
    );
    expect(markup.match(/role="radio"/g)).toHaveLength(1);
    expect(markup).not.toContain("Multi-Sucursal");
  });
});