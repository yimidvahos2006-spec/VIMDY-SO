// tests/unit/waiterPhotoSettings.test.ts
/* ===========================================================================
   Interruptor GLOBAL "Mostrar fotos en tarjetas": vive en la configuración del
   negocio (Supabase), no en el dispositivo.
   =========================================================================== */
import { describe, it, expect, beforeEach, vi } from "vitest";

const calls: Array<{ table: string; row: Record<string, unknown>; id?: string }> = [];
const state: { result: { data: unknown; error: { message: string } | null } } = {
  result: { data: [{ id: "biz-1" }], error: null }
};

vi.mock("../../src/infrastructure/supabase/supabaseClient", () => ({
  supabase: {
    from: (table: string) => ({
      update: (row: Record<string, unknown>) => {
        const call: { table: string; row: Record<string, unknown>; id?: string } = { table, row };
        calls.push(call);
        return {
          eq: (_column: string, id: string) => {
            call.id = id;
            return { select: async () => state.result };
          }
        };
      }
    })
  }
}));

import { persistWaiterPhotosEnabled } from "../../src/infrastructure/supabase/operationSettingsRepository";
import {
  readWaiterPhotosEnabled,
  refreshWaiterPhotosEnabled,
  setWaiterPhotosEnabled,
  type WaiterPhotoSettingsDeps
} from "../../src/core/services/waiterPhotoSettingsService";
import { operationConfigStore } from "../../src/core/store/operationConfigStore";
import { DEFAULT_OPERATION_CONFIG } from "../../src/core/config/operation";
import { translateBusinessError } from "../../src/core/errors/translateBusinessError";

function fakeDeps(overrides: Partial<WaiterPhotoSettingsDeps> = {}): WaiterPhotoSettingsDeps {
  return {
    persist: vi.fn(async () => undefined),
    fetchRemote: vi.fn(async () => null),
    ...overrides
  };
}

beforeEach(() => {
  calls.length = 0;
  state.result = { data: [{ id: "biz-1" }], error: null };
  operationConfigStore.set({ ...DEFAULT_OPERATION_CONFIG, waiterPhotosEnabled: true });
});

describe("persistWaiterPhotosEnabled (Supabase)", () => {
  it("actualiza SOLO la columna waiter_photos_enabled del negocio", async () => {
    await persistWaiterPhotosEnabled(" biz-1 ", false);
    expect(calls).toEqual([{ table: "businesses", row: { waiter_photos_enabled: false }, id: "biz-1" }]);
  });

  it("si RLS devuelve 0 filas (no es administrador) lanza WAITERS_FORBIDDEN, no 'guardado'", async () => {
    state.result = { data: [], error: null };
    const error = await persistWaiterPhotosEnabled("biz-1", false).catch((e: unknown) => e);
    expect((error as Error).message).toMatch(/^WAITERS_FORBIDDEN/);
    expect(translateBusinessError(error)).toContain("administrador");
  });

  it("un error de la base se traduce a mensaje legible", async () => {
    state.result = { data: null, error: { message: "boom" } };
    const error = await persistWaiterPhotosEnabled("biz-1", false).catch((e: unknown) => e);
    expect(translateBusinessError(error)).toBe("No se pudo guardar el ajuste de fotos. Intenta de nuevo.");
  });

  it("sin negocio activo no escribe nada", async () => {
    await expect(persistWaiterPhotosEnabled("  ", false)).rejects.toThrow();
    expect(calls).toHaveLength(0);
  });
});

describe("setWaiterPhotosEnabled", () => {
  it("cambia al instante en el store y lo guarda en el servidor", async () => {
    const deps = fakeDeps();
    await setWaiterPhotosEnabled("biz-1", false, deps);
    expect(readWaiterPhotosEnabled()).toBe(false);
    expect(deps.persist).toHaveBeenCalledWith("biz-1", false);
  });

  it("si el servidor lo rechaza, vuelve al valor anterior y lanza el error", async () => {
    const deps = fakeDeps({
      persist: vi.fn(async () => {
        throw new Error("WAITERS_FORBIDDEN: solo el administrador puede cambiar este ajuste.");
      })
    });
    await expect(setWaiterPhotosEnabled("biz-1", false, deps)).rejects.toThrow(/^WAITERS_FORBIDDEN/);
    expect(readWaiterPhotosEnabled()).toBe(true);
  });

  it("si ya tiene ese valor no llama al servidor", async () => {
    const deps = fakeDeps();
    await setWaiterPhotosEnabled("biz-1", true, deps);
    expect(deps.persist).not.toHaveBeenCalled();
  });

  it("mientras la configuración no carga, las fotos se muestran (valor por defecto)", () => {
    operationConfigStore.clear();
    expect(readWaiterPhotosEnabled()).toBe(true);
  });
});

describe("refreshWaiterPhotosEnabled (otro dispositivo cambió el valor)", () => {
  it("adopta el valor del servidor", async () => {
    await refreshWaiterPhotosEnabled("biz-1", { fetchRemote: async () => false });
    expect(readWaiterPhotosEnabled()).toBe(false);
  });

  it("sin respuesta o sin red conserva el valor actual y no lanza", async () => {
    await refreshWaiterPhotosEnabled("biz-1", { fetchRemote: async () => null });
    expect(readWaiterPhotosEnabled()).toBe(true);
    await expect(
      refreshWaiterPhotosEnabled("biz-1", {
        fetchRemote: async () => {
          throw new Error("offline");
        }
      })
    ).resolves.toBeUndefined();
    expect(readWaiterPhotosEnabled()).toBe(true);
  });

  it("no inventa configuración si todavía no cargó", async () => {
    operationConfigStore.clear();
    await refreshWaiterPhotosEnabled("biz-1", { fetchRemote: async () => false });
    expect(operationConfigStore.get()).toBeNull();
  });
});