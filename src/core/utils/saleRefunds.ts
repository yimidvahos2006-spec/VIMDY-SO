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

/** Monto total ya reembolsado sobre esta venta (parcial + total acumulado). */
export function getSaleRefundedTotal(sale: Sale): number {
  return (sale.refunds ?? []).reduce((sum, refund) => sum + refund.amount, 0);
}

/** Total de la venta neto de reembolsos — lo que de verdad sigue siendo ingreso. */
export function getSaleNetTotal(sale: Sale): number {
  return Math.max(sale.total - getSaleRefundedTotal(sale), 0);
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
    for (const item of refund.items) {
      refundedByProduct.set(
        item.productId,
        (refundedByProduct.get(item.productId) ?? 0) + item.quantity
      );
    }
  }

  return sale.items
    .map((item) => ({
      ...item,
      quantity: item.quantity - (refundedByProduct.get(item.productId) ?? 0)
    }))
    .filter((item) => item.quantity > 0);
}