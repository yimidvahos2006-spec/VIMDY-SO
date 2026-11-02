import { describe, it, expect, vi, beforeEach } from "vitest";

type InvokeResult = { data: unknown; error: unknown };
const state: { result: InvokeResult } = { result: { data: null, error: null } };
const invokeCalls: Array<{ fn: string; options: { body: Record<string, unknown> } }> = [];

vi.mock("../../src/infrastructure/supabase/supabaseClient", () => ({
  supabase: {
    functions: {
      invoke: async (fn: string, options: { body: Record<string, unknown> }) => {
        invokeCalls.push({ fn, options });
        return state.result;
      }
    }
  }
}));

import { sendReportCloseTestEmail } from "../../src/infrastructure/supabase/reportCloseTestEmailService";

const BIZ = "11111111-1111-4111-8111-111111111111";
const BR = "22222222-2222-4222-8222-222222222222";

function httpError(status: number, body: unknown) {
  return {
    name: "FunctionsHttpError",
    message: "Edge Function returned a non-2xx status code",
    context: new Response(typeof body === "string" ? body : JSON.stringify(body), { status })
  };
}

beforeEach(() => {
  state.result = { data: null, error: null };
  invokeCalls.length = 0;
});

describe("sendReportCloseTestEmail", () => {
  it("invoca TEST_EMAIL con el correo normalizado y devuelve el resultado", async () => {
    state.result = {
      data: { ok: true, recipient: "dueno@negocio.co", recipients: ["dueno@negocio.co"], providerId: "re_1", origin: "manual", message: "Enviado." },
      error: null
    };
    const r = await sendReportCloseTestEmail({ businessId: BIZ, recipient: " Dueno@Negocio.co " });
    expect(r).toEqual({ recipient: "dueno@negocio.co", recipients: ["dueno@negocio.co"], providerId: "re_1", origin: "manual", message: "Enviado." });
    expect(invokeCalls[0]).toEqual({
      fn: "process-daily-report",
      options: { body: { businessId: BIZ, action: "TEST_EMAIL", recipient: "dueno@negocio.co" } }
    });
  });

  it("sin correo manda solo negocio y sucursal (prueba el respaldo)", async () => {
    state.result = { data: { ok: true, recipient: "admin@n.co", recipients: ["admin@n.co"], origin: "fallback" }, error: null };
    const r = await sendReportCloseTestEmail({ businessId: BIZ, branchId: BR });
    expect(invokeCalls[0].options.body).toEqual({ businessId: BIZ, action: "TEST_EMAIL", branchId: BR });
    expect(r.origin).toBe("fallback");
  });

  it("valida en el cliente: negocio vacío, varios correos y correo inválido no llaman al servidor", async () => {
    await expect(sendReportCloseTestEmail({ businessId: "  " })).rejects.toThrow(/negocio/);
    await expect(sendReportCloseTestEmail({ businessId: BIZ, recipient: "a@b.co, c@d.co" })).rejects.toThrow(/un solo correo/);
    await expect(sendReportCloseTestEmail({ businessId: BIZ, recipient: "malo" })).rejects.toThrow(/"malo" no es válido/);
    expect(invokeCalls).toHaveLength(0);
  });

  it("un error HTTP muestra el mensaje en español del servidor, no el genérico en inglés", async () => {
    state.result = {
      data: null,
      error: httpError(503, { ok: false, code: "EMAIL_NOT_CONFIGURED", message: "El dominio de VIMDY aún no está verificado. Avísale a soporte de VIMDY." })
    };
    await expect(sendReportCloseTestEmail({ businessId: BIZ, recipient: "a@b.co" })).rejects.toThrow(/aún no está verificado/);
  });

  it("error HTTP con cuerpo ilegible: mensaje genérico en español", async () => {
    state.result = { data: null, error: httpError(500, "<html>boom</html>") };
    await expect(sendReportCloseTestEmail({ businessId: BIZ, recipient: "a@b.co" })).rejects.toThrow(/No se pudo enviar el correo de prueba/);
  });

  it("sin conexión y relay caído: mensajes distintos y claros", async () => {
    state.result = { data: null, error: { name: "FunctionsFetchError", message: "Failed to send a request to the Edge Function" } };
    await expect(sendReportCloseTestEmail({ businessId: BIZ, recipient: "a@b.co" })).rejects.toThrow(/Revisa tu conexión/);
    state.result = { data: null, error: { name: "FunctionsRelayError", message: "relay" } };
    await expect(sendReportCloseTestEmail({ businessId: BIZ, recipient: "a@b.co" })).rejects.toThrow(/no está disponible/);
  });

  it("respuesta 200 con ok=false (servidor antiguo) o vacía: lanza con el mensaje", async () => {
    state.result = { data: { ok: false, message: "Mensaje del servidor." }, error: null };
    await expect(sendReportCloseTestEmail({ businessId: BIZ, recipient: "a@b.co" })).rejects.toThrow("Mensaje del servidor.");
    state.result = { data: null, error: null };
    await expect(sendReportCloseTestEmail({ businessId: BIZ, recipient: "a@b.co" })).rejects.toThrow(/No se pudo enviar/);
  });
});