import { Activity } from "lucide-react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { useTranslation } from "../../../core/i18n/useTranslation";
import type { DashboardExecutiveModel } from "../../../core/dashboard/executive/DashboardExecutiveTypes";

interface Props { model: DashboardExecutiveModel; }

export function DashboardSalesTrend({ model }: Props) {
  const { language, money } = useTranslation();

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
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={model.salesTrend} margin={{ top: 10, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="currentColor" opacity={0.08} />
              <XAxis dataKey="label" tick={{ fontSize: 12 }} tickLine={false} axisLine={false} />
              <YAxis tick={{ fontSize: 12 }} tickLine={false} axisLine={false} width={72} tickFormatter={(value) => money(Number(value))} />
              <Tooltip
                formatter={(value) => [money(Number(value)), language === "en" ? "Net sales" : language === "pt" ? "Vendas líquidas" : "Ventas netas"]}
                labelFormatter={(label) => label}
                contentStyle={{ borderRadius: 12, border: "1px solid rgba(255,255,255,0.10)", background: "var(--vimdy-surface, #101012)" }}
              />
              <Line type="monotone" dataKey="value" stroke="currentColor" className="text-vimdy-accent" strokeWidth={2.5} dot={false} activeDot={{ r: 4 }} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
    </section>
  );
}
