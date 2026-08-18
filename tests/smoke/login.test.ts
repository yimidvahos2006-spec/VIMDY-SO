// tests/smoke/login.test.ts
/* ===========================================================================
   SMOKE TEST — Login
   ---------------------------------------------------------------------------
   CRÍTICO #7 del checklist de lanzamiento — flujo #4.

   Por qué se prueba así: desde el CRÍTICO #1 del checklist, el login real
   (verificar contraseña) pasa por `supabase.auth.signInWithPassword()` —
   es decir, por Supabase Auth, software de terceros ya probado, no por
   código nuestro. Lo que SÍ es nuestro y SÍ puede romperse es el "pegante"
   alrededor de eso: `signIn()` en authBusinessContext.ts, que toma la
   sesión que Supabase Auth ya validó y resuelve a qué negocio pertenece
   ese usuario y con qué rol. Por eso este smoke test mockea el cliente de
   Supabase (no hay red real ni proyecto que configurar) y prueba SOLO esa
   lógica propia:

    1. Credenciales inválidas -> error claro, sin resolver ningún negocio.
    2. Login válido pero el usuario no pertenece a ningún negocio -> error
       claro ("no está asociado a ningún negocio"), no una sesión a medias.
    3. Login válido y con negocio -> BusinessSession completa y
       `setCurrentBusinessId()` se llama con el business_id correcto (todo
       el resto de repositorios depende de que esto se haya llamado).

   Si `signIn()` se rompe, nadie puede entrar a VIMDY — es, literalmente,
   el flujo más crítico de los 4.
 =========================================================================== */

import { describe, it, expect, vi, beforeEach } from "vitest";

// El mock se declara ANTES de importar authBusinessContext.ts: vitest hace
// hoisting de vi.mock, así que el módulo real de supabaseClient (que exige
// variables VITE_SUPABASE_URL/VITE_SUPABASE_ANON_KEY) nunca llega a
// ejecutarse durante este test.
vi.mock("../../src/infrastructure/supabase/supabaseClient", () => ({
  supabase: {
    auth: {
      signInWithPassword: vi.fn()
    },
    from: vi.fn()
  },
  setCurrentBusinessId: vi.fn(),
  getCurrentBusinessId: vi.fn(),
  setCurrentBranchId: vi.fn(),
  getCurrentBranchId: vi.fn()
}));

import { signIn } from "../../src/infrastructure/supabase/authBusinessContext";
import { supabase, setCurrentBusinessId, setCurrentBranchId } from "../../src/infrastructure/supabase/supabaseClient";

/** Arma el mock de `supabase.from("business_members").select(...).eq(...)`. */
function mockBusinessMemberships(result: { data: unknown; error: unknown }) {
  (supabase.from as ReturnType<typeof vi.fn>).mockImplementation((table: string) => {
    if (table === "business_members") {
      return {
        select: () => ({
          eq: () => result
        })
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

describe("Smoke: login", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("rechaza credenciales inválidas sin intentar resolver ningún negocio", async () => {
    (supabase.auth.signInWithPassword as ReturnType<typeof vi.fn>).mockResolvedValue({
      data: { user: null },
      error: { message: "Invalid login credentials" }
    });

    await expect(signIn("mesero@restaurante.com", "clave-incorrecta")).rejects.toThrow(
      /Correo o contraseña incorrectos/
    );

    expect(supabase.from).not.toHaveBeenCalled();
    expect(setCurrentBusinessId).not.toHaveBeenCalled();
  });

  it("devuelve null cuando el usuario no está asociado a ningún negocio", async () => {
    (supabase.auth.signInWithPassword as ReturnType<typeof vi.fn>).mockResolvedValue({
      data: { user: { id: "user-huerfano", user_metadata: { full_name: "Sin Negocio" } } },
      error: null
    });

    mockBusinessMemberships({ data: [], error: null });

    const result = await signIn("sinnegocio@ejemplo.com", "clave-correcta");
    expect(result).toBeNull();
    expect(setCurrentBusinessId).not.toHaveBeenCalled();
  });

  it("resuelve la sesión de negocio completa con un login válido y activa el business_id", async () => {
    (supabase.auth.signInWithPassword as ReturnType<typeof vi.fn>).mockResolvedValue({
      data: {
        user: {
          id: "user-1",
          user_metadata: { full_name: "Ana Cajera" }
        }
      },
      error: null
    });

    mockBusinessMemberships({
      data: [
        {
          business_id: "business-1",
          role: "CASHIER",
          businesses: {
            name: "Restaurante La 14",
            country: "CO",
            currency: "COP",
            language: "es",
            timezone: "America/Bogota",
            tax_rate: 19,
            onboarding_completed: true,
            business_type: "restaurant",
            enabled_modules: ["pos", "kitchen"],
            salida_cocina: "pantalla"
          }
        }
      ],
      error: null
    });

    const result = await signIn("ana@la14.com", "clave-correcta");

    expect(result).not.toBeNull();
    expect((result as any).userId).toBe("user-1");
    expect((result as any).businessId).toBe("business-1");
    expect((result as any).businessName).toBe("Restaurante La 14");
    expect((result as any).role).toBe("CASHIER");
    expect((result as any).currency).toBe("COP");
    expect((result as any).onboardingCompleted).toBe(true);

    expect(setCurrentBusinessId).toHaveBeenCalledWith("business-1");
  });
});
