import { useEffect, useMemo, useState, useSyncExternalStore } from "react";

import { businessStore } from "../core/store/businessStore";
import { companyConfigStore } from "../core/store/companyConfigStore";
import { useDashboard } from "../core/store/useDashboard";
import { useBusinessOperatingProfile } from "../core/store/useBusinessOperatingProfile";
import { useBusinessSnapshot } from "./useBusinessSnapshot";
import { buildDashboardExecutiveModel } from "../core/dashboard/executive/DashboardExecutiveModel";
import type { DashboardExecutiveModel } from "../core/dashboard/executive/DashboardExecutiveTypes";

export function useDashboardExecutive(): DashboardExecutiveModel {
  const dashboard = useDashboard();
  const operatingProfile = useBusinessOperatingProfile();
  const { snapshot } = useBusinessSnapshot();
  const currency = useSyncExternalStore(
    companyConfigStore.subscribe,
    () => companyConfigStore.get().currency,
    () => companyConfigStore.get().currency,
  );
  const timezone = useSyncExternalStore(
    companyConfigStore.subscribe,
    () => companyConfigStore.get().timezone,
    () => companyConfigStore.get().timezone,
  );
  // El nombre ya está en businessStore cuando entra a la app (AuthContext lo
  // hidrata antes de mostrar el Dashboard): no hay que esperar al snapshot.
  const businessName = businessStore.get().name;
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  return useMemo(
    () =>
      buildDashboardExecutiveModel({
        dashboard,
        snapshot,
        profile: operatingProfile.profile,
        profileStatus: operatingProfile.status,
        timezone,
        currency,
        now,
        businessName,
      }),
    [dashboard, snapshot, operatingProfile, timezone, currency, now, businessName],
  );
}