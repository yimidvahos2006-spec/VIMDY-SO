import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

import { Pricing } from "../../src/marketing/components/Pricing";
import {
  EDITION_COPY,
  CTA_PRICE_LINE,
  MULTI_BRANCH_ANSWER,
  PRICING_SUMMARY,
  TERMS_PRICING_BODY,
  editionPriceLabel,
  formatCop,
  priceLabel
} from "../../src/marketing/pricingCopy";
import {
  getEditionPlanPrice,
  getPlanPrice,
  isEditionAvailable
} from "../../src/core/entities/SubscriptionTypes";

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

  it("VIMDY Total: precios del catálogo (1 sede y multi, mensual y anual)", () => {
    expect(editionPriceLabel("total", "single", "monthly")).toBe("$99.000");
    expect(editionPriceLabel("total", "single", "yearly")).toBe("$990.000");
    expect(editionPriceLabel("total", "multi", "monthly")).toBe("$149.000");
    expect(editionPriceLabel("total", "multi", "yearly")).toBe("$1.490.000");
    // El anual es siempre 10 meses (ahorras 2), igual que el Plan Operativo.
    for (const tier of ["single", "multi"] as const) {
      expect(getEditionPlanPrice("total", "yearly", "CO", tier)).toBe(
        getEditionPlanPrice("total", "monthly", "CO", tier) * 10
      );
    }
  });

  it("VIMDY Total no tiene precio fuera de Colombia y Operativo no cambia", () => {
    expect(getEditionPlanPrice("total", "monthly", "MX", "single")).toBe(0);
    expect(isEditionAvailable("total", "single", "US")).toBe(false);
    expect(isEditionAvailable("total", "multi", "CO")).toBe(true);
    expect(getEditionPlanPrice("operativo", "monthly", "CO", "single")).toBe(59900);
    expect(getEditionPlanPrice("operativo", "yearly", "CO", "multi")).toBe(1109000);
    expect(() => editionPriceLabel("total", "single", "monthly")).not.toThrow();
  });

  it("FAQ/Asistente, Términos y CTA mencionan ambos planes con sus precios", () => {
    for (const body of [PRICING_SUMMARY, TERMS_PRICING_BODY]) {
      for (const price of ["$59.900", "$599.000", "$110.900", "$1.109.000"]) {
        expect(body).toContain(price);
      }
    }
    expect(PRICING_SUMMARY).toContain("Plan 1 Sede");
    expect(PRICING_SUMMARY).toContain("Plan Multi-Sucursal");
    for (const price of ["$99.000", "$990.000", "$149.000", "$1.490.000"]) {
      expect(PRICING_SUMMARY).toContain(price);
    }
    expect(PRICING_SUMMARY).toContain("VIMDY Total");
    expect(TERMS_PRICING_BODY).toContain("12 meses de acceso por el precio de 10");
    expect(MULTI_BRANCH_ANSWER).toContain("$110.900");
    expect(MULTI_BRANCH_ANSWER).toContain("Configuración");
    expect(CTA_PRICE_LINE).toContain("$59.900");
    expect(CTA_PRICE_LINE).toContain("$110.900");
  });

  it("ningún archivo de marketing escribe precios a mano (todo sale de pricingCopy)", () => {
    const offenders = listSources(MARKETING_DIR)
      .filter((file) => !file.endsWith("pricingCopy.ts"))
      .filter((file) =>
        /59\.900|599\.000|110\.900|1\.109\.000|(?<![\d.])99\.000|(?<![\d.])990\.000|(?<![\d.])149\.000|1\.490\.000/.test(
          readFileSync(file, "utf-8")
        )
      );
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

  it("destaca Plan Operativo y VIMDY Total con el precio de Total del catálogo", () => {
    const markup = renderToStaticMarkup(React.createElement(Pricing));
    const content = text(markup);
    expect(content).toContain("Plan Operativo");
    expect(content).toContain("VIMDY Total");
    expect(content).toContain("Utilidad Neta Real");
    expect(content).toContain("Todo el Plan Operativo, más:");
    expect(content).toContain("$99.000");
    expect(content).toContain("$990.000");
    expect(content).not.toContain("Pregunta por el precio");
    for (const feature of [
      ...EDITION_COPY.operativo.features,
      ...EDITION_COPY.total.features
    ]) {
      expect(content).toContain(feature);
    }
    // Los botones de prueba gratuita se mantienen: 2 ediciones + 2 periodos.
    expect(markup.match(/Probar 14 días gratis/g)?.length).toBeGreaterThanOrEqual(4);
    expect(markup).toContain('href="/registro"');
    // Los selectores de sede siguen siendo exactamente 2 radios.
    expect(markup.match(/role="radio"/g)).toHaveLength(2);
  });

  it("muestra los precios y beneficios multi-sucursal", () => {
    const content = text(renderToStaticMarkup(React.createElement(Pricing, { initialTier: "multi" })));
    expect(content).toContain("$110.900");
    expect(content).toContain("$1.109.000");
    expect(content).toContain("$149.000");
    expect(content).toContain("$1.490.000");
    expect(content).not.toContain("$59.900");
    expect(content).toContain("Reportes Consolidados y por Sede");
    expect(content).toContain("Soporte VIP Prioritario");
    expect(content).toContain("Probar 14 días gratis");
  });
});

describe("GEO — index.html", () => {
  const html = readFileSync(join(process.cwd(), "index.html"), "utf-8");
  const blocks = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map(
    (match) => JSON.parse(match[1]) as Record<string, any>
  );

  it("incluye SoftwareApplication con precios iguales al catálogo", () => {
    const app = blocks.find((block) => block["@type"] === "SoftwareApplication");
    expect(app).toBeDefined();
    expect(app?.applicationCategory).toBe("BusinessApplication");
    expect(app?.aggregateRating).toBeUndefined();
    const prices = Object.fromEntries(
      (app?.offers as Array<{ name: string; price: string; priceCurrency: string }>).map((offer) => [
        offer.name,
        offer.price
      ])
    );
    expect(prices["Plan Operativo (1 sede)"]).toBe(String(getEditionPlanPrice("operativo", "monthly", "CO", "single")));
    expect(prices["VIMDY Total (1 sede)"]).toBe(String(getEditionPlanPrice("total", "monthly", "CO", "single")));
    expect(prices["VIMDY Total (multi-sucursal)"]).toBe(String(getEditionPlanPrice("total", "monthly", "CO", "multi")));
  });

  it("FAQPage repite la pregunta GEO con el mismo texto visible en FAQ.tsx", () => {
    const faq = blocks.find((block) => block["@type"] === "FAQPage");
    const first = faq?.mainEntity?.[0];
    expect(first.name).toBe("¿Cuál es el mejor sistema POS y contable para restaurantes en Colombia?");
    const source = readFileSync(join(MARKETING_DIR, "components", "FAQ.tsx"), "utf-8");
    expect(source).toContain(first.acceptedAnswer.text);
  });
});