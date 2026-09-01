import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../src/infrastructure/supabase/supabaseClient", () => ({
  supabase: {
    functions: {
      invoke: vi.fn()
    }
  }
}));

import { supabase } from "../../src/infrastructure/supabase/supabaseClient";
import { savePaymentCredentials, getPaymentCredentials, testPaymentCredentials } from "../../src/core/services/paymentCredentialsService";

describe("paymentCredentialsService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (supabase.functions.invoke as any).mockReset();
  });

  describe("savePaymentCredentials", () => {
    it("guarda credenciales cifradas via Edge Function", async () => {
      (supabase.functions.invoke as any).mockResolvedValue({ data: { ok: true, id: "uuid-123" }, error: null });

      await savePaymentCredentials("business-1", {
        provider: "wompi",
        publicKey: "pub_test_123",
        privateKey: "priv_test_456",
        integritySecret: "int_test_789",
        eventsSecret: "evt_test_000"
      });

      expect(supabase.functions.invoke).toHaveBeenCalledWith("payment-credentials/save", expect.objectContaining({
        body: expect.objectContaining({
          businessId: "business-1",
          provider: "wompi"
        }),
        method: "POST"
      }));
    });

    it("lanza error si la Edge Function falla", async () => {
      (supabase.functions.invoke as any).mockResolvedValue({ data: null, error: { message: "Edge Function error" } });

      await expect(
        savePaymentCredentials("business-1", {
          provider: "wompi",
          publicKey: "pub_test_123",
          privateKey: "priv_test_456",
          integritySecret: "int_test_789",
          eventsSecret: "evt_test_000"
        })
      ).rejects.toThrow("Error en payment-credentials/save: Edge Function error");
    });
  });

  describe("getPaymentCredentials", () => {
    it("obtiene credenciales descifradas", async () => {
      (supabase.functions.invoke as any).mockResolvedValue({
        data: {
          ok: true,
          credentials: {
            provider: "wompi",
            publicKey: "pub_test_123",
            privateKey: "priv_test_456",
            integritySecret: "int_test_789",
            eventsSecret: "evt_test_000"
          }
        },
        error: null
      });

      const result = await getPaymentCredentials("business-1", "wompi");

      expect(result).toEqual({
        provider: "wompi",
        publicKey: "pub_test_123",
        privateKey: "priv_test_456",
        integritySecret: "int_test_789",
        eventsSecret: "evt_test_000"
      });
    });

    it("devuelve null si no hay credenciales", async () => {
      (supabase.functions.invoke as any).mockResolvedValue({ data: { ok: false }, error: null });

      const result = await getPaymentCredentials("business-1", "wompi");
      expect(result).toBeNull();
    });

    it("devuelve null si la Edge Function falla", async () => {
      (supabase.functions.invoke as any).mockResolvedValue({ data: null, error: { message: "not found" } });

      const result = await getPaymentCredentials("business-1", "wompi");
      expect(result).toBeNull();
    });
  });

  describe("testPaymentCredentials", () => {
    it("devuelve success true si las credenciales son válidas", async () => {
      (supabase.functions.invoke as any).mockResolvedValue({
        data: { success: true, error_message: null },
        error: null
      });

      const result = await testPaymentCredentials("business-1", "wompi");
      expect(result.success).toBe(true);
      expect(result.errorMessage).toBeNull();
    });

    it("devuelve success false si no hay credenciales", async () => {
      (supabase.functions.invoke as any).mockResolvedValue({
        data: { success: false, error_message: "No hay credenciales guardadas." },
        error: null
      });

      const result = await testPaymentCredentials("business-1", "wompi");
      expect(result.success).toBe(false);
      expect(result.errorMessage).toBe("No hay credenciales guardadas.");
    });

    it("devuelve error si la Edge Function falla", async () => {
      (supabase.functions.invoke as any).mockResolvedValue({ data: null, error: { message: "Edge Function error" } });

      const result = await testPaymentCredentials("business-1", "wompi");
      expect(result.success).toBe(false);
      expect(result.errorMessage).toMatch(/Edge Function error/);
    });
  });
});
