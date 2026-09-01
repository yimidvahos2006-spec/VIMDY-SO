// tests/smoke/resend-otp.test.ts
/* ===========================================================================
   SMOKE TEST — Reenvío de código OTP (signup).

   `resend` solo admite type:'signup' en @supabase/supabase-js 2.110.x
   (ResendParams: 'signup' | 'email_change'). Verifica:
     - el reenvío usa { type: 'signup', email }.
     - un reenvío inmediato se bloquea por el cooldown de 30s (cliente).
     - tras 30s el reenvío vuelve a estar permitido.
 =========================================================================== */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const PENDING_KEY = "vimdy_pending_registration";

vi.mock("../../src/infrastructure/supabase/supabaseClient", () => ({
  supabase: {
    auth: { resend: vi.fn() },
    from: vi.fn(),
    functions: { invoke: vi.fn() }
  },
  setCurrentBusinessId: vi.fn(),
  getCurrentBusinessId: vi.fn(),
  setCurrentBranchId: vi.fn(),
  getCurrentBranchId: vi.fn()
}));

import { supabase } from "../../src/infrastructure/supabase/supabaseClient";
import { resendRegistrationOtp, getResendCooldownSeconds } from "../../src/infrastructure/supabase/authOtp";

const store: Record<string, string> = {};

beforeEach(() => {
  vi.clearAllMocks();
  for (const key of Object.keys(store)) delete store[key];
  vi.stubGlobal("sessionStorage", {
    getItem: (key: string) => (key in store ? store[key] : null),
    setItem: (key: string, value: string) => {
      store[key] = String(value);
    },
    removeItem: (key: string) => {
      delete store[key];
    },
    clear: () => {
      for (const key of Object.keys(store)) delete store[key];
    }
  });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("Smoke: reenvío de OTP", () => {
  it("reenvía con type:'signup', bloquea el reenvío inmediato por cooldown y lo permite tras 30s", async () => {
    store[PENDING_KEY] = JSON.stringify({
      businessName: "Restaurante La 14",
      ownerName: "Ana Cajera",
      country: "CO",
      email: "ana@la14.com"
    });

    (supabase.auth.resend as ReturnType<typeof vi.fn>).mockResolvedValue({ error: null });

    vi.useFakeTimers();
    vi.setSystemTime(1_000_000);

    await resendRegistrationOtp();
    expect(supabase.auth.resend).toHaveBeenCalledTimes(1);
    expect(supabase.auth.resend).toHaveBeenCalledWith({ type: "signup", email: "ana@la14.com" });

    expect(getResendCooldownSeconds()).toBe(30);

    await expect(resendRegistrationOtp()).rejects.toThrow(/Espera [0-9]+s antes de pedir otro código/);
    expect(supabase.auth.resend).toHaveBeenCalledTimes(1);

    vi.setSystemTime(1_035_000);
    await resendRegistrationOtp();
    expect(supabase.auth.resend).toHaveBeenCalledTimes(2);
  });
});
