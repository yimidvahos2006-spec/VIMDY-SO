import { lazy, Suspense } from "react";
import { Activity } from "lucide-react";

import { useTranslation } from "../../../core/i18n/useTranslation";
import type { DashboardExecutiveModel } from "../../../core/dashboard/executive/DashboardExecutiveTypes";

// recharts pesa ~346 kB: solo se descarga cuando hay datos para dibujar.
const DashboardSalesTrendChart = lazy(() => import("./DashboardSalesTrendChart"));

interface Props { model: DashboardExecutiveModel; }

export function DashboardSalesTrend({ model }: Props) {
  const { language } = useTranslation();

  if (!model.capabilities.sales) return null;

  const title = language === "en" ? "Sales trend" : language === "pt" ? "Tendência de vendas" : "Tendencia de ventas";
  const subtitle = language === "en" ? "Real net sales by business day." : language === "pt" ? "Vendas líquidas reais por dia operacional." : "Ventas netas reales por día empresarial.";
  const notEnough = language === "en" ? "Not enough historical data yet." : language === "pt" ? "Ainda não há dados históricos suficientes." : "Todavía no hay suficiente histórico.";

  return (
    <section aria-labelledby="dashboard-sales-trend" className="rounded-vimdy-xl border border-vimdy-border bg-vimdy-surface p-6 shadow-vimdy-xs">
      <div className="flex items-start gap-3">
        <Activity size={19} className="text-vimdy-text-tertiary mt-0.5" aria-hidden="true" />
        <div>
          <h2 id="dashboard-sales-trend" className="text-xl font-bold text-vimdy-text">{title}</h2>
          <p className="mt-1 text-sm text-vimdy-text-secondary">{subtitle}</p>
        </div>
      </div>

      {model.salesTrend.length < 2 ? (
        <p className="mt-8 text-sm text-vimdy-text-secondary">{notEnough}</p>
      ) : (
        <div className="mt-6 h-[280px] w-full">
          {/* El fallback tiene la misma altura que el gráfico para que la pantalla no "salte". */}
          <Suspense fallback={<div className="h-full w-full animate-pulse rounded-vimdy-xl bg-vimdy-border/20" aria-hidden="true" />}>
            <DashboardSalesTrendChart data={model.salesTrend} />
          </Suspense>
        </div>
      )}
    </section>
  );
}