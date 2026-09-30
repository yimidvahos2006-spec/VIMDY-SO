import { useCallback, useEffect, useState } from "react";

import { container, productsReady } from "../infrastructure/di/CompositionRoot";
import { ForecastSummary } from "../core/engines/ForecastEngine";
import { useVimdyEvent } from "./useVimdyCore";

/**
 * useForecast — VIMDY FASE 5, PASO 2.8 (Pronóstico Inteligente)
 * ---------------------------------------------------------------------------
 * Capa de React sobre ForecastEngine, siguiendo el mismo patrón que
 * useSmartPurchasing (PASO 2.6): carga, se refresca sola ante nuevas ventas
 * o cambios de inventario, y no calcula nada por su cuenta.
 */
export function useForecast() {
  const [summary, setSummary] = useState<ForecastSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    await productsReady;
    const result = await container.forecastEngine.get().getSummary();
    setSummary(result);
  }, []);

  useEffect(() => {
    setLoading(true);
    setError(null);
    load()
      .catch((e: any) => setError(e?.message ?? "No se pudo calcular el pronóstico."))
      .finally(() => setLoading(false));
  }, [load]);

  useVimdyEvent("sale", () => {
    load().catch((e: any) => setError(e?.message ?? "No se pudo calcular el pronóstico."));
  });
  useVimdyEvent("inventory", () => {
    load().catch((e: any) => setError(e?.message ?? "No se pudo calcular el pronóstico."));
  });

  return { summary, loading, error, refresh: load };
}