import { useRef, useState } from "react";

import { container, productsReady } from "../infrastructure/di/CompositionRoot";
import { businessStore } from "../core/store/businessStore";
import { companyConfigStore } from "../core/store/companyConfigStore";
import { startOfBusinessDay, startOfNextBusinessDay } from "../core/utils/businessTime";

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

  const loadController = useRef<{ cancelled: boolean; runId: number }>({ cancelled: false, runId: 0 });

  async function load() {
    const runId = ++loadController.current.runId;
    const current = loadController.current;
    setLoading(true);
    setError(null);
    try {
      await productsReady;
      if (current.runId !== runId) return;

      const tz = companyConfigStore.get().timezone || "America/Bogota";
      const now = new Date();
      const from = startOfBusinessDay(now, tz);
      const to = startOfNextBusinessDay(now, tz);
      const sales = await container.salesEngine.get().getSalesByDate(from, to);
      if (current.runId !== runId) return;

      const paidSales = sales.filter(
        (s) => s.status === "PAID" || s.status === "CLOSED" || !s.status
      );

      const totalSales = paidSales.reduce((sum, s) => sum + s.total, 0);
      const salesCount = paidSales.length;

      const productCatalog = await container.inventoryEngine.get().listAll();
      if (current.runId !== runId) return;

      const productMap = new Map(productCatalog.map((p) => [p.id, p]));

      const productMapQuantities = new Map<string, { name: string; quantity: number }>();
      paidSales.forEach((sale) => {
        sale.items.forEach((item) => {
          const name = productMap.get(item.productId)?.name ?? item.productId;
          const current = productMapQuantities.get(item.productId) ?? { name, quantity: 0 };
          current.quantity += item.quantity;
          productMapQuantities.set(item.productId, current);
        });
      });

      let topProduct: string | null = null;
      let topProductQuantity = 0;
      productMapQuantities.forEach((value) => {
        if (value.quantity > topProductQuantity) {
          topProductQuantity = value.quantity;
          topProduct = value.name;
        }
      });

      const business = businessStore.get();
      const config = companyConfigStore.get();
      const locale = config.language === "en" ? "en-US" : config.language === "pt" ? "pt-BR" : "es-CO";
      const dateLabel = now.toLocaleDateString(locale, {
        timeZone: tz,
        weekday: "long",
        day: "numeric",
        month: "long"
      });

      const text = [
        `📊 Reporte diario - ${business.name || "VIMDY"}`,
        `📅 ${dateLabel}`,
        ``,
        `💰 Ventas del día: ${Math.round(totalSales).toLocaleString(locale)} ${config.currency}`,
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
