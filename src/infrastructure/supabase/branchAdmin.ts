/**
 * branchAdmin.ts
 * ---------------------------------------------------------------------------
 * Operaciones de sucursales que necesitan algo más que un INSERT/UPDATE simple:
 *  - leer el plan contratado (1 sede o Multi-Sucursal);
 *  - cambiar la sucursal principal de forma atómica (RPC `set_main_branch`).
 */

import { supabase } from "./supabaseClient";
import { DEFAULT_BUSINESS_TIER, isBusinessTier, type BusinessTier } from "../../core/entities/SubscriptionTypes";

/**
 * Plan contratado por el negocio (`businesses.plan_tier`).
 *
 * Si no se puede leer (columna aún no migrada, sin permiso, sin red) o trae un
 * valor desconocido se devuelve el plan de 1 sede: ante la duda NO se abre la
 * creación de sedes.
 */
export async function loadBusinessPlanTier(businessId: string): Promise<BusinessTier> {
  const id = businessId.trim();
  if (!id) return DEFAULT_BUSINESS_TIER;

  try {
    const { data, error } = await supabase.from("businesses").select("plan_tier").eq("id", id).maybeSingle();
    if (error || !data) return DEFAULT_BUSINESS_TIER;
    const tier = (data as { plan_tier?: unknown }).plan_tier;
    return isBusinessTier(tier) ? tier : DEFAULT_BUSINESS_TIER;
  } catch {
    return DEFAULT_BUSINESS_TIER;
  }
}

/** Marca una sucursal como principal y desmarca la anterior en una sola transacción. */
export async function setMainBranch(branchId: string): Promise<void> {
  const { error } = await supabase.rpc("set_main_branch", { p_branch_id: branchId });
  if (error) {
    const message = error.message ?? "";
    if (/BRANCH_INACTIVE/.test(message)) {
      throw new Error("Reactiva la sucursal antes de marcarla como principal.");
    }
    if (/BRANCH_NOT_FOUND|BRANCH_FORBIDDEN/.test(message)) {
      throw new Error("No tienes permiso para cambiar la sucursal principal.");
    }
    throw new Error(message || "No se pudo marcar la sucursal como principal.");
  }
}