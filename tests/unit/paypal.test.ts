import { beforeEach, describe, expect, it, vi } from "vitest";

const invokeMock = vi.fn();

vi.mock("../../src/infrastructure/supabase/supabaseClient", () => ({
  supabase: {
    functions: {
      invoke: (...args: unknown[]) => invokeMock(...args)
    }
  }
}));

import { PayPalProvider } from "../../src/core/payments/providers/paypal/PayPalProvider";
import type { PaymentRequest } from "../../src/core/payments/models/PaymentModels";

describe("PayPalProvider", () => {
  beforeEach(() => {
    invokeMock.mockReset();
  });

  describe("createPayment", () => {
    it("crea la orden real vía paypal-checkout y devuelve la checkoutUrl", async () => {
      invokeMock.mockResolvedValue({
        data: { ok: true, checkoutUrl: "https://paypal.com/checkoutnow?token=ORDER-1", reference: "ORDER-1" },
        error: null
      });

      const provider = new PayPalProvider();
      const request: PaymentRequest = {
        id: "pay-1",
        provider: "paypal",
        businessId: "biz-1",
        country: "US",
        currency: "USD",
        amount: 89,
        businessType: "restaurant",
        plan: "monthly"
      };

      const result = await provider.createPayment(request);

      expect(invokeMock).toHaveBeenCalledWith("paypal-checkout", {
        body: { businessId: "biz-1", plan: "monthly" }
      });
      expect(result.checkoutUrl).toBe("https://paypal.com/checkoutnow?token=ORDER-1");
      expect(result.status).toBe("pending");
    });

    it("rechaza un plan que PayPal no factura", async () => {
      const provider = new PayPalProvider();
      const request: PaymentRequest = {
        id: "pay-2",
        provider: "paypal",
        businessId: "biz-1",
        country: "US",
        currency: "USD",
        amount: 89,
        businessType: "restaurant",
        plan: "trial" as PaymentRequest["plan"]
      };

      await expect(provider.createPayment(request)).rejects.toThrow(/plan no facturable/);
      expect(invokeMock).not.toHaveBeenCalled();
    });
  });

  describe("getPayment", () => {
    it("consulta la orden real vía paypal-get-order y normaliza el resultado", async () => {
      invokeMock.mockResolvedValue({
        data: {
          ok: true,
          order: {
            id: "ORDER-1",
            status: "COMPLETED",
            create_time: "2026-08-01T00:00:00Z",
            purchase_units: [
              {
                amount: { currency_code: "USD", value: "89.00" },
                payments: { captures: [{ id: "CAPTURE-1", amount: { currency_code: "USD", value: "89.00" } }] }
              }
            ]
          }
        },
        error: null
      });

      const provider = new PayPalProvider();
      const result = await provider.getPayment("ORDER-1");

      expect(invokeMock).toHaveBeenCalledWith("paypal-get-order", { body: { orderId: "ORDER-1" } });
      expect(result.status).toBe("approved");
      expect(result.amount).toBe(89);
      expect(result.currency).toBe("USD");
    });
  });

  describe("cancelPayment", () => {
    it("no finge cancelar en PayPal: lanza un error explicando que no existe esa API", async () => {
      const provider = new PayPalProvider();

      await expect(provider.cancelPayment("ORDER-1")).rejects.toThrow(/no ofrece una API para cancelar/);
      expect(invokeMock).not.toHaveBeenCalled();
    });
  });

  describe("refundPayment", () => {
    it("reembolsa vía paypal-refund-transaction y marca el resultado como refunded", async () => {
      invokeMock.mockResolvedValue({
        data: { ok: true, refund: { id: "REFUND-1", status: "COMPLETED", amount: { currency_code: "USD", value: "89.00" } } },
        error: null
      });

      const provider = new PayPalProvider();
      const result = await provider.refundPayment({ paymentId: "ORDER-1", amount: 89, reason: "Cliente canceló" });

      expect(invokeMock).toHaveBeenCalledWith("paypal-refund-transaction", {
        body: { paymentId: "ORDER-1", amount: 89, reason: "Cliente canceló" }
      });
      expect(result.status).toBe("refunded");
      expect(result.amount).toBe(89);
    });

    it("propaga el error si la Edge Function rechaza el reembolso", async () => {
      invokeMock.mockResolvedValue({
        data: null,
        error: { message: "PAYMENT_NOT_REFUNDABLE" }
      });

      const provider = new PayPalProvider();

      await expect(provider.refundPayment({ paymentId: "ORDER-1" })).rejects.toThrow("PAYMENT_NOT_REFUNDABLE");
    });
  });

  describe("getStatus", () => {
    it("mapea los estados de PayPal a los estados normalizados de VIMDY", () => {
      const provider = new PayPalProvider();

      expect(provider.getStatus("COMPLETED")).toBe("approved");
      expect(provider.getStatus("APPROVED")).toBe("approved");
      expect(provider.getStatus("VOIDED")).toBe("cancelled");
      expect(provider.getStatus("DECLINED")).toBe("declined");
      expect(provider.getStatus("algo-desconocido")).toBe("error");
    });
  });

  describe("validateResponse", () => {
    it("siempre falla cerrado en el navegador (la validación real ocurre en paypal-webhook)", () => {
      const provider = new PayPalProvider();
      expect(provider.validateResponse({}, "cualquier-firma")).toBe(false);
    });
  });

  describe("getCurrency", () => {
    it("devuelve la moneda correcta por país", () => {
      const provider = new PayPalProvider();

      expect(provider.getCurrency("AR")).toBe("ARS");
      expect(provider.getCurrency("CL")).toBe("CLP");
      expect(provider.getCurrency("CO")).toBe("COP");
      expect(provider.getCurrency("EC")).toBe("USD");
      expect(provider.getCurrency("ES")).toBe("EUR");
      expect(provider.getCurrency("MX")).toBe("MXN");
      expect(provider.getCurrency("PA")).toBe("USD");
      expect(provider.getCurrency("PE")).toBe("PEN");
      expect(provider.getCurrency("US")).toBe("USD");
      expect(provider.getCurrency("VE")).toBe("USD");
    });

    it("devuelve USD para países no mapeados", () => {
      const provider = new PayPalProvider();
      expect(provider.getCurrency("XX")).toBe("USD");
    });
  });
});