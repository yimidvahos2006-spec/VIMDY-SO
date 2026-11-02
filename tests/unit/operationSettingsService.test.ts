import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../src/infrastructure/supabase/supabaseClient", () => ({ supabase: {} }));

import {
  saveOperationDraft,
  type SaveOperationInput,
  type SaveOperationDeps,
} from "../../src/core/services/operationSettingsService";
import { draftFromSources, normalizeDraft, type OperationDraft } from "../../src/core/config/operationDraft";
import type { Business } from "../../src/core/store/businessStore";
import type { CompanyConfig } from "../../src/core/store/companyConfigStore";
import type { PersistOperationSettingsInput } from "../../src/infrastructure/supabase/operationSettingsRepository";

const BUSINESS: Business = {
  name: "Café Yimid", nit: "900", owner: "Yimid", phone: "300", email: "a@b.co",
  address: "Cra 1", city: "La Unión", country: "CO", currency: "COP", whatsappOrders: "573001112233",
};

const COMPANY: CompanyConfig = {
  country: "CO", currency: "COP", tax: 8, serviceCharge: 0, language: "es", timezone: "America/Bogota",
  autoPrintReceipt: true, enableKitchen: true, enableTables: true, enableWhatsAppReports: true, enableAI: true,
  enableDelivery: false, dailySalesGoal: 500000, electronicInvoicing: { enabled: false, provider: "none" },
};

function draft(overrides: Partial<OperationDraft> = {}): OperationDraft {
  return normalizeDraft({
    ...draftFromSources(null, null, { autoPrintReceipt: false, enableAI: true }),
    salesChannels: ["presencial", "llevar"],
    hasTables: true,
    hasKitchen: true,
    kdsEnabled: true,
    ...overrides,
  });
}

function input(d: OperationDraft = draft()): SaveOperationInput {
  return { businessId: "biz-1", draft: d, previousConfig: null, previousModules: ["caja", "pedidos", "ia"] };
}

let persisted: PersistOperationSettingsInput[];
let applied: Array<Partial<CompanyConfig>>;
let cached: Array<{ id: string; blob: unknown }>;
let deps: SaveOperationDeps;

beforeEach(() => {
  persisted = [];
  applied = [];
  cached = [];
  deps = {
    persist: vi.fn(async (value) => { persisted.push(value); }),
    confirmProfile: vi.fn(async () => true),
    getBusiness: () => BUSINESS,
    getCompanyConfig: () => COMPANY,
    applyCompanyConfig: (patch) => { applied.push(patch); },
    cacheSettings: (id, blob) => { cached.push({ id, blob }); },
  };
});

describe("saveOperationDraft", () => {
  it("guarda todo en UNA sola escritura: módulos, operación y reglas de venta", async () => {
    const result = await saveOperationDraft(input(), deps);

    expect(result).toMatchObject({ ok: true, confirmed: true });
    expect(deps.persist).toHaveBeenCalledTimes(1);
    const call = persisted[0];
    expect(call.businessId).toBe("biz-1");
    expect(call.modules).toEqual(["caja", "pedidos", "mesas", "cocina", "ia"]);
    expect(call.config).toMatchObject({
      tablesEnabled: true, kitchenEnabled: true, kdsEnabled: true, kitchenOutputMode: "kds",
      salesChannels: ["presencial", "llevar"],
    });
    expect(call.settings).toMatchObject({ autoPrintReceipt: false, enableAI: true, nit: "900", dailySalesGoal: 500000 });
  });

  it("solo después de confirmar la base refleja el cambio en la sesión y en el caché", async () => {
    await saveOperationDraft(input(), deps);
    expect(applied).toEqual([{ autoPrintReceipt: false, enableAI: true }]);
    expect(cached).toHaveLength(1);
    expect(cached[0].id).toBe("biz-1");
    expect(cached[0].blob).toMatchObject({ autoPrintReceipt: false });
  });

  it("si Supabase rechaza el guardado no toca stores ni caché y devuelve el motivo", async () => {
    deps = { ...deps, persist: vi.fn(async () => { throw new Error("No se guardó. Solo el administrador puede cambiar la operación y el plan debe estar activo."); }) };
    const result = await saveOperationDraft(input(), deps);

    expect(result).toEqual({
      ok: false,
      message: "No se guardó. Solo el administrador puede cambiar la operación y el plan debe estar activo.",
    });
    expect(applied).toEqual([]);
    expect(cached).toEqual([]);
    expect(deps.confirmProfile).not.toHaveBeenCalled();
  });

  it("nunca muestra códigos técnicos: usa el mensaje de respaldo", async () => {
    deps = { ...deps, persist: vi.fn(async () => { throw new Error("SOME_INTERNAL_CODE: stack trace"); }) };
    const result = await saveOperationDraft(input(), deps);
    expect(result).toEqual({ ok: false, message: "No se pudo guardar la configuración." });
  });

  it("un valor inválido se bloquea antes de escribir en la base", async () => {
    const tampered = { ...draft(), salesChannels: ["presencial", "marte"] } as unknown as OperationDraft;
    const result = await saveOperationDraft(input(tampered), deps);
    expect(result.ok).toBe(false);
    expect(deps.persist).not.toHaveBeenCalled();
  });

  it("un negocio sin nombre o un IVA inválido se rechazan antes de escribir", async () => {
    deps = { ...deps, getBusiness: () => ({ ...BUSINESS, name: "   " }) };
    const result = await saveOperationDraft(input(), deps);
    expect(result).toEqual({ ok: false, message: "El nombre del negocio no puede quedar vacío." });
    expect(deps.persist).not.toHaveBeenCalled();
  });

  it("sin negocio activo no escribe nada", async () => {
    const result = await saveOperationDraft({ ...input(), businessId: "  " }, deps);
    expect(result.ok).toBe(false);
    expect(deps.persist).not.toHaveBeenCalled();
  });

  it("si se guardó pero no se pudo releer, lo dice (confirmed: false) sin perder el guardado", async () => {
    deps = { ...deps, confirmProfile: vi.fn(async () => false) };
    expect(await saveOperationDraft(input(), deps)).toMatchObject({ ok: true, confirmed: false });

    deps = { ...deps, confirmProfile: vi.fn(async () => { throw new Error("red caída"); }) };
    expect(await saveOperationDraft(input(), deps)).toMatchObject({ ok: true, confirmed: false });
    expect(applied.length).toBeGreaterThan(0);
  });
});