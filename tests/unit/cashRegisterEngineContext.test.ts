import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CashRegisterEngine } from "../../src/core/engines/CashRegisterEngine";
import type { CashRegisterRepository } from "../../src/infrastructure/di/repositories/CashRegisterRepository";
import {
  getCurrentBusinessId,
  getCurrentBranchId,
  setCurrentBusinessId,
  setCurrentBranchId,
} from "../../src/infrastructure/supabase/supabaseClient";

describe("CashRegisterEngine — contexto de negocio/sucursal", () => {
  let repository: CashRegisterRepository;
  let engine: CashRegisterEngine;
  let previousBusinessId: string | undefined;
  let previousBranchId: string | undefined;

  beforeEach(() => {
    previousBusinessId = getCurrentBusinessId();
    previousBranchId = getCurrentBranchId();
    setCurrentBusinessId("business-a");
    setCurrentBranchId("branch-a");
    repository = { save: vi.fn() } as unknown as CashRegisterRepository;
    engine = new CashRegisterEngine(repository);
  });

  afterEach(() => {
    setCurrentBusinessId(previousBusinessId ?? null);
    setCurrentBranchId(previousBranchId ?? null);
  });

  it("rechaza crear una caja para otra sucursal antes de persistir", async () => {
    await expect(
      engine.create({
        businessId: "business-a",
        branchId: "branch-b",
        name: "Caja fuera de contexto",
        code: "OUT-OF-SCOPE",
      }),
    ).rejects.toThrow("CASH_REGISTER_CONTEXT_MISMATCH");

    expect(repository.save).not.toHaveBeenCalled();
  });

  it("rechaza crear una caja cuando no hay sucursal activa", async () => {
    setCurrentBranchId(null);

    await expect(
      engine.create({
        businessId: "business-a",
        branchId: "branch-a",
        name: "Caja sin sucursal activa",
        code: "NO-BRANCH",
      }),
    ).rejects.toThrow("NO_BRANCH_CONTEXT");

    expect(repository.save).not.toHaveBeenCalled();
  });
});
