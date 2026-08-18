import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../src/infrastructure/supabase/supabaseClient", () => {
  const mockSupabase = {
    from: vi.fn(() => mockSupabase),
    select: vi.fn(() => mockSupabase),
    eq: vi.fn(() => mockSupabase),
    maybeSingle: vi.fn(),
    single: vi.fn(),
    insert: vi.fn(() => mockSupabase),
    update: vi.fn(() => mockSupabase),
    rpc: vi.fn(() => mockSupabase)
  };
  return { supabase: mockSupabase };
});

import { SubscriptionService } from "../../src/infrastructure/supabase/subscriptionService";

describe("SubscriptionService — trial por persona", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("canStartTrialForUser", () => {
    it("devuelve true si el usuario nunca usó trial", async () => {
      const { supabase } = await import("../../src/infrastructure/supabase/supabaseClient");
      (supabase as any).rpc.mockResolvedValueOnce({ data: false, error: null });

      const service = new SubscriptionService();
      const result = await service.canStartTrialForUser("user-1");

      expect(result).toBe(true);
      expect((supabase as any).rpc).toHaveBeenCalledWith("has_user_used_trial", {
        p_user_id: "user-1"
      });
    });

    it("devuelve false si el usuario ya usó trial", async () => {
      const { supabase } = await import("../../src/infrastructure/supabase/supabaseClient");
      (supabase as any).rpc.mockResolvedValueOnce({ data: true, error: null });

      const service = new SubscriptionService();
      const result = await service.canStartTrialForUser("user-1");

      expect(result).toBe(false);
    });

    it("devuelve false si hay error en la consulta", async () => {
      const { supabase } = await import("../../src/infrastructure/supabase/supabaseClient");
      (supabase as any).rpc.mockResolvedValueOnce({ data: null, error: { message: "DB_ERROR" } });

      const service = new SubscriptionService();
      const result = await service.canStartTrialForUser("user-1");

      expect(result).toBe(false);
    });
  });

  describe("recordTrialUsage", () => {
    it("registra el uso de trial correctamente", async () => {
      const { supabase } = await import("../../src/infrastructure/supabase/supabaseClient");
      (supabase as any).rpc.mockResolvedValueOnce({ data: null, error: null });

      const service = new SubscriptionService();
      const result = await service.recordTrialUsage("user-1", "business-1");

      expect(result.ok).toBe(true);
      expect((supabase as any).rpc).toHaveBeenCalledWith("record_trial_usage", {
        p_user_id: "user-1",
        p_business_id: "business-1"
      });
    });

    it("devuelve error si falla la inserción", async () => {
      const { supabase } = await import("../../src/infrastructure/supabase/supabaseClient");
      (supabase as any).rpc.mockResolvedValueOnce({ data: null, error: { message: "INSERT_FAILED" } });

      const service = new SubscriptionService();
      const result = await service.recordTrialUsage("user-1", "business-1");

      expect(result.ok).toBe(false);
      expect(result.error).toBe("INSERT_FAILED");
    });
  });
});
