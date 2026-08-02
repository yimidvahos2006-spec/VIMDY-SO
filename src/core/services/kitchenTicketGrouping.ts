import { KitchenOrderItemView } from "./kitchenOrderEnrichment";

/**
 * Estación que se usa para cualquier item SIN estación configurada (el
 * negocio no le puso `printStation` a la categoría ni `printStationOverride`
 * al producto). Así nunca se pierde un item por falta de configuración: si
 * el negocio no configura nada, todo cae en un único ticket "Cocina", que
 * es el comportamiento de siempre.
 */
export const DEFAULT_PRINT_STATION = "Cocina";

/**
 * Agrupa los items de una comanda por estación de impresión real —
 * "Bebidas → Barra, Pizzas → Cocina, Postres → Pastelería" — sin que nadie
 * tenga que separarlos a mano. El orden de las estaciones en el resultado
 * sigue el orden en que aparece cada una por primera vez en la comanda
 * (no alfabético), para que la estación "principal" del pedido salga primero.
 */
export function groupOrderItemsByStation(
  items: readonly KitchenOrderItemView[]
): Map<string, KitchenOrderItemView[]> {
  const grouped = new Map<string, KitchenOrderItemView[]>();

  for (const item of items) {
    const station = item.station?.trim() || DEFAULT_PRINT_STATION;
    const bucket = grouped.get(station);

    if (bucket) {
      bucket.push(item);
    } else {
      grouped.set(station, [item]);
    }
  }

  return grouped;
}