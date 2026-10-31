import type { PurchaseRecommendation } from "../../ia/InventoryAI";
import { countItemTypes, describeItemCounts } from "../../utils/stockItemWording";

/**
 * Consolidación de alertas de stock
 * ---------------------------------------------------------------------------
 * Antes, cada producto con stock crítico generaba SU PROPIA notificación
 * ("IA recomienda comprar"), así que un negocio con decenas de productos
 * bajos veía la bandeja llena de avisos repetitivos. Y las alertas de stock
 * del analizador llevaban el conteo dentro del mensaje ("Tienes 3
 * producto(s)…"), por lo que cada vez que el conteo cambiaba nacía una
 * notificación nueva.
 *
 * Ahora cada tipo de alerta de stock tiene UNA clave estable y UNA sola
 * notificación que se actualiza cuando cambia el contenido. Todo este módulo
 * es puro (sin React, sin Supabase) para poder probarlo de forma aislada.
 */

/** Clave de la única notificación "IA recomienda comprar" del negocio. */
export const PURCHASE_SUMMARY_KEY = "IA_COMPRA:RESUMEN";

/** Clave estable de la alerta consolidada de productos agotados. */
export const STOCK_OUT_ALERT_KEY = "STOCK_BAJO:AGOTADOS";

/** Clave estable de la alerta consolidada de productos con stock bajo. */
export const STOCK_LOW_ALERT_KEY = "STOCK_BAJO:BAJO";

/** Cuántos nombres de producto se muestran antes de resumir con "y N más". */
const MAX_VISIBLE_NAMES = 3;

export interface PurchaseSummary {
  readonly key: string;
  readonly message: string;
}

/**
 * Devuelve la clave estable de una alerta de stock del analizador, o `null`
 * si el mensaje no es una de las dos alertas de stock conocidas.
 */
export function stableStockAlertKey(message: string): string | null {
  const text = message.toLowerCase();
  if (text.includes("agotad")) return STOCK_OUT_ALERT_KEY;
  if (text.includes("stock bajo")) return STOCK_LOW_ALERT_KEY;
  return null;
}

function joinNames(names: readonly string[], total: number): string {
  const quoted = names.map((name) => `"${name}"`);
  if (total > names.length) {
    return `${quoted.join(", ")} y ${total - names.length} más`;
  }
  if (quoted.length <= 1) return quoted.join("");
  return `${quoted.slice(0, -1).join(", ")} y ${quoted[quoted.length - 1]}`;
}

/**
 * Convierte las recomendaciones de compra en UNA sola notificación.
 *
 * Solo cuentan las urgentes (CRITICAL / HIGH). Devuelve `null` cuando no hay
 * nada que reponer, para que no se lance ninguna sugerencia vacía. El texto
 * nunca lleva cifras de stock ni cantidades: solo el estado, lo que además
 * es seguro durante un conteo a ciegas.
 */
export function buildPurchaseSummary(
  recommendations: readonly PurchaseRecommendation[]
): PurchaseSummary | null {
  const urgent = recommendations.filter(
    (rec) => rec.priority === "CRITICAL" || rec.priority === "HIGH"
  );
  if (urgent.length === 0) return null;

  const outCount = urgent.filter((rec) => rec.priority === "CRITICAL").length;
  const lowCount = urgent.length - outCount;

  if (urgent.length === 1) {
    const [only] = urgent;
    const status = only.priority === "CRITICAL" ? "🔴 Agotado" : "🟡 Stock bajo";
    // Un insumo se nombra como tal; un producto conserva el texto de siempre.
    const subject = only.isIngredient === true ? "del insumo" : "de";
    return {
      key: PURCHASE_SUMMARY_KEY,
      message: `Reponer stock ${subject} "${only.productName}" (${status}).`
    };
  }

  const visible = urgent.slice(0, MAX_VISIBLE_NAMES).map((rec) => rec.productName);
  const parts: string[] = [];
  if (outCount > 0) parts.push(`🔴 ${outCount} ${outCount === 1 ? "agotado" : "agotados"}`);
  if (lowCount > 0) parts.push(`🟡 ${lowCount} con stock bajo`);

  return {
    key: PURCHASE_SUMMARY_KEY,
    message:
      `Reponer stock de ${describeItemCounts(countItemTypes(urgent.map((rec) => ({ isIngredient: rec.isIngredient }))), "plain")}: ` +
      `${joinNames(visible, urgent.length)} ` +
      `(${parts.join(", ")}).`
  };
}