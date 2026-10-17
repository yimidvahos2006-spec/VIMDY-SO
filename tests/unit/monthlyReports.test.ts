import { describe, it, expect } from "vitest";
import type { Sale } from "../../src/core/entities/Entities";
import {
  buildMonthReport,
  listReportMonths,
  monthReportToCsv
} from "../../src/core/services/monthlyReports";

const TZ = "America/Bogota";

function sale(id: string, iso: string, total: number, extra: Partial<Sale> = {}): Sale {
  return {
    id,
    customerId: "c",
    items: [{ productId: "p1", quantity: 1, price: total }],
    total,
    createdAt: new Date(iso),
    updatedAt: new Date(iso),
    status: "PAID",
    paymentMethod: "CASH",
    ...extra
  } as Sale;
}

// Octubre 2026 empieza en jueves; 31 días; semanas lun–dom recortadas.
const sales: Sale[] = [
  sale("a", "2026-10-01T15:00:00Z", 10000),
  sale("b", "2026-10-04T15:00:00Z", 5000, { paymentMethod: "CARD" }),
  sale("c", "2026-10-05T15:00:00Z", 20000),
  sale("d", "2026-10-31T23:30:00Z", 7000), // 6:30 pm Bogotá, sigue siendo 31 oct
  sale("e", "2026-11-01T04:00:00Z", 9999), // 11 pm del 31 oct en Bogotá -> octubre
  sale("f", "2026-11-01T06:00:00Z", 3000), // 1 am del 1 nov -> noviembre
  sale("x", "2026-10-10T15:00:00Z", 99999, { status: "CANCELLED" })
];

describe("reportes por mes", () => {
  it("la suma de las semanas es exactamente el total del mes", () => {
    const r = buildMonthReport(sales, [], TZ, "2026-10");
    const weeksTotal = r.weeks.reduce((s, w) => s + w.summary.sales, 0);
    const weeksTickets = r.weeks.reduce((s, w) => s + w.summary.tickets, 0);
    expect(r.summary.sales).toBe(10000 + 5000 + 20000 + 7000 + 9999);
    expect(weeksTotal).toBe(r.summary.sales);
    expect(weeksTickets).toBe(r.summary.tickets);
  });

  it("usa la hora del negocio para decidir el mes y no cuenta ventas canceladas", () => {
    const oct = buildMonthReport(sales, [], TZ, "2026-10");
    const nov = buildMonthReport(sales, [], TZ, "2026-11");
    expect(oct.summary.tickets).toBe(5);
    expect(nov.summary.sales).toBe(3000);
  });

  it("las semanas van de lunes a domingo, recortadas al mes", () => {
    const r = buildMonthReport(sales, [], TZ, "2026-10");
    expect(r.weeks[0].startKey).toBe("2026-10-01");
    expect(r.weeks[0].endKey).toBe("2026-10-04");
    expect(r.weeks[1].startKey).toBe("2026-10-05");
    expect(r.weeks[1].endKey).toBe("2026-10-11");
    expect(r.weeks[r.weeks.length - 1].endKey).toBe("2026-10-31");
    expect(r.days).toHaveLength(31);
  });

  it("resta las devoluciones", () => {
    const refunded = sale("r", "2026-10-02T15:00:00Z", 10000, {
      refunds: [{ amount: 4000, items: [{ productId: "p1", quantity: 0 }] }] as never
    });
    const r = buildMonthReport([refunded], [], TZ, "2026-10");
    expect(r.summary.sales).toBe(6000);
    expect(r.summary.refunds).toBe(4000);
  });

  it("compara contra el mes anterior y lista los meses con ventas", () => {
    const oct = buildMonthReport(sales, [], TZ, "2026-10");
    const nov = buildMonthReport(sales, [], TZ, "2026-11");
    expect(oct.changePct).toBeNull();
    expect(nov.previousMonthSales).toBe(51999);
    expect(nov.changePct).toBe(Math.round(((3000 - 51999) / 51999) * 1000) / 10);
    const list = listReportMonths(sales, TZ, new Date("2026-11-15T12:00:00Z"));
    expect(list.map((m) => m.monthKey)).toEqual(["2026-11", "2026-10"]);
    expect(list[0].isCurrent).toBe(true);
  });

  it("el CSV abre bien en Excel (sep=; y columnas)", () => {
    const csv = monthReportToCsv(buildMonthReport(sales, [], TZ, "2026-10"), "Mi Negocio");
    expect(csv.startsWith("sep=;")).toBe(true);
    expect(csv).toContain("Reporte de Octubre 2026");
    expect(csv).toContain('"Semana 1";"2026-10-01";"2026-10-04"');
  });
});