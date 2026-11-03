import { describe, it, expect, vi, beforeEach } from "vitest";

const eqCalls: Array<[string, unknown]> = [];
let queryResult: { data: unknown; error: { message: string } | null } = { data: [], error: null };

vi.mock("../../src/infrastructure/supabase/supabaseClient", () => {
  const builder: Record<string, unknown> = {};
  builder.select = vi.fn(() => builder);
  builder.eq = vi.fn((column: string, value: unknown) => {
    eqCalls.push([column, value]);
    return builder;
  });
  builder.order = vi.fn(() => Promise.resolve(queryResult));

  return {
    supabase: { from: vi.fn(() => builder), rpc: vi.fn(), functions: { invoke: vi.fn() } },
    getCurrentBusinessId: () => "test-business-id",
    getCurrentBranchId: () => "test-branch-id",
    setCurrentBusinessId: vi.fn(),
    setCurrentBranchId: vi.fn()
  };
});

import { paymentStore } from "../../src/core/store/paymentStore";
import {
  getPaymentAccountDisplayName,
  listActivePaymentAccounts
} from "../../src/infrastructure/supabase/paymentAccountsRepository";

describe("POS transferencia — consulta de cuentas activas", () => {
  beforeEach(() => {
    eqCalls.length = 0;
    queryResult = { data: [], error: null };
  });

  it("filtra por business_id e is_active = true", async () => {
    queryResult = {
      data: [
        {
          id: "acc-1",
          bank_name: "Nequi",
          account_number: "3001234567",
          holder_name: null,
          label: "Caja 1",
          is_universal_qr: false,
          is_active: true
        }
      ],
      error: null
    };

    const accounts = await listActivePaymentAccounts("biz-123");

    expect(eqCalls).toContainEqual(["business_id", "biz-123"]);
    expect(eqCalls).toContainEqual(["is_active", true]);
    expect(accounts).toHaveLength(1);
    expect(accounts[0]).toMatchObject({ id: "acc-1", bankName: "Nequi", label: "Caja 1" });
  });

  it("lanza un error legible si Supabase falla", async () => {
    queryResult = { data: null, error: { message: "boom" } };
    await expect(listActivePaymentAccounts("biz-123")).rejects.toThrow(
      "No se pudieron cargar las cuentas de cobro."
    );
  });
});

describe("POS transferencia — nombre visible de la cuenta", () => {
  it("usa banco + etiqueta", () => {
    expect(
      getPaymentAccountDisplayName({ bankName: "Nequi", label: "Caja 1", accountNumber: "3001234567" })
    ).toBe("Nequi - Caja 1");
    expect(
      getPaymentAccountDisplayName({ bankName: "Wompi", label: "Principal", accountNumber: "abc123" })
    ).toBe("Wompi - Principal");
  });

  it("sin etiqueta distingue por los últimos 4 dígitos", () => {
    expect(
      getPaymentAccountDisplayName({ bankName: "Nequi", label: "  ", accountNumber: "3001234567" })
    ).toBe("Nequi - ••4567");
  });
});

describe("POS transferencia — paymentStore", () => {
  beforeEach(() => {
    paymentStore.reset();
  });

  it("setPaymentAccount guarda el id y deja el nombre como referencia", () => {
    paymentStore.setMethod("transfer");
    paymentStore.setPaymentAccount("acc-1", "Nequi - Caja 1");

    const state = paymentStore.get();
    expect(state.paymentAccountId).toBe("acc-1");
    expect(state.reference).toBe("Nequi - Caja 1");
  });

  it("cambiar de método descarta la cuenta y su referencia", () => {
    paymentStore.setMethod("transfer");
    paymentStore.setPaymentAccount("acc-1", "Nequi - Caja 1");
    paymentStore.setMethod("card");

    const state = paymentStore.get();
    expect(state.paymentAccountId).toBe("");
    expect(state.reference).toBe("");
  });

  it("repetir el mismo método conserva la cuenta elegida", () => {
    paymentStore.setMethod("transfer");
    paymentStore.setPaymentAccount("acc-1", "Nequi - Caja 1");
    paymentStore.setMethod("transfer");

    expect(paymentStore.get().paymentAccountId).toBe("acc-1");
  });

  it("una referencia escrita a mano limpia la cuenta elegida", () => {
    paymentStore.setPaymentAccount("acc-1", "Nequi - Caja 1");
    paymentStore.setReference("comprobante 99");

    const state = paymentStore.get();
    expect(state.paymentAccountId).toBe("");
    expect(state.reference).toBe("comprobante 99");
  });

  it("clearPaymentAccount y reset dejan todo vacío", () => {
    paymentStore.setPaymentAccount("acc-1", "Nequi - Caja 1");
    paymentStore.clearPaymentAccount();
    expect(paymentStore.get().paymentAccountId).toBe("");
    expect(paymentStore.get().reference).toBe("");

    paymentStore.setPaymentAccount("acc-2", "Wompi - Principal");
    paymentStore.reset();
    expect(paymentStore.get().paymentAccountId).toBe("");
  });
});