/**
 * businessOperatingProfileBootstrap.ts
 * ---------------------------------------------------------------------------
 * Hidrata el perfil operativo REAL del negocio activo después de resolver
 * la sesión de Supabase.
 *
 * Principios:
 * - Supabase es la fuente de verdad.
 * - No deriva capacidades desde business_type.
 * - No persiste nada en localStorage/IndexedDB.
 * - Protege contra respuestas tardías de un negocio anterior.
 */

import { getCurrentBusinessId } from "../../infrastructure/supabase/supabaseClient";
import { loadBusinessOperatingProfile } from "../../infrastructure/supabase/businessOperatingProfileRepository";
import { businessOperatingProfileStore } from "../store/businessOperatingProfileStore";
import { operationConfigStore } from "../store/operationConfigStore";
import { enabledModulesStore } from "../store/enabledModulesStore";
import { kitchenOutputModeStore } from "../store/kitchenOutputModeStore";
import { toKitchenOutputMode } from "../services/effectiveKitchenOutputMode";
import type { ModuleId } from "../config/modules";

export async function hydrateBusinessOperatingProfile(businessId: string): Promise<void> {
  const normalizedBusinessId = businessId.trim();
  if (!normalizedBusinessId) {
    businessOperatingProfileStore.clear();
    operationConfigStore.clear();
    enabledModulesStore.clear();
    kitchenOutputModeStore.clear();
    return;
  }

  businessOperatingProfileStore.loading(normalizedBusinessId);
  // Nunca arrastamos la salida de cocina del negocio anterior mientras se
  // resuelve el perfil nuevo.
  kitchenOutputModeStore.clear();

  try {
    const profile = await loadBusinessOperatingProfile(normalizedBusinessId);

    // Si durante la consulta se cambió de negocio, no permitimos que una
    // respuesta tardía contamine el store del negocio actual.
    if (getCurrentBusinessId() !== normalizedBusinessId) {
      return;
    }

    operationConfigStore.set(profile.operationConfig);
    enabledModulesStore.set([...profile.enabledModules] as ModuleId[]);

    const outputMode = profile.operationConfig.kitchenOutputMode ?? (
      profile.operationConfig.kdsEnabled && profile.operationConfig.printerEnabled ? "both" :
      profile.operationConfig.printerEnabled ? "printer" :
      profile.operationConfig.kdsEnabled ? "kds" :
      "none"
    );
    kitchenOutputModeStore.set(toKitchenOutputMode(outputMode));

    businessOperatingProfileStore.ready(profile);
  } catch (error: unknown) {
    if (getCurrentBusinessId() !== normalizedBusinessId) {
      return;
    }

    const message = error instanceof Error
      ? error.message
      : "No se pudo cargar la configuración operativa.";

    operationConfigStore.clear();
    kitchenOutputModeStore.clear();
    businessOperatingProfileStore.fail(normalizedBusinessId, message);
  }
}