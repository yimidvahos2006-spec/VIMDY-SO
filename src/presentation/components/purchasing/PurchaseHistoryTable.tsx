import React from "react";
import { History } from "lucide-react";

import { EmptyState } from "../ui/EmptyState";
import { PurchaseOrder, Supplier, Product } from "../../../core/entities/Entities";

interface PurchaseHistoryTableProps {
  history: PurchaseOrder[];
  suppliers: Supplier[];
  products: Product[];
}

const STATUS_LABEL: Record<string, string> = {
  COMPRADO: "✅ Comprado",
  CANCELADO: "❌ Cancelado"
};

const STATUS_CLASS: Record<string, string> = {
  COMPRADO: "border-vimdy-success/30 bg-vimdy-success/10 text-vimdy-success",
  CANCELADO: "border-vimdy-border bg-vimdy-surface text-vimdy-text-secondary"
};

function formatDate(date?: Date): string {
  if (!date) return "—";
  return new Date(date).toLocaleDateString("es-CO", { day: "2-digit", month: "short", year: "numeric" });
}

function orderCost(order: PurchaseOrder): number {
  return order.items.reduce((sum, item) => sum + item.quantity * item.unitPrice, 0);
}

/**
 * PurchaseHistoryTable — PASO 2.7 (Compras Inteligentes, ejecución).
 * ---------------------------------------------------------------------------
 * "Nunca perder el historial": lista todas las órdenes COMPRADO/CANCELADO,
 * una fila por producto para que fecha/cantidad/costo/proveedor/usuario/
 * estado queden claros de un vistazo, sin sacar cuentas aparte.
 */
export function PurchaseHistoryTable({ history, suppliers, products }: PurchaseHistoryTableProps) {
  const supplierById = new Map(suppliers.map((s) => [s.id, s]));
  const productById = new Map(products.map((p) => [p.id, p]));

  if (history.length === 0) {
    return (
      <EmptyState
        icon={<History size={28} />}
        title="Todavía no hay historial de compras."
        description="Cuando marques una orden como comprada o la canceles, va a quedar registrada aquí para siempre."
      />
    );
  }

  const rows = history.flatMap((order) =>
    order.items.map((item) => ({
      key: `${order.id}-${item.productId}`,
      date: order.status === "COMPRADO" ? order.receivedAt : order.createdAt,
      productName: productById.get(item.productId)?.name ?? "Producto",
      quantity: item.quantity,
      unit: productById.get(item.productId)?.unit ?? "",
      cost: item.quantity * item.unitPrice,
      supplierName: supplierById.get(order.supplierId)?.name ?? "—",
      user: order.createdBy ?? "—",
      status: order.status
    }))
  );

  return (
    <div className="rounded-vimdy-lg border border-vimdy-border bg-vimdy-surface overflow-hidden">
      <div className="overflow-x-auto p-5">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-vimdy-text-tertiary text-xs uppercase tracking-wide">
              <th className="pb-3 pr-4">Fecha</th>
              <th className="pb-3 pr-4">Producto</th>
              <th className="pb-3 pr-4">Cantidad</th>
              <th className="pb-3 pr-4">Costo</th>
              <th className="pb-3 pr-4">Proveedor</th>
              <th className="pb-3 pr-4">Usuario</th>
              <th className="pb-3">Estado</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.key} className="border-t border-vimdy-border">
                <td className="py-3 pr-4 text-vimdy-text-secondary">{formatDate(row.date)}</td>
                <td className="py-3 pr-4 text-vimdy-text font-medium">{row.productName}</td>
                <td className="py-3 pr-4 text-vimdy-text">
                  {row.quantity} {row.unit}
                </td>
                <td className="py-3 pr-4 text-vimdy-text">${row.cost.toLocaleString("es-CO")}</td>
                <td className="py-3 pr-4 text-vimdy-text-secondary">{row.supplierName}</td>
                <td className="py-3 pr-4 text-vimdy-text-secondary">{row.user}</td>
                <td className="py-3">
                  <span className={`text-xs px-2 py-1 rounded-vimdy-sm border ${STATUS_CLASS[row.status]}`}>
                    {STATUS_LABEL[row.status]}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}