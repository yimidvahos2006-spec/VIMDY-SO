/**
 * operationDraft.ts
 * ---------------------------------------------------------------------------
 * Estado ÚNICO y tipado de la pantalla Configuración > Operación
 * ("Cómo trabaja tu negocio").
 *
 * Todo lo que el dueño puede cambiar ahí vive en un solo objeto inmutable
 * (`OperationDraft`) con un reducer que mantiene las reglas de consistencia
 * (sin cocina no hay pantalla ni impresora; sin inventario no hay tipo de
 * inventario ni modo de producción). Este archivo es PURO: no importa React,
 * ni Supabase, ni stores, para poder probarlo sin nada de eso.
 */

import type { ModuleId } from "./modules";
import {
  INVENTORY_TYPE_OPTIONS,
  PRODUCTION_MODE_OPTIONS,
  SALES_CHANNEL_OPTIONS,
  type InventoryType,
  type KitchenOutputModeConfig,
  type OperationConfig,
  type ProductionMode,
  type SalesChannel,
} from "./operation";

export const SALES_CHANNEL_VALUES: readonly SalesChannel[] = SALES_CHANNEL_OPTIONS.map((o) => o.value);
const INVENTORY_TYPE_VALUES: readonly InventoryType[] = INVENTORY_TYPE_OPTIONS.map((o) => o.value);
const PRODUCTION_MODE_VALUES: readonly ProductionMode[] = PRODUCTION_MODE_OPTIONS.map((o) => o.value);

export function isSalesChannel(value: unknown): value is SalesChannel {
  return typeof value === "string" && (SALES_CHANNEL_VALUES as readonly string[]).includes(value);
}

export function isInventoryType(value: unknown): value is InventoryType {
  return typeof value === "string" && (INVENTORY_TYPE_VALUES as readonly string[]).includes(value);
}

export function isProductionMode(value: unknown): value is ProductionMode {
  return typeof value === "string" && (PRODUCTION_MODE_VALUES as readonly string[]).includes(value);
}

/** Reglas de venta que hoy usa el sistema (se guardan en `businesses.settings`). */
export interface SalesRulesDraft {
  readonly autoPrintReceipt: boolean;
  readonly enableAI: boolean;
}

export interface OperationDraft {
  readonly salesChannels: readonly SalesChannel[];
  readonly hasTables: boolean;
  readonly hasWaiters: boolean;
  readonly hasKitchen: boolean;
  readonly kdsEnabled: boolean;
  readonly printerEnabled: boolean;
  readonly hasInventory: boolean;
  readonly inventoryType: InventoryType | null;
  readonly productionMode: ProductionMode | null;
  readonly useCustomers: boolean;
  /** VIMDY Contable (módulo opcional): gastos fijos y utilidad neta real. */
  readonly hasAccounting: boolean;
  readonly salesRules: SalesRulesDraft;
}

export type OperationFlagKey =
  | "hasTables"
  | "hasWaiters"
  | "hasKitchen"
  | "kdsEnabled"
  | "printerEnabled"
  | "hasInventory"
  | "useCustomers"
  | "hasAccounting";

export type SalesRuleKey = keyof SalesRulesDraft;

export type OperationDraftAction =
  | { readonly type: "toggleChannel"; readonly channel: SalesChannel }
  | { readonly type: "setFlag"; readonly key: OperationFlagKey; readonly value: boolean }
  | { readonly type: "setInventoryType"; readonly value: InventoryType }
  | { readonly type: "setProductionMode"; readonly value: ProductionMode }
  | { readonly type: "setSalesRule"; readonly key: SalesRuleKey; readonly value: boolean }
  | { readonly type: "replace"; readonly draft: OperationDraft };

export const DEFAULT_SALES_RULES: SalesRulesDraft = { autoPrintReceipt: true, enableAI: true };

/**
 * Aplica las reglas de consistencia y deja los canales sin repetidos y en el
 * orden del catálogo (así comparar dos borradores es estable).
 */
export function normalizeDraft(draft: OperationDraft): OperationDraft {
  const channels = SALES_CHANNEL_VALUES.filter((channel) => draft.salesChannels.includes(channel));
  const hasKitchen = draft.hasKitchen;
  const hasInventory = draft.hasInventory;
  return {
    ...draft,
    salesChannels: channels,
    kdsEnabled: hasKitchen && draft.kdsEnabled,
    printerEnabled: hasKitchen && draft.printerEnabled,
    inventoryType: hasInventory ? draft.inventoryType : null,
    productionMode: hasInventory ? draft.productionMode : null,
  };
}

export function operationDraftReducer(state: OperationDraft, action: OperationDraftAction): OperationDraft {
  switch (action.type) {
    case "toggleChannel": {
      const next = state.salesChannels.includes(action.channel)
        ? state.salesChannels.filter((channel) => channel !== action.channel)
        : [...state.salesChannels, action.channel];
      return normalizeDraft({ ...state, salesChannels: next });
    }
    case "setFlag":
      return normalizeDraft({ ...state, [action.key]: action.value });
    case "setInventoryType":
      return normalizeDraft({ ...state, inventoryType: action.value });
    case "setProductionMode":
      return normalizeDraft({ ...state, productionMode: action.value });
    case "setSalesRule":
      return { ...state, salesRules: { ...state.salesRules, [action.key]: action.value } };
    case "replace":
      return normalizeDraft(action.draft);
  }
}

export function isDraftEqual(a: OperationDraft, b: OperationDraft): boolean {
  return JSON.stringify(normalizeDraft(a)) === JSON.stringify(normalizeDraft(b));
}

/**
 * Construye el borrador a partir de lo que ya está cargado de la base de datos.
 * Misma prioridad que tenía la pantalla: el valor explícito de la configuración
 * manda; si falta, se usa la lista de módulos activos.
 */
export function draftFromSources(
  config: OperationConfig | null,
  modules: readonly ModuleId[] | null,
  salesRules: SalesRulesDraft,
): OperationDraft {
  const has = (id: ModuleId): boolean => modules?.includes(id) ?? false;
  return normalizeDraft({
    salesChannels: config?.salesChannels ?? [],
    hasTables: config?.tablesEnabled ?? has("mesas"),
    hasWaiters: config?.waiterModeEnabled ?? false,
    hasKitchen: config?.kitchenEnabled ?? has("cocina"),
    kdsEnabled: config?.kdsEnabled ?? false,
    printerEnabled: config?.printerEnabled ?? false,
    hasInventory: has("inventario"),
    inventoryType: config?.inventoryType ?? null,
    productionMode: config?.productionMode ?? null,
    useCustomers: has("clientes"),
    hasAccounting: has("contable"),
    salesRules,
  });
}

/** Módulos que ESTA pantalla controla. Los demás (ej. "ia") se conservan tal cual. */
const MANAGED_MODULES: readonly ModuleId[] = ["caja", "pedidos", "mesas", "cocina", "inventario", "clientes", "contable"];

export function draftToModules(draft: OperationDraft, previousModules: readonly ModuleId[] | null): ModuleId[] {
  const modules: ModuleId[] = ["caja", "pedidos"];
  if (draft.hasTables) modules.push("mesas");
  if (draft.hasKitchen) modules.push("cocina");
  if (draft.hasInventory) modules.push("inventario");
  if (draft.useCustomers) modules.push("clientes");
  if (draft.hasAccounting) modules.push("contable");
  const preserved = (previousModules ?? []).filter((id) => !MANAGED_MODULES.includes(id));
  return [...modules, ...preserved.filter((id, index) => preserved.indexOf(id) === index)];
}

export function kitchenOutputModeOf(draft: OperationDraft): KitchenOutputModeConfig {
  if (!draft.hasKitchen) return "none";
  if (draft.kdsEnabled && draft.printerEnabled) return "both";
  if (draft.printerEnabled) return "printer";
  if (draft.kdsEnabled) return "kds";
  return "none";
}

export function draftToOperationConfig(draft: OperationDraft, previous: OperationConfig | null): OperationConfig {
  const normalized = normalizeDraft(draft);
  return {
    serviceMode: normalized.hasTables ? "both" : "counter",
    tablesEnabled: normalized.hasTables,
    waiterModeEnabled: normalized.hasWaiters,
    waiterPhotosEnabled: previous?.waiterPhotosEnabled ?? true,
    kitchenEnabled: normalized.hasKitchen,
    kitchenOutputMode: kitchenOutputModeOf(normalized),
    prepStations: previous?.prepStations ?? [],
    salesChannels: [...normalized.salesChannels],
    inventoryType: normalized.inventoryType,
    productionMode: normalized.productionMode,
    kdsEnabled: normalized.kdsEnabled,
    printerEnabled: normalized.printerEnabled,
  };
}

export type DraftIssueSeverity = "error" | "warning";

export interface DraftIssue {
  readonly code:
    | "INVALID_CHANNEL"
    | "INVALID_INVENTORY_TYPE"
    | "INVALID_PRODUCTION_MODE"
    | "NO_SALES_CHANNELS"
    | "KITCHEN_WITHOUT_OUTPUT"
    | "INVENTORY_INCOMPLETE";
  readonly severity: DraftIssueSeverity;
  readonly message: string;
}

/**
 * Los errores bloquean el guardado (valores que la base de datos no aceptaría).
 * Las advertencias dejan guardar: el onboarding permite "configurar después".
 */
export function validateDraft(draft: OperationDraft): DraftIssue[] {
  const issues: DraftIssue[] = [];

  if (!draft.salesChannels.every(isSalesChannel)) {
    issues.push({ code: "INVALID_CHANNEL", severity: "error", message: "Hay un canal de venta que VIMDY no reconoce." });
  }
  if (draft.inventoryType !== null && !isInventoryType(draft.inventoryType)) {
    issues.push({ code: "INVALID_INVENTORY_TYPE", severity: "error", message: "El tipo de inventario elegido no es válido." });
  }
  if (draft.productionMode !== null && !isProductionMode(draft.productionMode)) {
    issues.push({ code: "INVALID_PRODUCTION_MODE", severity: "error", message: "El modo de producción elegido no es válido." });
  }

  if (draft.salesChannels.length === 0) {
    issues.push({ code: "NO_SALES_CHANNELS", severity: "warning", message: "No marcaste ningún canal de venta." });
  }
  if (draft.hasKitchen && !draft.kdsEnabled && !draft.printerEnabled) {
    issues.push({
      code: "KITCHEN_WITHOUT_OUTPUT",
      severity: "warning",
      message: "Preparas productos pero no elegiste Pantalla ni Impresora: los pedidos no tendrán dónde salir.",
    });
  }
  if (draft.hasInventory && (draft.inventoryType === null || draft.productionMode === null)) {
    issues.push({
      code: "INVENTORY_INCOMPLETE",
      severity: "warning",
      message: "Falta elegir qué manejas en inventario y cómo produces.",
    });
  }
  return issues;
}

export function hasBlockingIssues(issues: readonly DraftIssue[]): boolean {
  return issues.some((issue) => issue.severity === "error");
}