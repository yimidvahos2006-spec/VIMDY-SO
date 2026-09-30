/**
 * DashboardAdaptiveModel.ts
 * ---------------------------------------------------------------------------
 * Construye la vista operativa del Dashboard a partir del perfil operativo
 * REAL del negocio.
 *
 * PRINCIPIOS:
 * - No consulta datos.
 * - No inventa capacidades por businessType.
 * - No transforma null en 0.
 * - No decide valores financieros.
 * - Solo determina qué partes del Dashboard aplican.
 */

import type {
  BusinessCapabilityId,
  BusinessMetricId,
  BusinessOperatingProfile,
} from "../../config/businessOperatingProfile";
import type {
  DashboardAdaptiveContext,
  DashboardAdaptiveModel,
  DashboardActionId,
  DashboardSectionId,
} from "./DashboardAdaptiveTypes";

const CAPABILITIES: readonly BusinessCapabilityId[] = [
  "sales",
  "orders",
  "cash",
  "inventory",
  "customers",
  "tables",
  "kitchen",
  "production",
  "ai",
];

const METRICS: readonly BusinessMetricId[] = [
  "netSales",
  "transactionCount",
  "averageSaleValue",
  "cash",
  "inventory",
  "customers",
  "tables",
  "kitchen",
  "production",
  "ai",
];

const SECTIONS: readonly DashboardSectionId[] = [
  "overview",
  "sales",
  "cash",
  "inventory",
  "customers",
  "tables",
  "kitchen",
  "production",
  "intelligence",
  "recentActivity",
  "quickActions",
  "dailyReport",
];

const ACTIONS: readonly DashboardActionId[] = [
  "newSale",
  "newCustomer",
  "newProduct",
  "newOrder",
];

function emptyRecord<T extends string>(keys: readonly T[]): Record<T, boolean> {
  return keys.reduce<Record<T, boolean>>((result, key) => {
    result[key] = false;
    return result;
  }, {} as Record<T, boolean>);
}

function mapProfile(profile: BusinessOperatingProfile): DashboardAdaptiveModel {
  const capabilities = emptyRecord(CAPABILITIES);
  const metrics = emptyRecord(METRICS);
  const sections = emptyRecord(SECTIONS);
  const actions = emptyRecord(ACTIONS);

  for (const capability of CAPABILITIES) {
    capabilities[capability] = profile.capabilities[capability];
  }

  for (const metric of METRICS) {
    metrics[metric] = profile.metrics[metric];
  }

  /*
   * overview y recentActivity son contenedores generales del Dashboard.
   * No dependen de una capacidad concreta, pero no se consideran visibles
   * hasta que el perfil operativo esté listo.
   */
  sections.overview = true;
  sections.recentActivity = true;

  sections.sales = profile.capabilities.sales;
  sections.cash = profile.capabilities.cash;
  sections.inventory = profile.capabilities.inventory;
  sections.customers = profile.capabilities.customers;
  sections.tables = profile.capabilities.tables;
  sections.kitchen = profile.capabilities.kitchen;
  sections.production = profile.capabilities.production;
  sections.intelligence = profile.capabilities.ai;
  sections.quickActions =
    profile.capabilities.sales ||
    profile.capabilities.customers ||
    profile.capabilities.inventory ||
    profile.capabilities.orders;
  sections.dailyReport = profile.capabilities.sales || profile.capabilities.cash;

  actions.newSale = profile.capabilities.sales;
  actions.newCustomer = profile.capabilities.customers;
  actions.newProduct = profile.capabilities.inventory;
  actions.newOrder = profile.capabilities.orders;

  return {
    status: "ready",
    businessId: profile.businessId,
    isReady: true,
    capabilities,
    metrics,
    sections,
    actions,
  };
}

export function buildDashboardAdaptiveModel(
  context: DashboardAdaptiveContext,
): DashboardAdaptiveModel {
  if (context.status !== "ready" || !context.profile) {
    return {
      status: context.status,
      businessId: context.businessId,
      isReady: false,
      capabilities: emptyRecord(CAPABILITIES),
      metrics: emptyRecord(METRICS),
      sections: emptyRecord(SECTIONS),
      actions: emptyRecord(ACTIONS),
    };
  }

  return mapProfile(context.profile);
}

export function dashboardSectionIsVisible(
  model: DashboardAdaptiveModel,
  section: DashboardSectionId,
): boolean {
  return model.isReady && model.sections[section];
}

export function dashboardActionIsAvailable(
  model: DashboardAdaptiveModel,
  action: DashboardActionId,
): boolean {
  return model.isReady && model.actions[action];
}

export function dashboardMetricIsAvailable(
  model: DashboardAdaptiveModel,
  metric: BusinessMetricId,
): boolean {
  return model.isReady && model.metrics[metric];
}
