import { describe, it, expect } from "vitest";
import type { Sale } from "../../src/core/entities/Entities";
import { buildMonthReport } from "../../src/core/services/monthlyReports";
import {
  buildMonthDownload,
  changeTrend,
  csvBusinessName,
  csvDecimalsFor,
  formatChangePct,
  monthDownloadFromReport,
  monthHasSales,
  weekDownloadFromReport
} from "../../src/core/services/monthlyReportsDownload";

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

// Octubre 2026 empieza en jueves; semana 1 = 1 al 4 de octubre.
const sales: Sale[] = [
  sale("a", "2026-10-01T15:00:00Z", 10000),
  sale("b", "2026-10-04T15:00:00Z", 5000, { paymentMethod: "CARD" }),
  sale("c", "2026-10-05T15:00:00Z", 20000),
  sale("d", "2026-10-31T23:30:00Z", 7000),
  sale("e", "2026-11-01T04:00:00Z", 9999), // 11 pm del 31 oct en Bogotá -> octubre
  sale("f", "2026-11-01T06:00:00Z", 3000), // 1 am del 1 nov en Bogotá -> noviembre
  sale("x", "2026-10-10T15:00:00Z", 99999, { status: "CANCELLED" })
];

describe("nombre del negocio en el CSV", () => {
  it("deja el encabezado sin nombre si es el de fábrica o está vacío", () => {
    expect(csvBusinessName("VIMDY Demo")).toBe("");
    expect(csvBusinessName("  vimdy demo  ")).toBe("");
    expect(csvBusinessName("")).toBe("");
    expect(csvBusinessName("   ")).toBe("");
    expect(csvBusinessName(undefined)).toBe("");
    expect(csvBusinessName(null)).toBe("");
  });

  it("usa el nombre real sin espacios sobrantes", () => {
    expect(csvBusinessName("  Café Don Pepe ")).toBe("Café Don Pepe");
  });
});

describe("decimales y porcentaje", () => {
  it("COP no lleva decimales y USD lleva 2", () => {
    expect(csvDecimalsFor("COP")).toBe(0);
    expect(csvDecimalsFor("cop")).toBe(0);
    expect(csvDecimalsFor("USD")).toBe(2);
  });

  it("escribe el % contra el mes anterior", () => {
    expect(formatChangePct(null)).toBeNull();
    expect(formatChangePct(12.5)).toBe("+12,5 %");
    expect(formatChangePct(-3)).toBe("-3,0 %");
    expect(formatChangePct(0)).toBe("0,0 %");
    expect(changeTrend(null)).toBeNull();
    expect(changeTrend(12.5)).toBe("up");
    expect(changeTrend(-3)).toBe("down");
    expect(changeTrend(0)).toBe("flat");
  });
});

describe("descarga del mes", () => {
  it("el CSV del mes trae el nombre del negocio, el total neto y el número de ventas", () => {
    const d = buildMonthDownload(sales, [], TZ, "2026-10", "Mi Negocio", "COP");
    expect(d.fileName).toBe("reporte-vimdy-2026-10.csv");
    expect(d.csv.startsWith("sep=;")).toBe(true);
    expect(d.csv).toContain('"Mi Negocio — Reporte de Octubre 2026"');
    // 10000 + 5000 + 20000 + 7000 + 9999; la venta cancelada no cuenta
    expect(d.csv).toContain('"Ventas netas (ya sin devoluciones)";"51999"');
    expect(d.csv).toContain('"Número de ventas";"5"');
    expect(d.csv).not.toContain("99999");
  });

  it("con el nombre de fábrica el encabezado queda sin nombre", () => {
    const d = buildMonthDownload(sales, [], TZ, "2026-10", "VIMDY Demo", "COP");
    expect(d.csv).toContain('sep=;\r\n"Reporte de Octubre 2026"');
    expect(d.csv).not.toContain("VIMDY Demo");
  });

  it("mide el mes con la zona horaria del negocio, no la del equipo", () => {
    const bogota = buildMonthDownload(sales, [], TZ, "2026-11", "X", "COP");
    expect(bogota.csv).toContain('"Ventas netas (ya sin devoluciones)";"3000"');
    // En Nueva Zelanda (UTC+13 en esas fechas) las ventas d, e y f ya son de noviembre.
    const auckland = buildMonthDownload(sales, [], "Pacific/Auckland", "2026-11", "X", "COP");
    expect(auckland.csv).toContain('"Ventas netas (ya sin devoluciones)";"19999"');
  });

  it("resta las devoluciones", () => {
    const refunded = sale("r", "2026-10-02T15:00:00Z", 10000, {
      refunds: [{ amount: 4000, items: [{ productId: "p1", quantity: 0 }] }] as never
    });
    const d = buildMonthDownload([refunded], [], TZ, "2026-10", "X", "COP");
    expect(d.csv).toContain('"Ventas netas (ya sin devoluciones)";"6000"');
    expect(d.csv).toContain('"Devoluciones";"4000"');
  });

  it("usa los decimales de la moneda", () => {
    const d = buildMonthDownload(sales, [], TZ, "2026-10", "X", "USD");
    expect(d.csv).toContain('"Ventas netas (ya sin devoluciones)";"51999.00"');
  });

  it("detecta un mes sin ventas para no descargar un archivo vacío", () => {
    expect(monthHasSales(buildMonthReport(sales, [], TZ, "2026-10"))).toBe(true);
    expect(monthHasSales(buildMonthReport(sales, [], TZ, "2026-09"))).toBe(false);
  });
});

describe("descarga de una semana", () => {
  const report = buildMonthReport(sales, [], TZ, "2026-10");

  it("la semana 1 va del 1 al 4 de octubre y trae solo sus ventas", () => {
    const d = weekDownloadFromReport(report, 1, "Mi Negocio", "COP");
    expect(d).not.toBeNull();
    expect(d!.fileName).toBe("reporte-vimdy-2026-10-semana-1.csv");
    expect(d!.csv.startsWith("sep=;")).toBe(true);
    expect(d!.csv).toContain('"Mi Negocio — Semana 1 · 1 oct al 4 oct (Octubre 2026)"');
    expect(d!.csv).toContain('"Ventas netas (ya sin devoluciones)";"15000"');
    expect(d!.csv).toContain('"Número de ventas";"2"');
  });

  it("la suma de las semanas descargadas es el total del mes", () => {
    const total = report.weeks.reduce((sum, w) => {
      const d = weekDownloadFromReport(report, w.index, "X", "COP")!;
      const match = d.csv.match(/"Ventas netas \(ya sin devoluciones\)";"(\d+)"/);
      return sum + Number(match![1]);
    }, 0);
    const month = monthDownloadFromReport(report, "X", "COP");
    expect(month.csv).toContain(`"Ventas netas (ya sin devoluciones)";"${total}"`);
    expect(total).toBe(51999);
  });

  it("devuelve null si la semana no existe", () => {
    expect(weekDownloadFromReport(report, 99, "X", "COP")).toBeNull();
  });
});
