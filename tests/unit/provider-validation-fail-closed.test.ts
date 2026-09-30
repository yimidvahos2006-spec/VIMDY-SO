import { describe, expect, it } from "vitest";

import { FactusProvider } from "../../src/core/invoicing/providers/factus/FactusProvider";
import { DianProvider } from "../../src/core/invoicing/providers/dian/DianProvider";
import { MercadoPagoProvider } from "../../src/core/payments/providers/mercadopago/MercadoPagoProvider";

/**
 * TESTS DE FAIL-CLOSED — Bloque Hardening #8-10
 *
 * FactusProvider, DianProvider y MercadoPagoProvider corren en el navegador.
 * Ningún secreto real ni credencial de servidor está disponible allí, así que
 * validateResponse() NO puede verificar criptográficamente la autenticidad de
 * una respuesta/webhook — debe devolver siempre false (fail-closed).
 *
 * Un método que se llama "validateResponse" y acepta cualquier cosa es
 * inseguro: permite a un atacante enviar un payload fabricado
 * { status: "accepted" } y obtener true.
 */
describe("FactusProvider.validateResponse — fail-closed", () => {
  it("siempre devuelve false (no hay credenciales en el cliente)", () => {
    const provider = new FactusProvider();
    expect(provider.validateResponse({ status: "accepted" })).toBe(false);
  });

  it("devuelve false incluso si se pasa un payload con status 'accepted'", () => {
    const provider = new FactusProvider();
    expect(provider.validateResponse({ status: "accepted", number: "123" }, "signature")).toBe(false);
  });
});

describe("DianProvider.validateResponse — fail-closed", () => {
  it("siempre devuelve false (no hay credenciales en el cliente)", () => {
    const provider = new DianProvider();
    expect(provider.validateResponse({ status: "accepted" })).toBe(false);
  });

  it("NO valida sólo por el campo status — un atacante no puede engañar con { status: 'accepted' }", () => {
    const provider = new DianProvider();
    const fakePayload = { status: "accepted", provider: "dian" };
    expect(provider.validateResponse(fakePayload)).toBe(false);
  });

  it("devuelve false con payload null/undefined", () => {
    const provider = new DianProvider();
    expect(provider.validateResponse(null)).toBe(false);
    expect(provider.validateResponse(undefined)).toBe(false);
  });
});

describe("MercadoPagoProvider.validateResponse — fail-closed", () => {
  it("siempre devuelve false (no expone webhook secret en el cliente)", () => {
    const provider = new MercadoPagoProvider();
    expect(provider.validateResponse({ id: "123" }, "ts=123,v1=abc")).toBe(false);
  });

  it("NO usa MERCADOPAGO_WEBHOOK_SECRET del entorno del navegador", () => {
    const provider = new MercadoPagoProvider();
    const result = provider.validateResponse("payload", "ts=123,v1=fake");
    expect(result).toBe(false);
  });
});
