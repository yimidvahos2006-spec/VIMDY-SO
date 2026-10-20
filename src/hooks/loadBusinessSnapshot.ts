import { container } from "../infrastructure/di/CompositionRoot";
import { businessStore } from "../core/store/businessStore";
import { companyConfigStore } from "../core/store/companyConfigStore";
import { createSingleFlight } from "../core/utils/singleFlight";
import type { BusinessSnapshot } from "../core/types/CopilotTypes";

/**
 * Único punto para calcular el snapshot del negocio desde la interfaz.
 * Dashboard (useBusinessSnapshot) y alertas automáticas (useAutoAlerts) lo
 * comparten: nunca corren dos cálculos completos al mismo tiempo.
 */
export const loadBusinessSnapshot: () => Promise<BusinessSnapshot> = createSingleFlight(() =>
  container.businessAnalyzer
    .get()
    .buildSnapshot(
      businessStore.get().name || "Mi negocio",
      companyConfigStore.get().currency,
    ),
);