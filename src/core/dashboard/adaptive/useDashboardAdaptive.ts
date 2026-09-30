/**
 * useDashboardAdaptive.ts
 * ---------------------------------------------------------------------------
 * Hook de consumo del modelo adaptativo del Dashboard.
 * La configuración viene del BusinessOperatingProfile ya hidratado por sesión.
 * No hace consultas adicionales.
 */

import { useMemo } from "react";

import { useBusinessOperatingProfile } from "../../store/useBusinessOperatingProfile";
import { buildDashboardAdaptiveModel } from "./DashboardAdaptiveModel";

export function useDashboardAdaptive() {
  const profileSnapshot = useBusinessOperatingProfile();

  const model = useMemo(
    () =>
      buildDashboardAdaptiveModel({
        status: profileSnapshot.status,
        businessId: profileSnapshot.businessId,
        profile: profileSnapshot.profile,
      }),
    [
      profileSnapshot.status,
      profileSnapshot.businessId,
      profileSnapshot.profile,
    ],
  );

  return model;
}
