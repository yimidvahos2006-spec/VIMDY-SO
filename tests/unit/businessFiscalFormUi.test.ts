// @vitest-environment jsdom
import { createElement as h } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const toastMock = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() }));
vi.mock("../../src/core/store/toastStore", () => ({ toast: toastMock }));

import { BusinessFiscalForm } from "../../src/presentation/components/settings/BusinessFiscalForm";
import {
  EMPTY_BUSINESS_FISCAL_IDENTITY,
  type BusinessFiscalIdentity
} from "../../src/core/invoicing/types/fiscal.types";

const SAVED: BusinessFiscalIdentity = {
  nit: "800197268",
  verificationDigit: "4",
  legalName: "Restaurante Demo SAS",
  organizationType: "PERSONA_JURIDICA",
  address: "Calle 10 # 5-20",
  city: "Medellín",
  department: "Antioquia",
  phone: "",
  email: "facturas@demo.co",
  invoicePrefix: "SETP"
};

function mount(
  props: {
    active?: boolean;
    load?: () => Promise<BusinessFiscalIdentity>;
    save?: (id: string, i: BusinessFiscalIdentity) => Promise<BusinessFiscalIdentity>;
    prefill?: Record<string, string>;
    businessId?: string | null;
  } = {}
) {
  const load = vi.fn(props.load ?? (async () => SAVED));
  const save = vi.fn(props.save ?? (async (_id: string, i: BusinessFiscalIdentity) => i));
  render(
    h(BusinessFiscalForm, {
      businessId: props.businessId === undefined ? "b1" : props.businessId,
      active: props.active ?? true,
      prefill: props.prefill,
      load,
      save
    })
  );
  return { load, save };
}

const field = (label: RegExp) => screen.getByLabelText(label) as HTMLInputElement;

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("BusinessFiscalForm", () => {
  it("no carga nada mientras la pestaña no esté activa", () => {
    const { load } = mount({ active: false });
    expect(load).not.toHaveBeenCalled();
    expect(screen.getByRole("status").textContent).toMatch(/cargando/i);
  });

  it("al activarse carga y muestra lo guardado en la BD", async () => {
    const { load } = mount();
    await waitFor(() => expect(field(/^NIT/).value).toBe("800197268"));
    expect(load).toHaveBeenCalledWith("b1");
    expect(field(/Razón social/).value).toBe("Restaurante Demo SAS");
    expect(field(/Prefijo/).value).toBe("SETP");
    // sin cambios: no hay nada que guardar
    expect((screen.getByRole("button", { name: /guardar datos fiscales/i }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("sugiere con datos del perfil solo los campos vacíos y lo marca como sin guardar", async () => {
    mount({
      load: async () => ({ ...EMPTY_BUSINESS_FISCAL_IDENTITY, city: "Cali" }),
      prefill: { nit: "900.123.456-7", city: "Bogotá", address: "Cra 7 # 12-34", email: "a@b.co", phone: "3001112233" }
    });
    await waitFor(() => expect(field(/^NIT/).value).toBe("900123456"));
    expect(field(/Dígito/).value).toBe("7");
    expect(field(/Ciudad/).value).toBe("Cali"); // lo guardado manda sobre la sugerencia
    expect(field(/Dirección/).value).toBe("Cra 7 # 12-34");
    expect(screen.getByText(/cambios sin guardar/i)).toBeTruthy();
  });

  it("si la carga falla muestra el error y permite reintentar", async () => {
    let n = 0;
    const { load } = mount({
      load: async () => {
        n++;
        if (n === 1) throw new Error("sin conexión");
        return SAVED;
      }
    });
    await waitFor(() => expect(screen.getByRole("alert").textContent).toMatch(/./));
    fireEvent.click(screen.getByRole("button", { name: /reintentar/i }));
    await waitFor(() => expect(field(/^NIT/).value).toBe("800197268"));
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("al salir del NIT calcula el dígito de verificación si está vacío", async () => {
    mount({ load: async () => EMPTY_BUSINESS_FISCAL_IDENTITY });
    await waitFor(() => field(/^NIT/));
    fireEvent.change(field(/^NIT/), { target: { value: "800.197.268" } });
    fireEvent.blur(field(/^NIT/));
    expect(field(/^NIT/).value).toBe("800197268");
    expect(field(/Dígito/).value).toBe("4");
  });

  it("no guarda si faltan datos: marca los campos y no llama al servidor", async () => {
    const { save } = mount({ load: async () => EMPTY_BUSINESS_FISCAL_IDENTITY });
    await waitFor(() => field(/^NIT/));
    fireEvent.change(field(/Razón social/), { target: { value: "Mi negocio SAS" } }); // vuelve "dirty"
    fireEvent.click(screen.getByRole("button", { name: /guardar datos fiscales/i }));
    expect(save).not.toHaveBeenCalled();
    expect(toastMock.error).toHaveBeenCalled();
    expect(field(/^NIT/).getAttribute("aria-invalid")).toBe("true");
    expect(screen.getAllByText(/NIT o cédula con 5 a 10 dígitos/i).length).toBe(1);
  });

  it("DV equivocado dice cuál debería ser", async () => {
    mount();
    await waitFor(() => field(/^NIT/));
    fireEvent.change(field(/Dígito/), { target: { value: "9" } });
    fireEvent.click(screen.getByRole("button", { name: /guardar datos fiscales/i }));
    expect(screen.getByText(/debería ser 4/i)).toBeTruthy();
  });

  it("guarda lo normalizado, avisa y vuelve a quedar sin cambios", async () => {
    const { save } = mount();
    await waitFor(() => field(/^NIT/));
    fireEvent.change(field(/Correo/), { target: { value: " FACTURAS@Demo.co " } });
    fireEvent.change(field(/Prefijo/), { target: { value: "fv" } });
    fireEvent.click(screen.getByRole("button", { name: /guardar datos fiscales/i }));
    await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
    expect(save.mock.calls[0][0]).toBe("b1");
    expect(save.mock.calls[0][1]).toMatchObject({ email: "facturas@demo.co", invoicePrefix: "FV" });
    await waitFor(() => expect(toastMock.success).toHaveBeenCalledWith("Datos fiscales guardados."));
    await waitFor(() =>
      expect((screen.getByRole("button", { name: /guardar datos fiscales/i }) as HTMLButtonElement).disabled).toBe(true)
    );
  });

  it("si el servidor rechaza (no es admin / plan vencido) avisa y conserva lo escrito", async () => {
    const { save } = mount({
      save: async () => {
        throw new Error("No se guardó. Solo el administrador puede cambiar los datos fiscales y el plan debe estar activo.");
      }
    });
    await waitFor(() => field(/^NIT/));
    fireEvent.change(field(/Razón social/), { target: { value: "Otro nombre SAS" } });
    fireEvent.click(screen.getByRole("button", { name: /guardar datos fiscales/i }));
    await waitFor(() => expect(save).toHaveBeenCalled());
    await waitFor(() => expect(toastMock.error).toHaveBeenCalled());
    expect(toastMock.success).not.toHaveBeenCalled();
    expect(field(/Razón social/).value).toBe("Otro nombre SAS");
  });

  it("sin negocio activo no intenta cargar", () => {
    const { load } = mount({ businessId: null });
    expect(load).not.toHaveBeenCalled();
    expect(screen.getByText(/inicia sesión/i)).toBeTruthy();
  });
});