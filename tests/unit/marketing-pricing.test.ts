import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

import { Pricing } from "../../src/marketing/components/Pricing";
import {
  CTA_PRICE_LINE,
  MULTI_BRANCH_ANSWER,
  PRICING_SUMMARY,
  TERMS_PRICING_BODY,
  formatCop,
  priceLabel
} from "../../src/marketing/pricingCopy";
import { getPlanPrice } from "../../src/core/entities/SubscriptionTypes";

const MARKETING_DIR = join(process.cwd(), "src", "marketing");

function listSources(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) return listSources(full);
    return /\.(ts|tsx)$/.test(entry) ? [full] : [];
  });
}

const text = (markup: string): string => markup.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");

describe("precios del sitio público", () => {
  it("formatCop agrupa miles con punto", () => {
    expect(formatCop(59900)).toBe("$59.900");
    expect(formatCop(1109000)).toBe("$1.109.000");
  });

  it("los cuatro precios coinciden con los canónicos del modal de pago", () => {
    expect(priceLabel("single", "monthly")).toBe("$59.900");
    expect(priceLabel("single", "yearly")).toBe("$599.000");
    expect(priceLabel("multi", "monthly")).toBe("$110.900");
    expect(priceLabel("multi", "yearly")).toBe("$1.109.000");
    for (const tier of ["single", "multi"] as const) {
      for (const period of ["monthly", "yearly"] as const) {
        expect(priceLabel(tier, period)).toBe(formatCop(getPlanPrice(period, "CO", tier)));
      }
    }
  });

  it("FAQ/Asistente, Términos y CTA mencionan ambos planes con sus precios", () => {
    for (const body of [PRICING_SUMMARY, TERMS_PRICING_BODY]) {
      for (const price of ["$59.900", "$599.000", "$110.900", "$1.109.000"]) {
        expect(body).toContain(price);
      }
    }
    expect(PRICING_SUMMARY).toContain("Plan 1 Sede");
    expect(PRICING_SUMMARY).toContain("Plan Multi-Sucursal");
    expect(TERMS_PRICING_BODY).toContain("12 meses de acceso por el precio de 10");
    expect(MULTI_BRANCH_ANSWER).toContain("$110.900");
    expect(MULTI_BRANCH_ANSWER).toContain("Configuración");
    expect(CTA_PRICE_LINE).toContain("$59.900");
    expect(CTA_PRICE_LINE).toContain("$110.900");
  });

  it("ningún archivo de marketing escribe precios a mano (todo sale de pricingCopy)", () => {
    const offenders = listSources(MARKETING_DIR)
      .filter((file) => !file.endsWith("pricingCopy.ts"))
      .filter((file) => /59\.900|599\.000|110\.900|1\.109\.000/.test(readFileSync(file, "utf-8")));
    expect(offenders).toEqual([]);
  });

  it("FAQ, Asistente, Términos y CTA usan pricingCopy", () => {
    const read = (...parts: string[]) => readFileSync(join(MARKETING_DIR, ...parts), "utf-8");
    expect(read("components", "FAQ.tsx")).toContain("PRICING_SUMMARY");
    expect(read("components", "VimdyAssistant.tsx")).toContain("PRICING_SUMMARY");
    expect(read("pages", "TermsPage.tsx")).toContain("TERMS_PRICING_BODY");
    expect(read("components", "FinalCTA.tsx")).toContain("CTA_PRICE_LINE");
  });
});

describe("Pricing (landing) — render", () => {
  it("muestra el selector y los precios de 1 sede por defecto", () => {
    const markup = renderToStaticMarkup(React.createElement(Pricing));
    const content = text(markup);
    expect(markup).toContain('role="radiogroup"');
    expect(markup.match(/role="radio"/g)).toHaveLength(2);
    expect(content).toContain("Negocio de 1 sede");
    expect(content).toContain("Multi-Sucursal");
    expect(content).toContain("$59.900");
    expect(content).toContain("$599.000");
    expect(content).not.toContain("$110.900");
    expect(content).toContain("POS y Mesas Ilimitadas");
    expect(content).toContain("Reporte Diario Automático al Correo (al cerrar caja)");
  });

  it("muestra los precios y beneficios multi-sucursal", () => {
    const content = text(renderToStaticMarkup(React.createElement(Pricing, { initialTier: "multi" })));
    expect(content).toContain("$110.900");
    expect(content).toContain("$1.109.000");
    expect(content).not.toContain("$59.900");
    expect(content).toContain("Reportes Consolidados y por Sede");
    expect(content).toContain("Soporte VIP Prioritario");
    expect(content).toContain("Probar 14 días gratis");
  });
});