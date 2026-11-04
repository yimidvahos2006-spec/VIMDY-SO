/**
 * columnFit.ts
 * ---------------------------------------------------------------------------
 * Decide cuántas tarjetas caben completas en una columna de alto fijo
 * (Modo TV). Es una función pura para poder probarla sin pantalla.
 *
 * Reglas:
 *  - Una tarjeta solo se muestra si cabe ENTERA (nunca se ve cortada a la
 *    mitad). Desde la primera que no cabe, todas las siguientes se ocultan.
 *  - La primera tarjeta SIEMPRE se muestra, aunque ella sola sea más alta
 *    que la columna (nunca puede quedar una columna con pedidos y vacía).
 *    En ese caso `firstTooTall` es true para avisar y permitir deslizar.
 *  - Si todavía no hay medida (alto 0), se muestra todo para no parpadear.
 */

export interface MeasuredItem {
  /** Distancia desde el borde superior de la lista. */
  top: number;
  height: number;
}

export interface ColumnFit {
  /** Índice de la primera tarjeta oculta (== items.length si caben todas). */
  hiddenFrom: number;
  firstTooTall: boolean;
}

const TOLERANCE_PX = 1;

export function computeColumnFit(items: MeasuredItem[], limit: number): ColumnFit {
  if (items.length === 0 || !(limit > 0)) {
    return { hiddenFrom: items.length, firstTooTall: false };
  }

  const firstTooTall = items[0].height > limit + TOLERANCE_PX;

  let hiddenFrom = items.length;
  for (let index = 0; index < items.length; index += 1) {
    if (items[index].top + items[index].height > limit + TOLERANCE_PX) {
      hiddenFrom = index;
      break;
    }
  }

  if (firstTooTall) hiddenFrom = Math.max(hiddenFrom, 1);

  return { hiddenFrom, firstTooTall };
}