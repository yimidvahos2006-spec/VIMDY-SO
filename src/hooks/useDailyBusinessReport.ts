import { useCallback, useMemo, useState, useSyncExternalStore } from "react";

import { useDashboard } from "../core/store/useDashboard";
import { businessStore } from "../core/store/businessStore";
import { companyConfigStore } from "../core/store/companyConfigStore";
import { useTranslation } from "../core/i18n/useTranslation";
import { startOfBusinessDay } from "../core/utils/businessTime";

export interface DailyReport {
  date: string;
  businessName: string;
  totalSales: number;
  salesCount: number;
  averageTicket: number;
  cashStatus: "CLOSED" | "OPEN" | "NO_SHIFT";
  cashExpectedAmount: number | null;
  cashCountedAmount: number | null;
  cashDifference: number | null;
  inventoryLowStockCount: number;
  text: string;
}

/**
 * Reporte diario de vista previa.
 *
 * IMPORTANTE: este hook no recalcula ventas ni caja. Consume exclusivamente
 * el snapshot reconciliado que ya alimenta el Dashboard. Así el botón manual
 * y el Dashboard jamás pueden mostrar cifras distintas por usar fórmulas
 * separadas.
 *
 * El envío automático por WhatsApp no vive aquí; esta vista solo genera el
 * contenido a partir de datos ya reconciliados.
 */
export function useDailyBusinessReport() {
  const dashboard = useDashboard();
  const { language, money } = useTranslation();
  const timezone = useSyncExternalStore(
    companyConfigStore.subscribe,
    () => companyConfigStore.get().timezone,
    () => companyConfigStore.get().timezone,
  );
  const [loading, setLoading] = useState(false);
  const [report, setReport] = useState<DailyReport | null>(null);
  const [error, setError] = useState<string | null>(null);

  const businessName = businessStore.get().name || "VIMDY";
  const date = useMemo(() => new Date(), [dashboard]);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);

    try {
      const locale = language === "en" ? "en-US" : language === "pt" ? "pt-BR" : "es-CO";
      const dateLabel = date.toLocaleDateString(locale, {
        timeZone: timezone,
        weekday: "long",
        day: "numeric",
        month: "long",
        year: "numeric",
      });
      const businessDayStart = startOfBusinessDay(date, timezone);
      const businessDayKey = businessDayStart.toISOString().slice(0, 10);

      const cashStatusLabel =
        dashboard.data.cashStatus === "CLOSED"
          ? language === "en" ? "confirmed" : language === "pt" ? "confirmado" : "confirmado"
          : dashboard.data.cashStatus === "OPEN"
            ? language === "en" ? "open" : language === "pt" ? "aberto" : "abierto"
            : language === "en" ? "not closed" : language === "pt" ? "sem fechamento" : "sin cierre";

      const inventoryLine = dashboard.data.inventoryLowStockCount > 0
        ? language === "en"
          ? `Low stock alerts: ${dashboard.data.inventoryLowStockCount}`
          : language === "pt"
            ? `Alertas de estoque baixo: ${dashboard.data.inventoryLowStockCount}`
            : `Alertas de inventario bajo: ${dashboard.data.inventoryLowStockCount}`
        : language === "en" ? "No low-stock alerts" : language === "pt" ? "Nenhum alerta de estoque baixo" : "Sin alertas de inventario bajo";

      const cashLines = dashboard.data.cashStatus === "CLOSED"
        ? [
            `${language === "en" ? "Expected" : language === "pt" ? "Esperado" : "Esperado"}: ${dashboard.data.cashExpectedAmount === null ? "—" : money(dashboard.data.cashExpectedAmount)}`,
            `${language === "en" ? "Counted" : language === "pt" ? "Contado" : "Contado"}: ${dashboard.data.cashCountedAmount === null ? "—" : money(dashboard.data.cashCountedAmount)}`,
            `${language === "en" ? "Difference" : language === "pt" ? "Diferença" : "Diferencia"}: ${dashboard.data.cashDifference === null ? "—" : money(dashboard.data.cashDifference)}`,
          ]
        : [
            `${language === "en" ? "Cash close" : language === "pt" ? "Fechamento de caixa" : "Cierre de caja"}: ${cashStatusLabel}`,
          ];

      const text = [
        `📊 ${language === "en" ? "Daily report" : language === "pt" ? "Relatório diário" : "Reporte diario"} — ${businessName}`,
        `📅 ${dateLabel}`,
        `🆔 ${businessDayKey}`,
        "",
        `💰 ${language === "en" ? "Net sales" : language === "pt" ? "Vendas líquidas" : "Ventas netas"}: ${money(dashboard.data.sales)}`,
        `🧾 ${language === "en" ? "Transactions" : language === "pt" ? "Transações" : "Transacciones"}: ${dashboard.data.orders}`,
        `🎟️ ${language === "en" ? "Average sale" : language === "pt" ? "Venda média" : "Promedio por venta"}: ${money(dashboard.data.averageTicket)}`,
        "",
        `💵 ${language === "en" ? "Cash" : language === "pt" ? "Caixa" : "Caja"}:`,
        ...cashLines,
        "",
        `📦 ${inventoryLine}`,
        "",
        `📱 ${language === "en" ? "Prepared from reconciled VIMDY data" : language === "pt" ? "Gerado a partir dos dados reconciliados do VIMDY" : "Generado a partir de datos reconciliados de VIMDY"}`,
      ].join("\n");

      setReport({
        date: dateLabel,
        businessName,
        totalSales: dashboard.data.sales,
        salesCount: dashboard.data.orders,
        averageTicket: dashboard.data.averageTicket,
        cashStatus: dashboard.data.cashStatus,
        cashExpectedAmount: dashboard.data.cashExpectedAmount,
        cashCountedAmount: dashboard.data.cashCountedAmount,
        cashDifference: dashboard.data.cashDifference,
        inventoryLowStockCount: dashboard.data.inventoryLowStockCount,
        text,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo generar el reporte.");
    } finally {
      setLoading(false);
    }
  }, [businessName, dashboard, date, language, money, timezone]);

  return { report, loading, error, load };
}
