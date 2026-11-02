import { describe, it, expect } from "vitest";

import {
  ALL_VISIBILITY_KEYS,
  PAPER_OPTIONS,
  PREVIEW_PAPER_WIDTH_PX,
  VISIBILITY_GROUPS,
  designerReducer,
  footerUsage,
  isDraftDirty,
  nextRadioIndex,
  validateDraft
} from "../../src/core/settings/ticketDesigner";
import {
  DEFAULT_PRINT_SETTINGS,
  RECEIPT_TEMPLATES,
  type PrintSettings
} from "../../src/core/store/printSettingsStore";
import {
  MAX_TICKET_FOOTER_LENGTH,
  ticketPrintSettingsFromRow,
  ticketPrintSettingsToPayload
} from "../../src/core/settings/ticketReportSettings";
import { renderReceiptDocument } from "../../src/presentation/utils/receiptTemplateRenderer";
import {
  buildSampleTicket,
  toggleAvailabilityNotes
} from "../../src/presentation/components/settings/ticket-designer/sampleTicket";
import type { Business } from "../../src/core/store/businessStore";

const BUSINESS: Business = {
  name: "Asadero El Paisa",
  nit: "900123456-7",
  owner: "Ana",
  phone: "3001234567",
  email: "hola@elpaisa.co",
  address: "Cra 7 # 12-34, Bogotá",
  city: "Bogotá",
  country: "CO",
  logo: "https://example.com/logo.png",
  currency: "COP",
  whatsappOrders: "3001234567"
};

const base = (): PrintSettings => ({ ...DEFAULT_PRINT_SETTINGS });

function render(settings: PrintSettings, business: Business = BUSINESS) {
  const sample = buildSampleTicket(business, settings.template);
  return renderReceiptDocument(sample.receipt, sample.items, business, settings, "COP", false, sample.extras);
}

describe("catálogo de controles", () => {
  it("cubre EXACTAMENTE todos los interruptores booleanos del modelo (ninguno huérfano ni repetido)", () => {
    const booleanKeys = (Object.keys(DEFAULT_PRINT_SETTINGS) as (keyof PrintSettings)[])
      .filter((key) => typeof DEFAULT_PRINT_SETTINGS[key] === "boolean")
      .sort();
    expect([...ALL_VISIBILITY_KEYS].sort()).toEqual(booleanKeys);
    expect(new Set(ALL_VISIBILITY_KEYS).size).toBe(ALL_VISIBILITY_KEYS.length);
  });

  it("incluye los siete interruptores pedidos: QR, logo, cajero, correo, mesas, descuentos y pie de página", () => {
    for (const key of ["showQr", "showLogo", "showCashier", "showEmail", "showTable", "showDiscount", "showFooter"] as const) {
      expect(ALL_VISIBILITY_KEYS).toContain(key);
    }
    expect(VISIBILITY_GROUPS.every((group) => group.toggles.every((t) => t.label && t.hint))).toBe(true);
  });

  it("ofrece 80 mm, 58 mm y A4, y el ancho de la vista previa coincide con el del documento impreso", () => {
    expect(PAPER_OPTIONS.map((p) => p.id)).toEqual(["80mm", "58mm", "a4"]);
    for (const option of PAPER_OPTIONS) {
      const html = render({ ...base(), paperWidth: option.id });
      expect(html).toContain(`width: ${PREVIEW_PAPER_WIDTH_PX[option.id]}px;`);
    }
  });
});

describe("designerReducer", () => {
  it("cambia plantilla, papel y color sin mutar el estado anterior", () => {
    const start = base();
    const next = designerReducer(
      designerReducer(designerReducer(start, { type: "template", value: "cafeteria" }), { type: "paper", value: "58mm" }),
      { type: "accent", value: "red" }
    );
    expect(next).toMatchObject({ template: "cafeteria", paperWidth: "58mm", accentColor: "red" });
    expect(start).toEqual(DEFAULT_PRINT_SETTINGS);
  });

  it("devuelve la MISMA referencia si no cambió nada (evita renders y vista previa innecesarios)", () => {
    const start = base();
    expect(designerReducer(start, { type: "template", value: start.template })).toBe(start);
    expect(designerReducer(start, { type: "paper", value: start.paperWidth })).toBe(start);
    expect(designerReducer(start, { type: "accent", value: start.accentColor })).toBe(start);
    expect(designerReducer(start, { type: "footer", value: start.footerMessage })).toBe(start);
  });

  it("alterna cualquier interruptor y solo ese", () => {
    for (const key of ALL_VISIBILITY_KEYS) {
      const start = base();
      const once = designerReducer(start, { type: "toggle", key });
      expect(once[key]).toBe(!start[key]);
      expect(designerReducer(once, { type: "toggle", key })).toEqual(start);
      const others = ALL_VISIBILITY_KEYS.filter((k) => k !== key);
      for (const other of others) expect(once[other]).toBe(start[other]);
    }
  });

  it("apagar el pie conserva el texto del mensaje", () => {
    const off = designerReducer(base(), { type: "toggle", key: "showFooter" });
    expect(off.showFooter).toBe(false);
    expect(off.footerMessage).toBe(DEFAULT_PRINT_SETTINGS.footerMessage);
  });

  it("reset devuelve una copia (no comparte referencia con lo guardado)", () => {
    const saved = base();
    const reset = designerReducer({ ...saved, template: "clasico" }, { type: "reset", to: saved });
    expect(reset).toEqual(saved);
    expect(reset).not.toBe(saved);
  });
});

describe("cambios sin guardar y validación", () => {
  it("isDraftDirty detecta cualquier campo y vuelve a limpio al deshacer", () => {
    const saved = base();
    expect(isDraftDirty(saved, saved)).toBe(false);
    expect(isDraftDirty({ ...saved, template: "clasico" }, saved)).toBe(true);
    expect(isDraftDirty({ ...saved, showTable: !saved.showTable }, saved)).toBe(true);
    expect(isDraftDirty({ ...saved, footerMessage: "otro" }, saved)).toBe(true);
    expect(isDraftDirty({ ...saved, footerMessage: saved.footerMessage.replace(/\n/g, "\r\n") }, saved)).toBe(false);
  });

  it("validateDraft acepta los defaults y rechaza un pie de más de 240 caracteres con mensaje legible", () => {
    expect(validateDraft(base())).toEqual({ ok: true });
    const longFooter = "x".repeat(MAX_TICKET_FOOTER_LENGTH + 1);
    const result = validateDraft({ ...base(), footerMessage: longFooter });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toMatch(/^El mensaje final admite hasta 240 caracteres/);
      expect(result.message).not.toMatch(/TICKET_SETTINGS_INVALID/);
    }
    expect(validateDraft({ ...base(), footerMessage: "x".repeat(MAX_TICKET_FOOTER_LENGTH) }).ok).toBe(true);
  });

  it("footerUsage cuenta como la base (\\r\\n = 1 carácter)", () => {
    expect(footerUsage("a\r\nb")).toEqual({ used: 3, max: 240, over: false });
    expect(footerUsage("x".repeat(241)).over).toBe(true);
  });
});

describe("navegación por teclado (radiogroup)", () => {
  it("flechas con vuelta, Home y End; ignora otras teclas", () => {
    expect(nextRadioIndex(0, "ArrowRight", 3)).toBe(1);
    expect(nextRadioIndex(2, "ArrowRight", 3)).toBe(0);
    expect(nextRadioIndex(0, "ArrowLeft", 3)).toBe(2);
    expect(nextRadioIndex(1, "ArrowDown", 3)).toBe(2);
    expect(nextRadioIndex(1, "ArrowUp", 3)).toBe(0);
    expect(nextRadioIndex(2, "Home", 3)).toBe(0);
    expect(nextRadioIndex(0, "End", 3)).toBe(2);
    expect(nextRadioIndex(0, "Tab", 3)).toBeNull();
    expect(nextRadioIndex(0, "Enter", 3)).toBeNull();
    expect(nextRadioIndex(0, "ArrowRight", 0)).toBeNull();
  });
});

describe("la vista previa refleja cada control (mismo render que la impresión)", () => {
  it("la venta de ejemplo hace visible cada interruptor", () => {
    const on = render({ ...base(), template: "restaurante", showEmail: true });
    expect(on).toContain("Mesa 7");
    expect(on).toContain("Cajero:");
    expect(on).toContain("Cliente:");
    expect(on).toContain("Descuento");
    expect(on).toContain("IVA");
    expect(on).toContain("hola@elpaisa.co");
    expect(on).toContain("logo.png");
    expect(on).toContain("qrserver.com");
    expect(on).toContain("Gracias por su compra");

    const off = render({
      ...base(),
      template: "restaurante",
      showTable: false,
      showCashier: false,
      showCustomer: false,
      showDiscount: false,
      showTax: false,
      showEmail: false,
      showLogo: false,
      showQr: false,
      showFooter: false
    });
    expect(off).not.toContain("Mesa 7");
    expect(off).not.toContain("Cajero:");
    expect(off).not.toContain("Cliente:");
    expect(off).not.toContain("Descuento");
    expect(off).not.toContain(">IVA<");
    expect(off).not.toContain("hola@elpaisa.co");
    expect(off).not.toContain("logo.png");
    expect(off).not.toContain("qrserver.com");
    expect(off).not.toContain("Gracias por su compra");
    expect(off).not.toContain('class="footer"');
  });

  it("sin mesa en la venta (mostrador) no se dibuja la línea Mesa aunque el interruptor esté activo", () => {
    const sample = buildSampleTicket(BUSINESS, "restaurante");
    const html = renderReceiptDocument(sample.receipt, sample.items, BUSINESS, base(), "COP", false, {});
    expect(html).not.toContain("Mesa:");
  });

  it("el nombre de mesa se escapa (no inyecta HTML)", () => {
    const sample = buildSampleTicket(BUSINESS, "restaurante");
    const html = renderReceiptDocument(sample.receipt, sample.items, BUSINESS, base(), "COP", false, {
      tableName: "<img src=x onerror=alert(1)>"
    });
    expect(html).not.toContain("<img src=x");
    expect(html).toContain("&lt;img src=x");
  });

  it("cada plantilla genera un documento distinto y el color principal cambia el resultado donde aplica", () => {
    const docs = RECEIPT_TEMPLATES.map((t) => render({ ...base(), template: t.id }));
    expect(new Set(docs).size).toBe(RECEIPT_TEMPLATES.length);
    for (const template of ["moderno", "restaurante", "cafeteria"] as const) {
      expect(render({ ...base(), template, accentColor: "red" })).toContain("#ef4444");
      expect(render({ ...base(), template, accentColor: "green" })).not.toContain("#ef4444");
    }
    expect(render({ ...base(), template: "clasico", accentColor: "red" })).not.toContain("#ef4444");
  });

  it("la venta de ejemplo es coherente: total = subtotal - descuento + IVA + propina, y el cambio no es negativo", () => {
    for (const { id } of RECEIPT_TEMPLATES) {
      const { receipt } = buildSampleTicket(BUSINESS, id);
      expect(receipt.total).toBe(receipt.subtotal - receipt.discount + receipt.tax + receipt.tip);
      expect(receipt.discount).toBeGreaterThan(0);
      expect(receipt.change).toBeGreaterThanOrEqual(0);
      expect(receipt.received - receipt.change).toBe(receipt.total);
    }
  });
});

describe("avisos de datos faltantes", () => {
  it("avisa cuando un interruptor no tendría efecto por falta de datos del negocio", () => {
    expect(toggleAvailabilityNotes(BUSINESS)).toEqual({});
    const empty = toggleAvailabilityNotes({ ...BUSINESS, logo: "", phone: "", email: "", address: " ", whatsappOrders: "" });
    // Sin logo ya no se avisa: el ticket genera un membrete tipográfico con el nombre del negocio.
    expect(empty.showLogo).toBeUndefined();
    expect(Object.keys(empty).sort()).toEqual(["showAddress", "showEmail", "showPhone", "showQr"]);
  });

  it("el QR no se avisa si hay WhatsApp aunque falte el teléfono", () => {
    const notes = toggleAvailabilityNotes({ ...BUSINESS, phone: "", whatsappOrders: "3109998888" });
    expect(notes.showQr).toBeUndefined();
    expect(notes.showPhone).toBeDefined();
  });
});

describe("persistencia del modelo ampliado (showTable / showFooter)", () => {
  it("viajan a la base en el payload (15 campos)", () => {
    const payload = ticketPrintSettingsToPayload({ ...base(), showTable: false, showFooter: false });
    expect(payload.show_table).toBe(false);
    expect(payload.show_footer).toBe(false);
    expect(Object.keys(payload)).toHaveLength(15);
  });

  it("una fila anterior a la migración (sin show_table/show_footer) se lee con true, sin fallar", () => {
    const legacy = {
      id: "r", business_id: "b", branch_id: null, template: "moderno", paper_width: "80mm", accent_color: "cyan",
      show_logo: true, show_qr: true, show_address: true, show_phone: true, show_email: false, show_cashier: true,
      show_customer: true, show_tax: true, show_discount: true, footer_message: "Gracias",
      created_at: "2026-11-01T00:00:00Z", updated_at: "2026-11-01T00:00:00Z", updated_by: null
    };
    const settings = ticketPrintSettingsFromRow(legacy);
    expect(settings.showTable).toBe(true);
    expect(settings.showFooter).toBe(true);
  });

  it("ida y vuelta fila -> app -> payload conserva los dos interruptores apagados", () => {
    const row = {
      id: "r", business_id: "b", branch_id: null, template: "restaurante", paper_width: "58mm", accent_color: "green",
      show_logo: false, show_qr: true, show_address: true, show_phone: true, show_email: true, show_cashier: true,
      show_customer: false, show_tax: true, show_discount: true, show_table: false, show_footer: false,
      footer_message: "Gracias", created_at: "2026-11-01T00:00:00Z", updated_at: "2026-11-01T00:00:00Z", updated_by: null
    };
    const settings = ticketPrintSettingsFromRow(row);
    expect(settings).toMatchObject({ showTable: false, showFooter: false });
    expect(ticketPrintSettingsToPayload(settings)).toMatchObject({ show_table: false, show_footer: false });
  });
});