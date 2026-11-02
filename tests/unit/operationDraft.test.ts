import { describe, it, expect, vi } from "vitest";

vi.mock("../../src/infrastructure/supabase/supabaseClient", () => ({ supabase: {} }));

import {
  draftFromSources,
  draftToModules,
  draftToOperationConfig,
  hasBlockingIssues,
  isDraftEqual,
  kitchenOutputModeOf,
  normalizeDraft,
  operationDraftReducer,
  validateDraft,
  type OperationDraft,
  type SalesRulesDraft,
} from "../../src/core/config/operationDraft";
import { buildOperatingProfileColumns } from "../../src/infrastructure/supabase/operationSettingsRepository";
import { parseBusinessOperatingProfileRow } from "../../src/infrastructure/supabase/businessOperatingProfileRepository";
import type { ModuleId } from "../../src/core/config/modules";
import type { OperationConfig } from "../../src/core/config/operation";

const RULES: SalesRulesDraft = { autoPrintReceipt: true, enableAI: false };

const EMPTY: OperationDraft = draftFromSources(null, null, RULES);

function fullDraft(): OperationDraft {
  return normalizeDraft({
    salesChannels: ["plataformas", "presencial", "domicilio"],
    hasTables: true,
    hasWaiters: true,
    hasKitchen: true,
    kdsEnabled: true,
    printerEnabled: true,
    hasInventory: true,
    inventoryType: "ambos",
    productionMode: "batch",
    useCustomers: true,
    salesRules: { autoPrintReceipt: false, enableAI: true },
  });
}

describe("operationDraftReducer — reglas de consistencia", () => {
  it("apagar la cocina apaga también pantalla e impresora", () => {
    let draft = operationDraftReducer(EMPTY, { type: "setFlag", key: "hasKitchen", value: true });
    draft = operationDraftReducer(draft, { type: "setFlag", key: "kdsEnabled", value: true });
    draft = operationDraftReducer(draft, { type: "setFlag", key: "printerEnabled", value: true });
    expect(kitchenOutputModeOf(draft)).toBe("both");

    draft = operationDraftReducer(draft, { type: "setFlag", key: "hasKitchen", value: false });
    expect(draft.kdsEnabled).toBe(false);
    expect(draft.printerEnabled).toBe(false);
    expect(kitchenOutputModeOf(draft)).toBe("none");
  });

  it("no deja encender pantalla ni impresora sin cocina", () => {
    const draft = operationDraftReducer(EMPTY, { type: "setFlag", key: "kdsEnabled", value: true });
    expect(draft.kdsEnabled).toBe(false);
  });

  it("apagar el inventario borra el tipo de inventario y el modo de producción", () => {
    let draft = operationDraftReducer(EMPTY, { type: "setFlag", key: "hasInventory", value: true });
    draft = operationDraftReducer(draft, { type: "setInventoryType", value: "ingredientes" });
    draft = operationDraftReducer(draft, { type: "setProductionMode", value: "on_demand" });
    expect(draft.inventoryType).toBe("ingredientes");

    draft = operationDraftReducer(draft, { type: "setFlag", key: "hasInventory", value: false });
    expect(draft.inventoryType).toBeNull();
    expect(draft.productionMode).toBeNull();
  });

  it("alterna canales sin repetir y en el orden del catálogo", () => {
    let draft = operationDraftReducer(EMPTY, { type: "toggleChannel", channel: "web" });
    draft = operationDraftReducer(draft, { type: "toggleChannel", channel: "presencial" });
    draft = operationDraftReducer(draft, { type: "toggleChannel", channel: "web" });
    draft = operationDraftReducer(draft, { type: "toggleChannel", channel: "domicilio" });
    expect(draft.salesChannels).toEqual(["presencial", "domicilio"]);
  });

  it("cambiar una regla de venta no toca el resto del borrador", () => {
    const next = operationDraftReducer(fullDraft(), { type: "setSalesRule", key: "enableAI", value: false });
    expect(next.salesRules).toEqual({ autoPrintReceipt: false, enableAI: false });
    expect(next.salesChannels).toEqual(fullDraft().salesChannels);
  });

  it("isDraftEqual ignora el orden en que se marcaron los canales", () => {
    const a = { ...fullDraft(), salesChannels: ["domicilio", "presencial"] as OperationDraft["salesChannels"] };
    const b = { ...fullDraft(), salesChannels: ["presencial", "domicilio"] as OperationDraft["salesChannels"] };
    expect(isDraftEqual(a, b)).toBe(true);
    expect(isDraftEqual(a, { ...b, hasTables: false })).toBe(false);
  });
});

describe("draftToModules", () => {
  it("siempre incluye caja y pedidos y solo los módulos activados", () => {
    expect(draftToModules(EMPTY, null)).toEqual(["caja", "pedidos"]);
    expect(draftToModules(fullDraft(), null)).toEqual(["caja", "pedidos", "mesas", "cocina", "inventario", "clientes"]);
  });

  it("conserva módulos que esta pantalla no controla (ej. ia) y no los duplica", () => {
    const previous: ModuleId[] = ["caja", "pedidos", "mesas", "ia", "ia"];
    expect(draftToModules(EMPTY, previous)).toEqual(["caja", "pedidos", "ia"]);
  });
});

describe("validateDraft", () => {
  it("un borrador vacío solo genera advertencias (se puede guardar)", () => {
    const issues = validateDraft(EMPTY);
    expect(issues.map((i) => i.code)).toEqual(["NO_SALES_CHANNELS"]);
    expect(hasBlockingIssues(issues)).toBe(false);
  });

  it("avisa cocina sin salida e inventario incompleto", () => {
    const draft = normalizeDraft({ ...EMPTY, salesChannels: ["presencial"], hasKitchen: true, hasInventory: true });
    const codes = validateDraft(draft).map((i) => i.code);
    expect(codes).toContain("KITCHEN_WITHOUT_OUTPUT");
    expect(codes).toContain("INVENTORY_INCOMPLETE");
  });

  it("bloquea valores que la base de datos no acepta", () => {
    const tampered = { ...fullDraft(), salesChannels: ["presencial", "marte"] } as unknown as OperationDraft;
    expect(hasBlockingIssues(validateDraft(tampered))).toBe(true);
    const badType = { ...fullDraft(), inventoryType: "todo" } as unknown as OperationDraft;
    expect(hasBlockingIssues(validateDraft(badType))).toBe(true);
    const badMode = { ...fullDraft(), productionMode: "nunca" } as unknown as OperationDraft;
    expect(hasBlockingIssues(validateDraft(badMode))).toBe(true);
  });
});

describe("ida y vuelta: borrador -> columnas de Supabase -> perfil leído -> borrador", () => {
  function roundTrip(draft: OperationDraft, previousModules: ModuleId[] | null = null): OperationDraft {
    const config = draftToOperationConfig(draft, null);
    const modules = draftToModules(draft, previousModules);
    const columns = buildOperatingProfileColumns(modules, config);
    const profile = parseBusinessOperatingProfileRow("biz-1", { business_type: null, ...columns });
    return draftFromSources(profile.operationConfig, profile.enabledModules, draft.salesRules);
  }

  it("un negocio completo se carga igual que se guardó", () => {
    const draft = fullDraft();
    expect(isDraftEqual(roundTrip(draft), draft)).toBe(true);
  });

  it("un negocio mínimo (solo mostrador) se carga igual que se guardó", () => {
    const draft = normalizeDraft({ ...EMPTY, salesChannels: ["presencial"] });
    expect(isDraftEqual(roundTrip(draft), draft)).toBe(true);
  });

  it("cada combinación de salida de cocina sobrevive el viaje", () => {
    for (const [kds, printer] of [[true, false], [false, true], [true, true], [false, false]] as const) {
      const draft = normalizeDraft({ ...EMPTY, hasKitchen: true, kdsEnabled: kds, printerEnabled: printer });
      const loaded = roundTrip(draft);
      expect(loaded.kdsEnabled).toBe(kds);
      expect(loaded.printerEnabled).toBe(printer);
    }
  });

  it("las columnas guardan la columna heredada con un valor válido", () => {
    const none = buildOperatingProfileColumns(["caja"], draftToOperationConfig(EMPTY, null));
    expect(none.kitchen_output_mode).toBe("none");
    expect(none.salida_cocina).toBe("pantalla");
    const printer = buildOperatingProfileColumns(
      ["caja"],
      draftToOperationConfig(normalizeDraft({ ...EMPTY, hasKitchen: true, printerEnabled: true }), null),
    );
    expect(printer.salida_cocina).toBe("impresora");
  });

  it("conserva fotos de meseros y estaciones de preparación ya guardadas", () => {
    const previous: OperationConfig = {
      ...draftToOperationConfig(EMPTY, null),
      waiterPhotosEnabled: false,
      prepStations: [{ id: "s1", name: "Barra", type: "bar", enabled: true }],
    };
    const config = draftToOperationConfig(fullDraft(), previous);
    expect(config.waiterPhotosEnabled).toBe(false);
    expect(config.prepStations).toEqual(previous.prepStations);
  });
});