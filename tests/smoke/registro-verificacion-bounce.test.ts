// tests/smoke/registro-verificacion-bounce.test.ts
/* ===========================================================================
   REGRESSIÓN — Nuevo usuario verificado no vuelve a la "parte inicial".

   Caso real reportado en producción: una usuaria nueva registró su cuenta y
   verificó el código OTP, pero VIMDY la devolvía a "/registro" (inicio del
   flujo de creación) sin mostrar ningún error visible — Vercel no loggeaba
   nada porque el fallo se hunde en un catch silencioso + un <Navigate>.

   Cadena de causa-raíz (cliente), verificada en código:
     1. El usuario nuevo introduce el código correcto de OTP.
        `AuthContext.verifyOtp` → `verifyRegistrationOtp` (OK, sesión confirmada)
        → `completeRegistrationAndHydrate()` → `completeRegistration()`.
     2. Si `completeRegistration()` falla en el paso intermedio — típicamente
        `register-business` / `resolveBusinessSession` (letal read-after-write
        bajo RLS para un negocio recién creado) — antes su `finally` llamaba a
        `clearPendingRegistration()`, borrando el email de sessionStorage.
     3. El catch de `AuthContext.verifyOtp` llamaba a `supabase.auth.signOut()`,
        destruyendo la sesión YA verificada.
     4. En la siguiente renderización de `/verificar-codigo`:
          email          = pendingRegistrationEmail()  -> null  (borrado en 2)
          isAuthenticated = false                      (signOut en 3)
        → OtpPage.tsx:247 `if (!email) return <Navigate to="/registro" replace />`
        → el usuario vuelve a "/registro" (parte inicial) con el error
          oculto. Nada se loggea en Vercel porque es un catch + <Navigate>.

   Este test fija el invariante: ante un fallo intermedio, el registro
   pendiente se PRESERVA (para que /verificar-codigo muestre el email + el
   error y permita reenviar) y la sesión verificada NO se destruye.
   =========================================================================== */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("../../src/infrastructure/supabase/supabaseClient", () => ({
  supabase: {
    auth: {
      getSession: vi.fn(),
      getUser: vi.fn()
    },
    from: vi.fn(),
    functions: {
      invoke: vi.fn()
    }
  },
  setCurrentBusinessId: vi.fn(),
  getCurrentBusinessId: vi.fn(),
  setCurrentBranchId: vi.fn(),
  getCurrentBranchId: vi.fn()
}));

import {
  completeRegistration,
  getPendingRegistration
} from "../../src/infrastructure/supabase/authBusinessContext";
import { supabase } from "../../src/infrastructure/supabase/supabaseClient";

const PENDING = {
  businessName: "Restaurante La 14",
  ownerName: "Ana Cajera",
  country: "CO",
  email: "ana@la14.com"
};

const PENDING_KEY = "vimdy_pending_registration";

describe("Smoke: nuevo usuario verificado no vuelve al inicio", () => {
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
    store[PENDING_KEY] = JSON.stringify(PENDING);
    // Mock getSession to return a valid session
    (supabase.auth.getSession as ReturnType<typeof vi.fn>).mockResolvedValue({
      data: { session: { access_token: "mock-token" } },
      error: null
    });
    (supabase.functions.invoke as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error("REGISTER_BUSINESS_FAILED: no se pudo crear el negocio.")
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("preserva el registro pendiente cuando register-business falla, en vez de limpiarlo (evita el bounce silencioso a /registro)", async () => {
    await expect(completeRegistration()).rejects.toThrow(/REGISTER_BUSINESS_FAILED/);

    // Clave anti-bounce: el pending debe sobrevivir al fallo para que OtpPage
    // mantenga `email` y muestre el error en vez de disparar `!email -> /registro`.
    expect(getPendingRegistration()).toEqual(PENDING);
  });
});
