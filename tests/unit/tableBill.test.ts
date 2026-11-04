// tests/unit/tableBill.test.ts
/* ===========================================================================
   Gestión y cierre de mesa (Parte 4)

   1. Qué acciones se ofrecen según el estado de la mesa y el rol, y por qué
      una acción NO está disponible.
   2. Pre-cuenta: sale de la mesa tal cual (no recalcula), nunca muestra un
      id interno, y el documento NO se parece a un recibo de pago.
   3. Seguridad del documento: el texto del cliente/producto se escapa.
   =========================================================================== */

import { describe, it, expect } from "vitest";
import type { SaleItem, Table, TableStatus } from "../../src/core/entities/Entities";
import {
  MANAGE_REASONS,
  buildPreBill,
  getManageActions,
  isBillRequested,
  isTableOpen,
  shouldMarkBillRequested
} from "../../src/core/services/tableBill";
import {
  PRE_BILL_DISCLAIMER,
  renderPreBillDocument
} from "../../src/presentation/utils/printPreBillDocument";
import { DEFAULT_PRINT_SETTINGS } from "../../src/core/store/printSettingsStore";
import type { Business } from "../../src/core/store/businessStore";

const ALL_STATUSES: TableStatus[] = [
  "FREE",
  "RESERVED",
  "BUSY",
  "WAITING_FOOD",
  "EATING",
  "CUENTA_SOLICITADA",
  "WAITING_BILL",
  "PAYING",
  "CLOSED"
];

const item = (productId: string, quantity: number, price: number, note?: string): SaleItem =>
  ({ productId, quantity, price, ...(note ? { note } : {}) }) as SaleItem;

function makeTable(overrides: Partial<Table> = {}): Table {
  return {
    id: "t7",
    name: "Mesa 7",
    capacity: 4,
    peopleCount: 3,
    status: "EATING",
    items: [item("burger", 2, 18000, "sin cebolla"), item("cola", 3, 4000)],
    subtotal: 40000,
    tax: 3200,
    discount: 0,
    total: 43200,
    openedAt: new Date("2026-11-03T18:00:00Z"),
    ...overrides
  } as Table;
}

const names: Record<string, string> = { burger: "Hamburguesa", cola: "Gaseosa" };
const resolve = (id: string) => names[id];

const BUSINESS: Business = {
  name: "Casa Vimdy",
  nit: "900123456-7",
  owner: "",
  phone: "3001112233",
  email: "",
  address: "Calle 1 # 2-3",
  city: "Medellín",
  country: "CO",
  logo: "",
  currency: "COP"
};

describe("estados de la mesa", () => {
  it("solo FREE, RESERVED y CLOSED NO tienen cuenta abierta", () => {
    const open = ALL_STATUSES.filter(isTableOpen);
    expect(open).toEqual(["BUSY", "WAITING_FOOD", "EATING", "CUENTA_SOLICITADA", "WAITING_BILL", "PAYING"]);
  });

  it("pidiendo cuenta = CUENTA_SOLICITADA o WAITING_BILL (Cobrando no cuenta)", () => {
    expect(ALL_STATUSES.filter(isBillRequested)).toEqual(["CUENTA_SOLICITADA", "WAITING_BILL"]);
  });

  it("la pre-cuenta marca 'Por cobrar' solo si todavía no lo estaba y no se está cobrando", () => {
    expect(ALL_STATUSES.filter(shouldMarkBillRequested)).toEqual(["BUSY", "WAITING_FOOD", "EATING"]);
  });
});

describe("getManageActions", () => {
  it("mesa con consumo y rol que cobra: todo disponible salvo liberar", () => {
    const actions = getManageActions(makeTable(), { canCharge: true });
    expect(actions.viewDetail.enabled).toBe(true);
    expect(actions.preBill.enabled).toBe(true);
    expect(actions.addProducts.enabled).toBe(true);
    expect(actions.charge.enabled).toBe(true);
    expect(actions.release.enabled).toBe(false);
    expect(actions.release.reason).toBe(MANAGE_REASONS.hasItems);
  });

  it("un mesero (no cobra) ve el motivo, no un error del servidor", () => {
    const actions = getManageActions(makeTable(), { canCharge: false });
    expect(actions.charge.enabled).toBe(false);
    expect(actions.charge.reason).toBe(MANAGE_REASONS.cannotCharge);
    // Lo demás sigue disponible para él.
    expect(actions.preBill.enabled).toBe(true);
    expect(actions.addProducts.enabled).toBe(true);
  });

  it("mesa abierta sin consumo: se puede agregar y liberar; no hay pre-cuenta ni cobro", () => {
    const actions = getManageActions(makeTable({ items: [], status: "BUSY" }), { canCharge: true });
    expect(actions.addProducts.enabled).toBe(true);
    expect(actions.release.enabled).toBe(true);
    expect(actions.preBill.enabled).toBe(false);
    expect(actions.preBill.reason).toBe(MANAGE_REASONS.empty);
    expect(actions.charge.enabled).toBe(false);
    expect(actions.charge.reason).toBe(MANAGE_REASONS.empty);
  });

  it("cobro en curso (PAYING): no se cambia la cuenta ni se libera; la pre-cuenta sí se puede reimprimir", () => {
    const actions = getManageActions(makeTable({ status: "PAYING" }), { canCharge: true });
    expect(actions.addProducts.enabled).toBe(false);
    expect(actions.addProducts.reason).toBe(MANAGE_REASONS.paying);
    expect(actions.preBill.enabled).toBe(true);

    const empty = getManageActions(makeTable({ status: "PAYING", items: [] }), { canCharge: true });
    expect(empty.release.enabled).toBe(false);
    expect(empty.release.reason).toBe(MANAGE_REASONS.paying);
  });

  it.each(["FREE", "RESERVED", "CLOSED"] as TableStatus[])(
    "mesa %s (sin cuenta abierta): nada disponible",
    (status) => {
      const actions = getManageActions(makeTable({ status }), { canCharge: true });
      for (const state of Object.values(actions)) {
        expect(state.enabled).toBe(false);
        expect(state.reason).toBe(MANAGE_REASONS.notOpen);
      }
    }
  );
});

describe("buildPreBill", () => {
  it("copia los totales de la mesa (no recalcula) y suma unidades", () => {
    const table = makeTable({ subtotal: 12345, tax: 678, discount: 50, total: 12973 });
    const bill = buildPreBill(table, resolve, { issuedAt: new Date("2026-11-03T19:00:00Z"), waiterName: "Laura" });
    expect(bill.subtotal).toBe(12345);
    expect(bill.tax).toBe(678);
    expect(bill.discount).toBe(50);
    expect(bill.total).toBe(12973);
    expect(bill.units).toBe(5);
    expect(bill.waiterName).toBe("Laura");
    expect(bill.tableName).toBe("Mesa 7");
  });

  it("arma las líneas con nombre, nota y total por línea", () => {
    const bill = buildPreBill(makeTable(), resolve);
    expect(bill.lines).toEqual([
      { name: "Hamburguesa", note: "sin cebolla", quantity: 2, unitPrice: 18000, lineTotal: 36000 },
      { name: "Gaseosa", quantity: 3, unitPrice: 4000, lineTotal: 12000 }
    ]);
  });

  it("nunca muestra un id interno: producto desconocido → 'Producto'", () => {
    const bill = buildPreBill(makeTable({ items: [item("uuid-raro-123", 1, 5000)] }), () => undefined);
    expect(bill.lines[0].name).toBe("Producto");
  });

  it("una nota solo con espacios no se imprime", () => {
    const bill = buildPreBill(makeTable({ items: [item("cola", 1, 4000, "   ")] }), resolve);
    expect(bill.lines[0]).not.toHaveProperty("note");
  });
});

describe("renderPreBillDocument", () => {
  const bill = buildPreBill(makeTable(), resolve, { issuedAt: new Date("2026-11-03T19:00:00Z"), waiterName: "Laura" });
  const render = (mode: "print" | "preview", settings = DEFAULT_PRINT_SETTINGS, b = bill) =>
    renderPreBillDocument(b, BUSINESS, settings, "COP", mode);

  it("dice claramente que NO es factura ni comprobante de pago", () => {
    const html = render("print");
    expect(html).toContain("PRE-CUENTA");
    expect(html).toContain(PRE_BILL_DISCLAIMER);
  });

  it("no parece un recibo: sin recibido, cambio, método de pago ni número de factura", () => {
    const html = render("print");
    for (const forbidden of ["Recibido", "Cambio", "Pago:", "Factura:"]) {
      expect(html).not.toContain(forbidden);
    }
  });

  it("incluye mesa, personas, mesero, productos y total", () => {
    const html = render("print");
    expect(html).toContain("Mesa 7");
    expect(html).toContain("Laura");
    expect(html).toContain("Hamburguesa");
    expect(html).toContain("sin cebolla");
    expect(html).toContain("TOTAL A PAGAR");
    expect(html).toContain("Casa Vimdy");
  });

  it("imprimir abre el diálogo de impresión solo; la vista previa no, y trae su botón", () => {
    const print = render("print");
    expect(print).toContain("window.print()");
    expect(print).toContain("window.onload");
    expect(print).not.toContain('class="toolbar');

    const preview = render("preview");
    expect(preview).not.toContain("window.onload");
    expect(preview).toContain('class="toolbar no-print"');
    expect(preview).toContain("Imprimir");
  });

  it("respeta Configuración > Impresión: IVA y descuento", () => {
    const withDiscount = buildPreBill(makeTable({ discount: 500 }), resolve);

    const shown = render("print", { ...DEFAULT_PRINT_SETTINGS, showTax: true, showDiscount: true }, withDiscount);
    expect(shown).toContain(">IVA<");
    expect(shown).toContain(">Descuento<");

    const hidden = render("print", { ...DEFAULT_PRINT_SETTINGS, showTax: false, showDiscount: false }, withDiscount);
    expect(hidden).not.toContain(">IVA<");
    expect(hidden).not.toContain(">Descuento<");

    // Sin descuento real, la fila no aparece aunque esté activada.
    expect(render("print", { ...DEFAULT_PRINT_SETTINGS, showDiscount: true })).not.toContain(">Descuento<");
  });

  it("escapa el texto del negocio y de los productos (nada se ejecuta en la ventana de impresión)", () => {
    const evil = buildPreBill(
      makeTable({ name: "Mesa <b>7</b>", items: [item("x", 1, 1000, '<script>alert("x")</script>')] }),
      () => "<img src=x onerror=alert(1)>"
    );
    const html = renderPreBillDocument(
      evil,
      { ...BUSINESS, name: "Bar <svg onload=1>" },
      DEFAULT_PRINT_SETTINGS,
      "COP",
      "preview"
    );
    expect(html).not.toContain("<script>alert");
    expect(html).not.toContain("<img src=x");
    expect(html).not.toContain("<svg onload");
    expect(html).not.toContain("<b>7</b>");
    expect(html).toContain("&lt;script&gt;");
  });
});