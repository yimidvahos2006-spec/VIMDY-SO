// @vitest-environment jsdom
import { createElement as h } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";

import { TicketDesigner } from "../../src/presentation/components/settings/ticket-designer/TicketDesigner";
import { TicketPreviewModal } from "../../src/presentation/components/settings/ticket-designer/TicketPreviewModal";
import { DEFAULT_PRINT_SETTINGS, type PrintSettings } from "../../src/core/store/printSettingsStore";
import type { Business } from "../../src/core/store/businessStore";

const BUSINESS: Business = {
  name: "Asadero El Paisa",
  nit: "900123456-7",
  owner: "Ana",
  phone: "3001234567",
  email: "hola@elpaisa.co",
  address: "Cra 7 # 12-34",
  city: "Bogotá",
  country: "CO",
  logo: "https://example.com/logo.png",
  currency: "COP",
  whatsappOrders: "3001234567"
};

const initial = (): PrintSettings => ({ ...DEFAULT_PRINT_SETTINGS });

function mount(props: { onSave?: (s: PrintSettings) => void | Promise<void>; readOnly?: boolean; business?: Business; initialSettings?: PrintSettings } = {}) {
  const onSave = props.onSave ?? vi.fn();
  const view = render(
    h(TicketDesigner, {
      business: props.business ?? BUSINESS,
      initialSettings: props.initialSettings ?? initial(),
      onSave,
      readOnly: props.readOnly
    })
  );
  return { ...view, onSave };
}

/** El srcdoc del iframe de vista previa EN VIVO (el del aside de escritorio). */
function previewHtml(): string {
  const frames = screen.getAllByTitle("Vista previa del ticket") as HTMLIFrameElement[];
  return frames[0].getAttribute("srcdoc") ?? "";
}
function previewFrame(): HTMLIFrameElement {
  return (screen.getAllByTitle("Vista previa del ticket") as HTMLIFrameElement[])[0];
}

afterEach(() => cleanup());

describe("editor: controles", () => {
  it("muestra las 5 plantillas como radiogroup y marca la activa", () => {
    mount();
    const group = screen.getByRole("radiogroup", { name: "Plantilla" });
    const radios = within(group).getAllByRole("radio");
    expect(radios.map((r) => r.textContent?.match(/Clásico|Moderno|Restaurante|Supermercado|Cafetería/)?.[0])).toEqual([
      "Clásico", "Moderno", "Restaurante", "Supermercado", "Cafetería"
    ]);
    expect(within(group).getByRole("radio", { name: /Moderno/ }).getAttribute("aria-checked")).toBe("true");
    expect(within(group).getByRole("radio", { name: /Clásico/ }).getAttribute("aria-checked")).toBe("false");
  });

  it("la vista previa reacciona al instante al cambiar de plantilla", () => {
    mount();
    const before = previewHtml();
    fireEvent.click(screen.getByRole("radio", { name: /Restaurante/ }));
    const after = previewHtml();
    expect(after).not.toBe(before);
    expect(after).toContain("text-transform: uppercase");
    expect(screen.getByRole("radio", { name: /Restaurante/ }).getAttribute("aria-checked")).toBe("true");
  });

  it("58 mm / 80 mm cambian el ancho del marco y del documento", () => {
    mount();
    expect(previewFrame().style.width).toBe("300px");
    fireEvent.click(screen.getByRole("radio", { name: /58 mm/ }));
    expect(previewFrame().style.width).toBe("220px");
    expect(previewHtml()).toContain("width: 220px;");
    fireEvent.click(screen.getByRole("radio", { name: /80 mm/ }));
    expect(previewFrame().style.width).toBe("300px");
  });

  it("el color principal se aplica en la vista previa y es un radiogroup con nombres accesibles", () => {
    mount();
    fireEvent.click(screen.getByRole("radio", { name: "Rojo" }));
    expect(previewHtml()).toContain("#ef4444");
    expect(screen.getByRole("radio", { name: "Rojo" }).getAttribute("aria-checked")).toBe("true");
    expect(screen.getByRole("radio", { name: "Azul" }).getAttribute("aria-checked")).toBe("false");
  });

  it("flechas del teclado mueven y seleccionan dentro del ancho de papel (roving tabindex)", () => {
    mount();
    const eighty = screen.getByRole("radio", { name: /80 mm/ });
    expect(eighty.getAttribute("tabindex")).toBe("0");
    expect(screen.getByRole("radio", { name: /58 mm/ }).getAttribute("tabindex")).toBe("-1");
    fireEvent.keyDown(eighty, { key: "ArrowRight" });
    expect(screen.getByRole("radio", { name: /58 mm/ }).getAttribute("aria-checked")).toBe("true");
    expect(document.activeElement).toBe(screen.getByRole("radio", { name: /58 mm/ }));
    fireEvent.keyDown(document.activeElement as HTMLElement, { key: "End" });
    expect(screen.getByRole("radio", { name: /A4/ }).getAttribute("aria-checked")).toBe("true");
    fireEvent.keyDown(document.activeElement as HTMLElement, { key: "ArrowRight" });
    expect(screen.getByRole("radio", { name: /80 mm/ }).getAttribute("aria-checked")).toBe("true");
  });

  it("los 11 interruptores son role=switch y apagar uno lo quita de la vista previa", () => {
    mount();
    const switches = screen.getAllByRole("switch");
    expect(switches).toHaveLength(11);
    for (const name of ["Logo", "Código QR", "Cajero", "Correo", "Mesa", "Descuentos", "Pie de página"]) {
      expect(screen.getByRole("switch", { name })).toBeTruthy();
    }

    const cashier = screen.getByRole("switch", { name: "Cajero" });
    expect(cashier.getAttribute("aria-checked")).toBe("true");
    expect(previewHtml()).toContain("Cajero:");
    fireEvent.click(cashier);
    expect(cashier.getAttribute("aria-checked")).toBe("false");
    expect(previewHtml()).not.toContain("Cajero:");

    fireEvent.click(screen.getByRole("switch", { name: "Pie de página" }));
    expect(previewHtml()).not.toContain("Gracias por su compra");
    fireEvent.click(screen.getByRole("switch", { name: "Mesa" }));
    expect(previewHtml()).not.toContain("Mesa 7");
    fireEvent.click(screen.getByRole("switch", { name: "Correo" }));
    expect(previewHtml()).toContain("hola@elpaisa.co");
  });

  it("escribir el pie de página actualiza la vista previa en el mismo instante", () => {
    mount();
    fireEvent.change(screen.getByLabelText("Mensaje al final del ticket"), { target: { value: "Vuelva pronto <b>" } });
    expect(previewHtml()).toContain("Vuelva pronto &lt;b&gt;");
  });

  it("avisa cuando un interruptor activo no tiene datos del negocio", () => {
    mount({ business: { ...BUSINESS, logo: "" } });
    expect(screen.getByText(/aún no tiene logo/i)).toBeTruthy();
    fireEvent.click(screen.getByRole("switch", { name: "Logo" }));
    expect(screen.queryByText(/aún no tiene logo/i)).toBeNull();
  });
});

describe("editor: guardado", () => {
  it("el botón Guardar está deshabilitado sin cambios y guarda el borrador completo", async () => {
    const onSave = vi.fn();
    mount({ onSave });
    const save = screen.getByRole("button", { name: "Guardar plantilla de impresión" }) as HTMLButtonElement;
    expect(save.disabled).toBe(true);

    fireEvent.click(screen.getByRole("radio", { name: /Cafetería/ }));
    fireEvent.click(screen.getByRole("switch", { name: "Mesa" }));
    expect(save.disabled).toBe(false);
    expect(screen.getByText("Tienes cambios sin guardar.")).toBeTruthy();

    await act(async () => {
      fireEvent.click(save);
    });
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onSave.mock.calls[0][0]).toMatchObject({ template: "cafeteria", showTable: false, paperWidth: "80mm" });
    expect(screen.getByText("Guardado")).toBeTruthy();
    expect((screen.getByRole("button", { name: "Guardar plantilla de impresión" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("si guardar falla muestra el error y conserva el borrador para reintentar", async () => {
    const onSave = vi.fn().mockRejectedValue(new Error("SETTINGS_FORBIDDEN: no se guardó."));
    mount({ onSave });
    fireEvent.click(screen.getByRole("radio", { name: /Clásico/ }));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Guardar plantilla de impresión" }));
    });
    expect(screen.getByRole("alert").textContent).toContain("SETTINGS_FORBIDDEN");
    expect(screen.getByRole("radio", { name: /Clásico/ }).getAttribute("aria-checked")).toBe("true");
    expect((screen.getByRole("button", { name: "Guardar plantilla de impresión" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("un pie de más de 240 caracteres bloquea el guardado y lo explica", () => {
    mount();
    const area = screen.getByLabelText("Mensaje al final del ticket");
    fireEvent.change(area, { target: { value: "x".repeat(241) } });
    expect(area.getAttribute("aria-invalid")).toBe("true");
    expect(screen.getByRole("alert").textContent).toMatch(/240 caracteres/);
    expect(screen.getByText("241/240")).toBeTruthy();
    expect((screen.getByRole("button", { name: "Guardar plantilla de impresión" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(area, { target: { value: "x".repeat(240) } });
    expect(area.getAttribute("aria-invalid")).toBe("false");
    expect((screen.getByRole("button", { name: "Guardar plantilla de impresión" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("Descartar cambios vuelve a lo guardado", () => {
    mount();
    fireEvent.click(screen.getByRole("radio", { name: /Supermercado/ }));
    fireEvent.click(screen.getByRole("button", { name: /Descartar cambios/ }));
    expect(screen.getByRole("radio", { name: /Moderno/ }).getAttribute("aria-checked")).toBe("true");
    expect(screen.queryByRole("button", { name: /Descartar cambios/ })).toBeNull();
  });

  it("modo solo lectura: nada es editable ni se puede guardar", () => {
    mount({ readOnly: true });
    expect((screen.getByRole("radio", { name: /Clásico/ }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("switch", { name: "Logo" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByLabelText("Mensaje al final del ticket") as HTMLTextAreaElement).disabled).toBe(true);
    expect(screen.queryByRole("button", { name: "Guardar plantilla de impresión" })).toBeNull();
  });

  it("si el padre entrega otra configuración guardada, el borrador parte de ella", () => {
    const { rerender, onSave } = mount();
    fireEvent.click(screen.getByRole("radio", { name: /Clásico/ }));
    rerender(h(TicketDesigner, { business: BUSINESS, initialSettings: { ...initial(), template: "cafeteria" }, onSave }));
    expect(screen.getByRole("radio", { name: /Cafetería/ }).getAttribute("aria-checked")).toBe("true");
  });

  it("re-render del padre con la MISMA configuración no pisa lo que el usuario está editando", () => {
    const { rerender, onSave } = mount();
    fireEvent.click(screen.getByRole("radio", { name: /Clásico/ }));
    rerender(h(TicketDesigner, { business: BUSINESS, initialSettings: initial(), onSave }));
    expect(screen.getByRole("radio", { name: /Clásico/ }).getAttribute("aria-checked")).toBe("true");
  });
});

describe("modal de vista previa ampliada (accesibilidad)", () => {
  it("abre con role=dialog, aria-modal y nombre accesible = su título", () => {
    mount();
    expect(screen.queryByRole("dialog")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Vista previa ampliada/ }));
    const dialog = screen.getByRole("dialog", { name: "Vista previa del ticket" });
    expect(dialog.getAttribute("aria-modal")).toBe("true");
    const labelledBy = dialog.getAttribute("aria-labelledby");
    expect(labelledBy && document.getElementById(labelledBy)?.textContent).toBe("Vista previa del ticket");
  });

  it("Escape lo cierra y devuelve el foco al botón que lo abrió", () => {
    mount();
    const opener = screen.getByRole("button", { name: /Vista previa ampliada/ });
    opener.focus();
    fireEvent.click(opener);
    const close = screen.getByRole("button", { name: "Cerrar vista previa" });
    expect(document.activeElement).toBe(close);

    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(opener);
  });

  it("el botón cerrar y el clic en el fondo también lo cierran; otras teclas no", () => {
    mount();
    fireEvent.click(screen.getByRole("button", { name: /Vista previa ampliada/ }));
    fireEvent.keyDown(document, { key: "Enter" });
    expect(screen.getByRole("dialog")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Cerrar vista previa" }));
    expect(screen.queryByRole("dialog")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /Vista previa ampliada/ }));
    const backdrop = screen.getByRole("dialog").parentElement as HTMLElement;
    fireEvent.mouseDown(backdrop);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("atrapa el foco con Tab / Shift+Tab y bloquea el scroll del fondo mientras está abierto", () => {
    const onClose = vi.fn();
    const { rerender } = render(
      h(TicketPreviewModal, { open: true, onClose }, h("button", { type: "button" }, "Acción interna"))
    );
    expect(document.body.style.overflow).toBe("hidden");
    const close = screen.getByRole("button", { name: "Cerrar vista previa" });
    const inner = screen.getByRole("button", { name: "Acción interna" });
    const dialog = screen.getByRole("dialog");

    inner.focus();
    fireEvent.keyDown(dialog, { key: "Tab" });
    expect(document.activeElement).toBe(close);
    fireEvent.keyDown(dialog, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(inner);

    rerender(h(TicketPreviewModal, { open: false, onClose }, null));
    expect(document.body.style.overflow).toBe("");
  });

  it("cerrado no deja listeners de Escape colgados", () => {
    const onClose = vi.fn();
    const { rerender } = render(h(TicketPreviewModal, { open: true, onClose }, null));
    rerender(h(TicketPreviewModal, { open: false, onClose }, null));
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).not.toHaveBeenCalled();
  });
});