/**
 * businessOperatingProfile.ts
 * ---------------------------------------------------------------------------
 * Capa pura que traduce la configuración explícita del negocio a capacidades
 * y métricas disponibles para Dashboard, IA, alertas y reportes.
 *
 * PRINCIPIO: businessType es descriptivo; NO habilita por sí solo una
 * capacidad. La autoridad operativa es la configuración persistida:
 * enabledModules + operationConfig.
 */

import type { ModuleId } from "./modules";
import type { BusinessTypeId } from "./businessTypes";
import type { OperationConfig } from "./operation";

export type BusinessCapabilityId =
  | "sales"
  | "orders"
  | "cash"
  | "inventory"
  | "customers"
  | "tables"
  | "waiters"
  | "kitchen"
  | "kds"
  | "kitchenPrinter"
  | "production"
  | "ai";

export type BusinessMetricId =
  | "netSales"
  | "transactionCount"
  | "averageSaleValue"
  | "cash"
  | "inventory"
  | "customers"
  | "tables"
  | "kitchen"
  | "production"
  | "ai";

export interface BusinessCapabilities {
  readonly sales: boolean;
  readonly orders: boolean;
  readonly cash: boolean;
  readonly inventory: boolean;
  readonly customers: boolean;
  readonly tables: boolean;
  readonly waiters: boolean;
  readonly kitchen: boolean;
  readonly kds: boolean;
  readonly kitchenPrinter: boolean;
  readonly production: boolean;
  readonly ai: boolean;
}

export interface BusinessMetricAvailability {
  readonly netSales: boolean;
  readonly transactionCount: boolean;
  readonly averageSaleValue: boolean;
  readonly cash: boolean;
  readonly inventory: boolean;
  readonly customers: boolean;
  readonly tables: boolean;
  readonly kitchen: boolean;
  readonly production: boolean;
  readonly ai: boolean;
}

export interface BusinessOperatingProfileSource {
  readonly businessId: string;
  readonly businessType: BusinessTypeId | null;
  readonly enabledModules: readonly ModuleId[];
  readonly operationConfig: OperationConfig;
}

export interface BusinessOperatingProfile {
  readonly businessId: string;
  readonly businessType: BusinessTypeId | null;
  readonly enabledModules: readonly ModuleId[];
  readonly operationConfig: OperationConfig;
  readonly operationConfigStatus: "loaded";
  readonly capabilities: BusinessCapabilities;
  readonly metrics: BusinessMetricAvailability;
}

function hasModule(modules: readonly ModuleId[], id: ModuleId): boolean {
  return modules.includes(id);
}

export function buildBusinessOperatingProfile(
  source: BusinessOperatingProfileSource
): BusinessOperatingProfile {
  const modules = [...source.enabledModules];
  const baseOperationConfig = cloneOperationConfig(source.operationConfig);

  const tablesExplicit = source.operationConfig.tablesEnabled;
  const tablesEnabled = tablesExplicit !== undefined ? tablesExplicit : hasModule(modules, "mesas");

  const kitchenExplicit = source.operationConfig.kitchenEnabled;
  const kitchenEnabled = kitchenExplicit !== undefined ? kitchenExplicit : hasModule(modules, "cocina");

  const waiterExplicit = source.operationConfig.waiterModeEnabled;
  const waiterModeEnabled = waiterExplicit !== undefined
    ? waiterExplicit
    : false;

  const kitchenOutputMode = source.operationConfig.kitchenOutputMode ?? (
    baseOperationConfig.kdsEnabled && baseOperationConfig.printerEnabled ? "both" :
    baseOperationConfig.printerEnabled ? "printer" :
    baseOperationConfig.kdsEnabled ? "kds" :
    kitchenEnabled ? "kds" : "none"
  );

  const operationConfig: OperationConfig = {
    ...baseOperationConfig,
    serviceMode: baseOperationConfig.serviceMode ?? (tablesEnabled ? "both" : "counter"),
    tablesEnabled,
    waiterModeEnabled,
    kitchenEnabled,
    kitchenOutputMode,
  };

  const capabilities: BusinessCapabilities = {
    sales: hasModule(modules, "caja"),
    orders: hasModule(modules, "pedidos"),
    cash: hasModule(modules, "caja"),
    inventory: hasModule(modules, "inventario"),
    customers: hasModule(modules, "clientes"),
    tables: tablesEnabled && hasModule(modules, "mesas"),
    waiters: waiterModeEnabled,
    kitchen: kitchenEnabled && hasModule(modules, "cocina"),
    kds: kitchenEnabled && (kitchenOutputMode === "kds" || kitchenOutputMode === "both"),
    kitchenPrinter: kitchenEnabled && (kitchenOutputMode === "printer" || kitchenOutputMode === "both"),
    production:
      hasModule(modules, "inventario") && operationConfig.productionMode !== null,
    ai: hasModule(modules, "ia"),
  };

  const metrics: BusinessMetricAvailability = {
    netSales: capabilities.sales,
    transactionCount: capabilities.sales,
    averageSaleValue: capabilities.sales,
    cash: capabilities.cash,
    inventory: capabilities.inventory,
    customers: capabilities.customers,
    tables: capabilities.tables,
    kitchen: capabilities.kitchen,
    production: capabilities.production,
    ai: capabilities.ai,
  };

  return {
    businessId: source.businessId,
    businessType: source.businessType,
    enabledModules: modules,
    operationConfig,
    operationConfigStatus: "loaded",
    capabilities,
    metrics,
  };
}

export function hasBusinessCapability(
  profile: BusinessOperatingProfile,
  capability: BusinessCapabilityId
): boolean {
  return profile.capabilities[capability];
}

export function hasBusinessMetric(
  profile: BusinessOperatingProfile,
  metric: BusinessMetricId
): boolean {
  return profile.metrics[metric];
}

/**
 * canUse — La función central para verificar si el negocio activo
 * tiene habilitada una capacidad operativa específica.
 */
export function canUse(
  capability: BusinessCapabilityId,
  profile?: BusinessOperatingProfile | null
): boolean {
  if (profile) {
    return profile.capabilities[capability] ?? false;
  }
  return false;
}

function cloneOperationConfig(config: OperationConfig): OperationConfig {
  return {
    serviceMode: config.serviceMode,
    tablesEnabled: config.tablesEnabled,
    waiterModeEnabled: config.waiterModeEnabled,
    waiterPhotosEnabled: config.waiterPhotosEnabled,
    kitchenEnabled: config.kitchenEnabled,
    kitchenOutputMode: config.kitchenOutputMode,
    prepStations: config.prepStations ? [...config.prepStations] : [],
    salesChannels: [...config.salesChannels],
    inventoryType: config.inventoryType,
    productionMode: config.productionMode,
    kdsEnabled: config.kdsEnabled,
    printerEnabled: config.printerEnabled,
  };
}
