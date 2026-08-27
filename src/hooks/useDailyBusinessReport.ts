import { useEffect, useState } from "react";

import { container } from "../infrastructure/di/CompositionRoot";
import { businessStore } from "../core/store/businessStore";
import { companyConfigStore } from "../core/store/companyConfigStore";

function startOfDay(date: Date): Date {
  const copy = new Date(date);
  copy.setHours(0, 0, 0, 0);
  return copy;
}

export interface DailyReport {
  date: string;
  businessName: string;
  totalSales: number;
  salesCount: number;
  topProduct: string | null;
  topProductQuantity: number;
  currency: string;
  text: string;
}

export function useDailyBusinessReport() {
  const [report, setReport] = useState<DailyReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const from = startOfDay(new Date());
      const sales = await container.salesEngine.get().getSalesByDate(from, new Date());

      const paidSales = sales.filter(
        (s) => s.status === "PAID" || s.status === "CLOSED" || !s.status
      );

      const totalSales = paidSales.reduce((sum, s) => sum + s.total, 0);
      const salesCount = paidSales.length;

      const productMap = new Map<string, { name: string; quantity: number }>();
      paidSales.forEach((sale) => {
        sale.items.forEach((item) => {
          const name = (item as any).productName ?? item.productId;
          const current = productMap.get(item.productId) ?? { name, quantity: 0 };
          current.quantity += item.quantity;
          productMap.set(item.productId, current);
        });
      });

      let topProduct: string | null = null;
      let topProductQuantity = 0;
      productMap.forEach((value) => {
        if (value.quantity > topProductQuantity) {
          topProductQuantity = value.quantity;
          topProduct = value.name;
        }
      });

      const business = businessStore.get();
      const config = companyConfigStore.get();
      const now = new Date();
      const dateLabel = now.toLocaleDateString("es-CO", {
        weekday: "long",
        day: "numeric",
        month: "long"
      });

      const text = [
        `📊 Reporte diario - ${business.name || "VIMDY"}`,
        `📅 ${dateLabel}`,
        ``,
        `💰 Ventas del día: ${Math.round(totalSales).toLocaleString("es-CO")} ${config.currency}`,
        `🧾 Órdenes cobradas: ${salesCount}`,
        ...(topProduct ? [`🏆 Producto más vendido: ${topProduct} (${topProductQuantity} uds)`] : []),
        ``,
        `📱 Enviado desde VIMDY`
      ].join("\n");

      setReport({
        date: dateLabel,
        businessName: business.name || "VIMDY",
        totalSales,
        salesCount,
        topProduct,
        topProductQuantity,
        currency: config.currency,
        text
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo generar el reporte.");
    } finally {
      setLoading(false);
    }
  }

  return { report, loading, error, load };
}
