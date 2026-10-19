import { describe, it, expect } from "vitest";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { Sale } from "../../src/core/entities/Entities";
import { listReportMonths } from "../../src/core/services/monthlyReports";
import { monthsOfYear, pickYear, reportYears } from "../../src/core/services/monthlyReportsDownload";
import { MonthlyReportsPanel } from "../../src/presentation/components/reports/MonthlyReportsPanel";

const TZ = "America/Bogota";
const NOW = new Date("2026-10-16T15:00:00Z");

function sale(id: string, iso: string, total: number): Sale {
  return {
    id,
    customerId: "c",
    items: [{ productId: "p1", quantity: 1, price: total }],
    total,
    createdAt: new Date(iso),
    updatedAt: new Date(iso),
    status: "PAID",
    paymentMethod: "CASH"
  } as Sale;
}

const SALES: Sale[] = [
  sale("a", "2026-10-05T15:00:00Z", 10000),
  sale("b", "2026-10-06T15:00:00Z", 20000),
  sale("c", "2026-09-10T15:00:00Z", 15000),
  sale("d", "2025-12-20T15:00:00Z", 8000)
];

function render(canExport: boolean, sales: Sale[] = SALES): string {
  return renderToStaticMarkup(
    React.createElement(MonthlyReportsPanel, {
      loading: false,
      error: null,
      allSales: sales,
      products: [],
      tz: TZ,
      businessName: "Café Luna",
      currency: "COP",
      canExport,
      now: NOW
    })
  );
}

describe("Reportes por mes: ayudantes de año", () => {
  const months = listReportMonths(SALES, TZ, NOW);

  it("lista los años del más reciente al más antiguo", () => {
    expect(reportYears(months)).toEqual([2026, 2025]);
  });

  it("filtra los meses de un año sin perder el orden", () => {
    expect(monthsOfYear(months, 2026).map((m) => m.monthKey)).toEqual(["2026-10", "2026-09"]);
    expect(monthsOfYear(months, 2025).map((m) => m.monthKey)).toEqual(["2025-12"]);
    expect(monthsOfYear(months, null)).toEqual([]);
  });

  it("pickYear usa el elegido si existe y si no el más reciente", () => {
    expect(pickYear([2026, 2025], 2025)).toBe(2025);
    expect(pickYear([2026, 2025], 2030)).toBe(2026);
    expect(pickYear([2026, 2025], null)).toBe(2026);
    expect(pickYear([], null)).toBeNull();
  });

  it("el % del primer mes del año se compara con el diciembre anterior", () => {
    const withJan = listReportMonths([...SALES, sale("e", "2026-01-10T15:00:00Z", 16000)], TZ, NOW);
    const jan = withJan.find((m) => m.monthKey === "2026-01");
    expect(jan?.changePct).toBe(100);
  });
});

describe("MonthlyReportsPanel", () => {
  it("muestra una tarjeta por mes del año actual, con ventas y cantidad", () => {
    const html = render(true);
    expect(html).toContain("Octubre 2026");
    expect(html).toContain("Septiembre 2026");
    expect(html).not.toContain("Diciembre 2025");
    expect(html).toContain("2 ventas");
    expect(html).toContain("1 venta");
    expect(html).toContain("Ver semanas");
  });

  it("muestra el selector de año con todos los años que tienen ventas", () => {
    const html = render(true);
    expect(html).toContain(">2026<");
    expect(html).toContain(">2025<");
  });

  it("con permiso reports.export aparecen los botones de descarga", () => {
    const html = render(true);
    expect(html).toContain("Descargar");
  });

  it("sin permiso reports.export NO aparece ningún botón de descarga", () => {
    const html = render(false);
    expect(html).toContain("Octubre 2026");
    expect(html).toContain("Ver semanas");
    expect(html).not.toContain("Descargar");
  });

  it("muestra el aviso vacío cuando el negocio no tiene ventas", () => {
    const html = render(true, []);
    // Siempre existe el mes actual, aunque esté en cero.
    expect(html).toContain("Octubre 2026");
    expect(html).toContain("0 ventas");
  });
});