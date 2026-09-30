import { useSyncExternalStore } from "react";
import { dashboardStore } from "./dashboardStore";

/**
 * Antes: sondeaba dashboardStore cada 200ms con setInterval, repintando
 * las tarjetas del Dashboard ~5 veces por segundo sin parar.
 * Ahora: se suscribe y solo re-renderiza cuando los datos cambian de verdad
 * (una venta, un nuevo cliente, un ajuste de inventario, etc.).
 */
export function useDashboard() {
  return useSyncExternalStore(dashboardStore.subscribe, dashboardStore.getSnapshot);
}