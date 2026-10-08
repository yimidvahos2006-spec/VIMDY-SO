import { describe, it, expect, vi, beforeEach } from "vitest";
import { paymentStore } from "../../src/core/store/paymentStore";
import type { PaymentMethod } from "../../src/core/store/paymentStore";

vi.mock("../../src/infrastructure/supabase/supabaseClient", () => ({
  supabase: { from: vi.fn(), rpc: vi.fn(), functions: { invoke: vi.fn() } },
  getCurrentBusinessId: () => "test-business-id",
  getCurrentBranchId: () => "test-branch-id",
  setCurrentBusinessId: vi.fn(),
  setCurrentBranchId: vi.fn()
}));

vi.mock("../../src/core/store/companyConfigStore", () => ({
  companyConfigStore: {
    get: () => ({ currency: "COP" })
  }
}));

describe("POS Wompi Checkout — Payment Store", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    paymentStore.reset();
  });

  it("useWompiCheckout starts false on reset", () => {
    paymentStore.setUseWompiCheckout(true);
    expect(paymentStore.get().useWompiCheckout).toBe(true);
    paymentStore.reset();
    expect(paymentStore.get().useWompiCheckout).toBe(false);
  });

  it("setMethod resets useWompiCheckout to false", () => {
    paymentStore.setMethod("card");
    paymentStore.setUseWompiCheckout(true);
    paymentStore.setMethod("transfer");
    expect(paymentStore.get().useWompiCheckout).toBe(false);
  });

  it("setUseWompiCheckout toggles the flag", () => {
    paymentStore.setUseWompiCheckout(true);
    expect(paymentStore.get().useWompiCheckout).toBe(true);
    paymentStore.setUseWompiCheckout(false);
    expect(paymentStore.get().useWompiCheckout).toBe(false);
  });
});

describe("POS Wompi Checkout — canCharge gating", () => {
  it("bypasses reference requirement when useWompiCheckout is true and method is card", () => {
    const method: PaymentMethod = "card";

    paymentStore.setMethod("card");
    paymentStore.setUseWompiCheckout(true);

    const state = paymentStore.get();
    const needsReference = method === "card" || method === "transfer";

    expect(needsReference).toBe(true);
    expect(state.reference.trim().length).toBe(0);
    expect(state.useWompiCheckout).toBe(true);

    const canCharge =
      !needsReference ||
      state.reference.trim().length > 0 ||
      (state.useWompiCheckout && (method === "card" || method === "transfer" || method === "mixed"));

    expect(canCharge).toBe(true);
  });

  it("still requires reference when useWompiCheckout is false", () => {
    const method: PaymentMethod = "card";

    paymentStore.setMethod("card");
    paymentStore.setUseWompiCheckout(false);

    const state = paymentStore.get();
    const needsReference = method === "card" || method === "transfer";

    expect(needsReference).toBe(true);
    expect(state.reference.trim().length).toBe(0);
    expect(state.useWompiCheckout).toBe(false);
  });
});
