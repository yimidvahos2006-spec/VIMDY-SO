/**
 * DashboardAdaptiveTypes.ts
 * ---------------------------------------------------------------------------
 * Contratos puros para decidir qué partes del Dashboard aplican al negocio.
 * Este archivo NO consulta Supabase y NO calcula importes.
 */

import type {
  BusinessCapabilityId,
  BusinessMetricId,
  BusinessOperatingProfile,
} from "../../config/businessOperatingProfile";

export type DashboardAdaptiveStatus = "idle" | "loading" | "ready" | "error";

export type DashboardSectionId =
  | "overview"
  | "sales"
  | "cash"
  | "inventory"
  | "customers"
  | "tables"
  | "kitchen"
  | "production"
  | "intelligence"
  | "recentActivity"
  | "quickActions"
  | "dailyReport";

export type DashboardActionId =
  | "newSale"
  | "newCustomer"
  | "newProduct"
  | "newOrder";

export interface DashboardAdaptiveContext {
  readonly status: DashboardAdaptiveStatus;
  readonly businessId: string | null;
  readonly profile: BusinessOperatingProfile | null;
}

export interface DashboardAdaptiveModel {
  readonly status: DashboardAdaptiveStatus;
  readonly businessId: string | null;
  readonly isReady: boolean;
  readonly capabilities: Readonly<Record<BusinessCapabilityId, boolean>>;
  readonly metrics: Readonly<Record<BusinessMetricId, boolean>>;
  readonly sections: Readonly<Record<DashboardSectionId, boolean>>;
  readonly actions: Readonly<Record<DashboardActionId, boolean>>;
}
