import { useCallback, useEffect, useState } from "react";
import { container, productsReady } from "../../infrastructure/di/CompositionRoot";
import { PurchaseRecommendation, PurchaseUrgency } from "../engines/PurchaseIntelligenceEngine";
import { useVimdyEvent } from "../../hooks/useVimdyCore";

/**
 * useSmartPurchasing — VIMDY FASE 5, PASO 2.6 (Compras Inteligentes)
 * ---------------------------------------------------------------------------
 * Capa de React sobre PurchaseIntelligenceEngine, siguiendo el mismo patrón
 * que useProfitCenter/useReports: carga, se refresca sola ante eventos
 * relevantes (nueva venta, cambio de inventario/receta/precio de compra) y
 * expone conteos ya derivados para las tarjetas de resumen. No calcula nada
 * por su cuenta — todo el análisis vive en el engine, esto solo lo conecta
 * a la pantalla.
 */
export function useSmartPurchasing() {
  const [recommendations, setRecommendations] = useState<PurchaseRecommendation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    await productsReady;
    const result = await container.purchaseIntelligenceEngine.getRecommendations();
    setRecommendations(result);
  }, []);

  useEffect(() => {
    setLoading(true);
    setError(null);
    load()
      .catch((e: any) => setError(e?.message ?? "No se pudieron calcular las recomendaciones de compra."))
      .finally(() => setLoading(false));
  }, [load]);

  // Se refresca sola, sin recargar la página: una venta cambia cuánto se
  // consumió (directo o vía receta) y el evento "inventory" cubre compras
  // registradas, ajustes de stock y cambios de receta/precio de compra.
  useVimdyEvent("sale", () => {
    load().catch((e: any) => setError(e?.message ?? "No se pudieron calcular las recomendaciones de compra."));
  });
  useVimdyEvent("inventory", () => {
    load().catch((e: any) => setError(e?.message ?? "No se pudieron calcular las recomendaciones de compra."));
  });

  const urgencyCounts: Record<PurchaseUrgency, number> = {
    ALTA: recommendations.filter((r) => r.urgency === "ALTA").length,
    MEDIA: recommendations.filter((r) => r.urgency === "MEDIA").length,
    BAJA: recommendations.filter((r) => r.urgency === "BAJA").length
  };

  return {
    recommendations,
    loading,
    error,
    urgencyCounts,
    hasRecommendations: recommendations.length > 0,
    refresh: load
  };
}