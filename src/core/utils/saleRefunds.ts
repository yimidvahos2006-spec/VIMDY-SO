// src/core/utils/saleRefunds.ts
/* ===========================================================================
   Helper compartido para tratar Sale.refunds de forma consistente.
   ---------------------------------------------------------------------------
   Por qué existe: `sale.total` NUNCA se edita al reembolsar (a propósito —
   SalesEngine.partialRefundSale()/refundSale() solo agregan un registro a
   `sale.refunds`, para conservar intacto el histórico de qué se vendió
   originalmente). Una venta parcialmente reembolsada se queda en el mismo
   `status` (PAID/CLOSED) — no existe un status aparte para "parcial" — así
   que los filtros existentes de Reportes/Ganancias/Pérdidas/Dashboard
   (`status === "PAID" || "CLOSED"`) siguen incluyéndola correctamente. El
   problema es que si esas pantallas suman `sale.total` a secas, sobre-
   cuentan lo que ya se devolvió — exactamente el tipo de "el número no
   cuadra" que el bloqueante #1.11 (Reportes) de la auditoría exige tratar
   como bloqueante, no como detalle.

   Toda pantalla que sume dinero de ventas debe usar getSaleNetTotal() en
   vez de leer `sale.total` directo.
=========================================================================== */

import { Sale, SaleItem } from "../entities/Entities";

/** Status de venta que cuentan como "venta real pagada". */
export const VALID_SALE_STATUSES = new Set(["PAID", "CLOSED"]);

/**
 * Única regla de negocio para decidir si una venta cuenta como ingreso.
 * PAID/CLOSED cuentan; los registros históricos sin status también cuentan.
 * PENDING_PAYMENT, OPEN, CANCELLED, REFUNDED y estados desconocidos no cuentan.
 */
export function isRevenueSaleStatus(status: string | null | undefined): boolean {
  if (status == null || status.trim() === "") return true;
  const normalized = status.trim().toUpperCase();
  return normalized === "PAID" || normalized === "CLOSED";
}

/** Monto total ya reembolsado sobre esta venta (parcial + total acumulado). */
export function getSaleRefundedTotal(sale: Sale): number {
  return (sale.refunds ?? []).reduce((sum, refund) => {
    const amount = Number(refund.amount);
    return sum + (Number.isFinite(amount) ? Math.max(amount, 0) : 0);
  }, 0);
}

/** Total de la venta neto de reembolsos — lo que de verdad sigue siendo ingreso. */
export function getSaleNetTotal(sale: Sale): number {
  const total = Number(sale.total);
  if (!Number.isFinite(total)) return 0;
  return Math.max(total - getSaleRefundedTotal(sale), 0);
}

/**
 * Ítems de la venta netos de lo reembolsado (cantidad reducida por
 * producto, ítems completamente devueltos excluidos). Úsalo en vez de
 * `sale.items` para calcular ganancia/pérdida por línea — de lo contrario
 * un producto ya devuelto sigue sumando ganancia/costo como si se hubiera
 * quedado vendido.
 */
export function getSaleNetItems(sale: Sale): SaleItem[] {
  const refundedByProduct = new Map<string, number>();

  for (const refund of sale.refunds ?? []) {
    for (const item of refund.items ?? []) {
      const quantity = Number(item.quantity);
      if (!item.productId || !Number.isFinite(quantity) || quantity <= 0) continue;
      refundedByProduct.set(
        item.productId,
        (refundedByProduct.get(item.productId) ?? 0) + quantity
      );
    }
  }

  // Distribuir las unidades devueltas entre líneas del mismo producto UNA vez.
  // Restar la cantidad total a cada línea duplica el efecto si el producto
  // aparece varias veces (p. ej. distintas variantes o notas en una misma venta).
  return sale.items.flatMap((item) => {
    const originalQuantity = Number(item.quantity);
    if (!Number.isFinite(originalQuantity) || originalQuantity <= 0) return [];

    const remainingRefunded = refundedByProduct.get(item.productId) ?? 0;
    const refundedFromThisLine = Math.min(originalQuantity, remainingRefunded);
    refundedByProduct.set(item.productId, Math.max(remainingRefunded - refundedFromThisLine, 0));

    const netQuantity = originalQuantity - refundedFromThisLine;
    return netQuantity > 0 ? [{ ...item, quantity: netQuantity }] : [];
  });
}