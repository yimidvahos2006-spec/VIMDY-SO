import React, { useEffect, useState } from "react";

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
  const timeoutRef = React.useRef<number | null>(null);
  const requestIdRef = React.useRef(0);
  const appliedIdRef = React.useRef(0);
  const mountedRef = React.useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (timeoutRef.current) {
      window.clearTimeout(timeoutRef.current);
    }

    timeoutRef.current = window.setTimeout(async () => {
      const requestId = ++requestIdRef.current;
      const business = businessStore.get();
      const config = companyConfigStore.get();
      try {
        const next = await container.businessAnalyzer.get().buildSnapshot(
          business.name || "Mi negocio",
          config.currency
        );
        // Un resultado más viejo nunca pisa a uno más nuevo, pero tampoco se
        // descarta mientras no haya otro: antes, cada cambio del dashboard
        // durante la carga cancelaba el cálculo y la pantalla esperaba de más.
        if (mountedRef.current && requestId > appliedIdRef.current) {
          appliedIdRef.current = requestId;
          setSnapshot(next);
        }
      } catch (error) {
        console.error("[useBusinessSnapshot] No se pudo calcular el snapshot:", error);
      }
    }, 150);

    return () => {
      if (timeoutRef.current) {
        window.clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dashboard]);

  const hasEnoughData = !!snapshot && (snapshot.totalSalesAllTime > 0 || snapshot.topProducts.length > 0);

  return { snapshot, hasEnoughData };
}