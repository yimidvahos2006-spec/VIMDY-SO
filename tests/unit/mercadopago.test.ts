import { beforeEach, describe, expect, it, vi } from "vitest";

const invokeMock = vi.fn();

vi.mock("../../src/infrastructure/supabase/supabaseClient", () => ({
  supabase: {
    functions: {
      invoke: (...args: unknown[]) => invokeMock(...args)
    }
  }
}));

import { MercadoPagoProvider } from "../../src/core/payments/providers/mercadopago/MercadoPagoProvider";
import type { PaymentRequest, RefundRequest } from "../../src/core/payments/models/PaymentModels";

describe("MercadoPagoProvider", () => {
  beforeEach(() => {
    invokeMock.mockReset();
  });

  describe("createPayment", () => {
    it("crea la preferencia real vía mercadopago-checkout", async () => {
      invokeMock.mockResolvedValue({
        data: { ok: true, checkoutUrl: "https://mercadopago.com/checkout?pref=1", reference: "PREF-1" },
        error: null
      });

      const provider = new MercadoPagoProvider();
      const request: PaymentRequest = {
        id: "pay-1",
        provider: "mercadopago",
        businessId: "biz-1",
        country: "AR",
        currency: "ARS",
        amount: 1000,
        businessType: "restaurant",
        plan: "monthly"
      };

      const result = await provider.createPayment(request);

      expect(invokeMock).toHaveBeenCalledWith("mercadopago-checkout", {
        body: { businessId: "biz-1", plan: "monthly" }
      });
      expect(result.checkoutUrl).toBe("https://mercadopago.com/checkout?pref=1");
      expect(result.status).toBe("pending");
    });

    it("rechaza un plan no facturable por Mercado Pago", async () => {
      const provider = new MercadoPagoProvider();
      const request: PaymentRequest = {
        id: "pay-2",
        provider: "mercadopago",
        businessId: "biz-1",
        country: "AR",
        currency: "ARS",
        amount: 1000,
        businessType: "restaurant",
        plan: "trial" as PaymentRequest["plan"]
      };

      await expect(provider.createPayment(request)).rejects.toThrow(/plan no facturable/);
      expect(invokeMock).not.toHaveBeenCalled();
    });
  });

  describe("getPayment", () => {
    it("consulta la transacción real vía mercadopago-get-transaction", async () => {
      invokeMock.mockResolvedValue({
        data: {
          ok: true,
          payment: {
            id: "12345",
            status: "approved",
            transaction_amount: 1000,
            currency_id: "ARS",
            date_created: "2026-08-01T00:00:00Z",
            reference_id: "REF-1"
          }
        },
        error: null
      });

      const provider = new MercadoPagoProvider();
      const result = await provider.getPayment("12345");

      expect(invokeMock).toHaveBeenCalledWith("mercadopago-get-transaction", { body: { paymentId: "12345" } });
      expect(result.status).toBe("approved");
      expect(result.amount).toBe(1000);
      expect(result.currency).toBe("ARS");
    });

    it("propaga error si la Edge Function no encuentra la transacción", async () => {
      invokeMock.mockResolvedValue({
        data: null,
        error: { message: "TRANSACTION_NOT_FOUND" }
      });

      const provider = new MercadoPagoProvider();

      await expect(provider.getPayment("99999")).rejects.toThrow("TRANSACTION_NOT_FOUND");
    });

    it("nunca inventa amount/currency/status si MercadoPago no responde", async () => {
      invokeMock.mockResolvedValue({
        data: null,
        error: { message: "MERCADOPAGO_GET_REJECTED" }
      });

      const provider = new MercadoPagoProvider();

      await expect(provider.getPayment("99999")).rejects.toThrow("MERCADOPAGO_GET_REJECTED");
    });
  });

  describe("cancelPayment", () => {
    it("cancela vía mercadopago-cancel y devuelve el estado real", async () => {
      invokeMock.mockResolvedValue({
        data: {
          ok: true,
          payment: {
            id: "12345",
            status: "cancelled",
            transaction_amount: 1000,
            currency_id: "ARS",
            date_created: "2026-08-01T00:00:00Z",
            reference_id: "REF-1"
          }
        },
        error: null
      });

      const provider = new MercadoPagoProvider();
      const result = await provider.cancelPayment("12345");

      expect(invokeMock).toHaveBeenCalledWith("mercadopago-cancel", { body: { paymentId: "12345" } });
      expect(result.status).toBe("cancelled");
      expect(result.amount).toBe(1000);
    });

    it("propaga error si Mercado Pago rechaza la cancelación", async () => {
      invokeMock.mockResolvedValue({
        data: null,
        error: { message: "MERCADOPAGO_CANCEL_REJECTED" }
      });

      const provider = new MercadoPagoProvider();

      await expect(provider.cancelPayment("12345")).rejects.toThrow("MERCADOPAGO_CANCEL_REJECTED");
    });

    it("nunca devuelve cancelled si MercadoPago no confirmó", async () => {
      invokeMock.mockResolvedValue({
        data: null,
        error: { message: "PAYMENT_ALREADY_CANCELLED" }
      });

      const provider = new MercadoPagoProvider();

      await expect(provider.cancelPayment("12345")).rejects.toThrow("PAYMENT_ALREADY_CANCELLED");
    });
  });

  describe("refundPayment", () => {
    it("reembolsa vía mercadopago-refund y devuelve el estado real", async () => {
      invokeMock.mockResolvedValue({
        data: {
          ok: true,
          refund: {
            id: "REFUND-1",
            status: "approved",
            amount: 1000,
            source: { id: "12345" }
          }
        },
        error: null
      });

      const provider = new MercadoPagoProvider();
      const result = await provider.refundPayment({ paymentId: "12345", amount: 1000, reason: "Cliente canceló" });

      expect(invokeMock).toHaveBeenCalledWith("mercadopago-refund", {
        body: { paymentId: "12345", amount: 1000, reason: "Cliente canceló" }
      });
      expect(result.status).toBe("approved");
      expect(result.amount).toBe(1000);
    });

    it("reembolsa total si no se envía amount", async () => {
      invokeMock.mockResolvedValue({
        data: {
          ok: true,
          refund: {
            id: "REFUND-2",
            status: "completed",
            amount: 5000,
            source: { id: "12345" }
          }
        },
        error: null
      });

      const provider = new MercadoPagoProvider();
      const result = await provider.refundPayment({ paymentId: "12345" });

      expect(invokeMock).toHaveBeenCalledWith("mercadopago-refund", {
        body: { paymentId: "12345" }
      });
      expect(result.status).toBe("approved");
    });

    it("propaga error si Mercado Pago rechaza el reembolso", async () => {
      invokeMock.mockResolvedValue({
        data: null,
        error: { message: "MERCADOPAGO_REFUND_REJECTED" }
      });

      const provider = new MercadoPagoProvider();

      await expect(provider.refundPayment({ paymentId: "12345" })).rejects.toThrow("MERCADOPAGO_REFUND_REJECTED");
    });

    it("nunca devuelve refunded si MercadoPago no confirmó", async () => {
      invokeMock.mockResolvedValue({
        data: {
          ok: true,
          refund: {
            id: "REFUND-3",
            status: "pending",
            amount: 1000
          }
        },
        error: null
      });

      const provider = new MercadoPagoProvider();
      const result = await provider.refundPayment({ paymentId: "12345" });

      expect(result.status).toBe("pending");
      expect(result.status).not.toBe("refunded");
    });
  });

  describe("getStatus", () => {
    it("mapea los estados de Mercado Pago a los estados normalizados de VIMDY", () => {
      const provider = new MercadoPagoProvider();

      expect(provider.getStatus("approved")).toBe("approved");
      expect(provider.getStatus("pending")).toBe("pending");
      expect(provider.getStatus("cancelled")).toBe("cancelled");
      expect(provider.getStatus("refunded")).toBe("refunded");
      expect(provider.getStatus("rejected")).toBe("declined");
      expect(provider.getStatus("in_process")).toBe("pending");
      expect(provider.getStatus("algo-desconocido")).toBe("error");
    });
  });

  describe("getAvailableMethods", () => {
    it("devuelve los métodos para México", () => {
      const provider = new MercadoPagoProvider();
      expect(provider.getAvailableMethods("MX")).toEqual(["mercadopago_wallet", "bank_transfer", "card"]);
    });

    it("devuelve los métodos por defecto para otros países", () => {
      const provider = new MercadoPagoProvider();
      expect(provider.getAvailableMethods("AR")).toEqual(["mercadopago_wallet", "card"]);
    });
  });

  describe("getCurrency", () => {
    it("devuelve la moneda correcta por país", () => {
      const provider = new MercadoPagoProvider();
      expect(provider.getCurrency("AR")).toBe("ARS");
      expect(provider.getCurrency("MX")).toBe("MXN");
      expect(provider.getCurrency("CL")).toBe("CLP");
      expect(provider.getCurrency("PE")).toBe("PEN");
      expect(provider.getCurrency("EC")).toBe("USD");
      expect(provider.getCurrency("XX")).toBe("USD");
    });
  });
});
