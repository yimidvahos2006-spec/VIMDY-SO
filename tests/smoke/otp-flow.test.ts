// tests/smoke/otp-flow.test.ts
/* ===========================================================================
   SMOKE TEST — Flujo de autenticación definitivo de VIMDY (OTP).

    Cubre lo entregado en esta iteración:
      - registro: verifyRegistrationOtp usa type:"signup" (la especificación actual
        de @supabase/auth-js 2.110.x para email OTP signup verification).
      - recovery: VIMDY usa el flujo de link (resetPasswordForEmail), no OTP manual.
      - códigos incorrectos / expirados → mensajes claros.
      - completeRegistration: éxito limpia pending; fallo lo preserva (no bounce).
      - requestPasswordReset: dispara resetPasswordForEmail (NO revela si el email
        existe).
      - updatePassword: delegado a supabase.auth.updateUser.
 ===========================================================================
   El mock de supabaseClient se declara ANTES de importar los módulos bajo
   prueba: vitest hace hoisting de vi.mock, así que el cliente real (que exige
   VITE_SUPABASE_URL/VITE_SUPABASE_ANON_KEY) nunca se ejecuta.
*/
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const PENDING_KEY = "vimdy_pending_registration";

vi.mock("../../src/infrastructure/supabase/supabaseClient", () => ({
  supabase: {
    auth: {
      verifyOtp: vi.fn(),
      resend: vi.fn(),
      resetPasswordForEmail: vi.fn(),
      updateUser: vi.fn(),
      getUser: vi.fn(),
      signInWithPassword: vi.fn(),
      signUp: vi.fn(),
      getSession: vi.fn(),
      signOut: vi.fn(),
      onAuthStateChange: vi.fn(() => ({ data: { subscription: { unsubscribe: () => {} } } }))
    },
    from: vi.fn(),
    functions: { invoke: vi.fn() }
  },
  setCurrentBusinessId: vi.fn(),
  getCurrentBusinessId: vi.fn(),
  setCurrentBranchId: vi.fn(),
  getCurrentBranchId: vi.fn()
}));

import { supabase } from "../../src/infrastructure/supabase/supabaseClient";
import {
  verifyRegistrationOtp,
  resendRegistrationOtp,
  getResendCooldownSeconds
} from "../../src/infrastructure/supabase/authOtp";
import {
  completeRegistration,
  updatePassword,
  requestPasswordReset,
  getPendingRegistration
} from "../../src/infrastructure/supabase/authBusinessContext";

const PENDING = {
  businessName: "Restaurante La 14",
  ownerName: "Ana Cajera",
  country: "CO",
  email: "ana@la14.com"
};

const BUSINESS_ROW = {
  name: "Restaurante La 14",
  country: "CO",
  currency: "COP",
  language: "es",
  timezone: "America/Bogota",
  tax_rate: 19,
  onboarding_completed: false,
  business_type: null,
  enabled_modules: [],
  salida_cocina: "pantalla",
  sales_channels: [],
  inventory_type: null,
  production_mode: null,
  kds_enabled: false,
  printer_enabled: false
};

const store: Record<string, string> = {};

describe("Smoke: flujo OTP de VIMDY", () => {
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
    // Mock getSession to return a valid session by default
    (supabase.auth.getSession as ReturnType<typeof vi.fn>).mockResolvedValue({
      data: { session: { access_token: "mock-token" } },
      error: null
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function seedPending() {
    store[PENDING_KEY] = JSON.stringify(PENDING);
  }

  function mockBusinessMemberships(membership: unknown) {
    (supabase.from as ReturnType<typeof vi.fn>).mockImplementation((table: string) => {
      if (table === "business_members") {
        return {
          select: () => ({
            eq: () => ({
              limit: () => ({
                maybeSingle: async () => ({ data: membership, error: null })
              })
            })
          })
        };
      }
      if (table === "app_users") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({ data: null, error: null })
            })
          }),
          insert: async () => ({ data: null, error: null })
        };
      }
      if (table === "branches") {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                maybeSingle: async () => ({ data: { id: "branch-1" }, error: null })
              })
            })
          })
        };
      }
      return {
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({ data: null, error: null })
          })
        })
      };
    });
  }

  // ---------- SIGNUP OTP ----------
  describe("registro (signup OTP, type: 'signup')", () => {
    it("verifica el código y deja la sesión activa usando type:'signup'", async () => {
      seedPending();
      (supabase.auth.verifyOtp as ReturnType<typeof vi.fn>).mockResolvedValue({
        data: {
          session: { access_token: "at", user: { id: "u-1", email_confirmed_at: "2026-01-01T00:00:00Z" } },
          user: { id: "u-1", email_confirmed_at: "2026-01-01T00:00:00Z" }
        },
        error: null
      });

      await verifyRegistrationOtp("123456");

      expect(supabase.auth.verifyOtp).toHaveBeenCalledTimes(1);
      expect(supabase.auth.verifyOtp).toHaveBeenCalledWith({
        email: "ana@la14.com",
        token: "123456",
        type: "signup"
      });
    });

    it("con código incorrecto muestra un mensaje claro", async () => {
      seedPending();
      (supabase.auth.verifyOtp as ReturnType<typeof vi.fn>).mockResolvedValue({
        data: { session: null, user: null },
        error: { message: "Invalid OTP" }
      });

      await expect(verifyRegistrationOtp("999999")).rejects.toThrow(/El código no es correcto/);
    });

    it("con código expirado indica que venció", async () => {
      seedPending();
      (supabase.auth.verifyOtp as ReturnType<typeof vi.fn>).mockResolvedValue({
        data: { session: null, user: null },
        error: { message: "otp expired" }
      });

      await expect(verifyRegistrationOtp("123456")).rejects.toThrow(/El código venció/);
    });

    it("rechaza códigos que no tengan 6 dígitos", async () => {
      seedPending();
      await expect(verifyRegistrationOtp("12a")).rejects.toThrow(/6 dígitos/);
      expect(supabase.auth.verifyOtp).not.toHaveBeenCalled();
    });
  });

  // ---------- RECUPERACIÓN ----------
  // Nota: VIMDY no usa OTP manual para recuperación. El flujo es:
  // 1. Usuario solicita recovery → resetPasswordForEmail → email con link
  // 2. Usuario hace clic en el link → abre /actualizar-password?token=...
  // 3. UpdatePasswordPage detecta la sesión de recovery → updateUser({ password })
  // No hay verifyRecoveryOtp — el token viaja en la URL, no se escribe manualmente.
  describe("solicitud y actualización de contraseña", () => {
    it("requestPasswordReset dispara resetPasswordForEmail con redirect a /actualizar-password", async () => {
      (supabase.auth.resetPasswordForEmail as ReturnType<typeof vi.fn>).mockResolvedValue({
        data: {},
        error: null
      });

      await requestPasswordReset("ana@la14.com");

      expect(supabase.auth.resetPasswordForEmail).toHaveBeenCalledTimes(1);
      const [email, opts] = (supabase.auth.resetPasswordForEmail as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(email).toBe("ana@la14.com");
      expect(opts?.redirectTo).toBe("https://app.vimdy.co/actualizar-password");
    });

    it("updatePassword delega a supabase.auth.updateUser con la nueva contraseña", async () => {
      (supabase.auth.updateUser as ReturnType<typeof vi.fn>).mockResolvedValue({
        data: { user: { id: "u-1" } },
        error: null
      });

      await updatePassword("NuevaClave123!");

      expect(supabase.auth.updateUser).toHaveBeenCalledWith({ password: "NuevaClave123!" });
    });
  });

  // ---------- COMPLETE REGISTRATION ----------
  describe("completeRegistration", () => {
    beforeEach(() => {
      seedPending();
      (supabase.functions.invoke as ReturnType<typeof vi.fn>).mockResolvedValue({
        data: { ok: true, businessId: "biz-1" },
        error: null
      });
      (supabase.auth.getUser as ReturnType<typeof vi.fn>).mockResolvedValue({
        data: { user: { id: "u-1" } },
        error: null
      });
      (supabase.auth.getSession as ReturnType<typeof vi.fn>).mockResolvedValue({
        data: {
          session: {
            access_token: "test-access-token",
            refresh_token: "test-refresh-token",
            expires_in: 3600
          }
        },
        error: null
      });
      mockBusinessMemberships({
        business_id: "biz-1",
        role: "ADMIN",
        businesses: BUSINESS_ROW
      });
      // Mock window.location for node environment
      vi.stubGlobal("location", { href: "" });
    });

    afterEach(() => {
      vi.unstubAllGlobals();
    });

    it("crea el negocio, limpia el registro pendiente y redirige al dominio app al tener éxito", async () => {
      await completeRegistration();

      expect(getPendingRegistration()).toBeNull();
      expect(supabase.functions.invoke).toHaveBeenCalledWith("register-business", {
        body: { businessName: PENDING.businessName, ownerName: PENDING.ownerName, country: "CO", businessType: "restaurante" }
      });
      expect(supabase.auth.getUser).toHaveBeenCalled();
      expect(supabase.auth.getSession).toHaveBeenCalled();
      expect(location.href).toContain("https://app.vimdy.co/auth/callback");
      expect(location.href).toContain("access_token=test-access-token");
      expect(location.href).toContain("refresh_token=test-refresh-token");
    });

    it("NO borra el registro pendiente ni destruye la sesión si register-business falla (anti-bounce)", async () => {
      (supabase.functions.invoke as ReturnType<typeof vi.fn>).mockRejectedValue(
        new Error("REGISTER_BUSINESS_FAILED: no se pudo crear el negocio.")
      );

      await expect(completeRegistration()).rejects.toThrow(/REGISTER_BUSINESS_FAILED/);

      expect(getPendingRegistration()).toEqual(PENDING);
      expect(supabase.auth.signOut).not.toHaveBeenCalled();
    });
  });
});
