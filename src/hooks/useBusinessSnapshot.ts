import { useEffect, useState } from "react";

import { container } from "../infrastructure/di/CompositionRoot";
import { useDashboard } from "../core/store/useDashboard";
import { businessStore } from "../core/store/businessStore";
import { companyConfigStore } from "../core/store/companyConfigStore";
import type { BusinessSnapshot } from "../core/types/CopilotTypes";

/**
 * useBusinessSnapshot
 * ---------------------------------------------------------------------------
 * Único punto donde el Dashboard pide el snapshot real del negocio
 * (BusinessAnalyzer.buildSnapshot). Antes GerenteInteligente lo calculaba
 * por su cuenta y cualquier otro bloque que necesitara "ganancia de hoy"
 * o "salud del negocio" tenía que copiar la misma lógica — ahora todos
 * los bloques del Dashboard (Bienvenida, Indicadores, Gerente Inteligente)
 * comparten esta misma llamada, así que nunca pueden mostrar dos números
 * distintos para el mismo dato.
 *
 * Se recalcula solo: depende del snapshot completo de dashboardStore
 * (useDashboard), que ya se actualiza en tiempo real con cada venta,
 * cambio de inventario, compra o movimiento de caja.
 */
export function useBusinessSnapshot() {
  const dashboard = useDashboard();
  const [snapshot, setSnapshot] = useState<BusinessSnapshot | null>(null);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      const business = businessStore.get();
      const config = companyConfigStore.get();
      const next = await container.businessAnalyzer.buildSnapshot(
        business.name || "Mi negocio",
        config.currency
      );
      if (!cancelled) setSnapshot(next);
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dashboard]);

  const hasEnoughData = !!snapshot && (snapshot.totalSalesAllTime > 0 || snapshot.topProducts.length > 0);

  return { snapshot, hasEnoughData };
}