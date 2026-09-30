import { ArrowDownRight, ArrowUpRight, Minus, Wallet, Package, ReceiptText } from "lucide-react";

import { useTranslation } from "../../../core/i18n/useTranslation";
import type { DashboardExecutiveKpi, DashboardExecutiveKpiId, DashboardExecutiveModel } from "../../../core/dashboard/executive/DashboardExecutiveTypes";

interface Props { model: DashboardExecutiveModel; }

function changePercent(kpi: DashboardExecutiveKpi): number | null {
  if (kpi.previousValue === null || kpi.previousValue === 0 || kpi.value === null) return null;
  return ((kpi.value - kpi.previousValue) / kpi.previousValue) * 100;
}

function statusCopy(language: string, id: DashboardExecutiveKpiId, model: DashboardExecutiveModel): string {
  if (id === "cashClose") {
    if (model.closing.status === "CLOSED") return model.closing.dataComplete ? (language === "en" ? "Closed cash" : language === "pt" ? "Caixa fechado" : "Cierre confirmado") : (language === "en" ? "Incomplete close" : language === "pt" ? "Fechamento incompleto" : "Cierre incompleto");
    if (model.closing.status === "OPEN") return language === "en" ? "Cash shift open" : language === "pt" ? "Caixa aberto" : "Caja abierta";
    return language === "en" ? "No cash close" : language === "pt" ? "Sem fechamento" : "Sin cierre";
  }
  if (id === "inventoryValue") {
    return model.capabilities.inventory
      ? (language === "en" ? "Purchase-cost valuation" : language === "pt" ? "Valor a custo de compra" : "Valor a costo de compra")
      : "";
  }
  if (id === "profit") return language === "en" ? "Today's calculated profit" : language === "pt" ? "Lucro calculado de hoje" : "Ganancia calculada de hoy";
  if (id === "averageSale") return language === "en" ? "Net average" : language === "pt" ? "Média líquida" : "Promedio neto";
  if (id === "transactions") return language === "en" ? (model.capabilities.orders ? "Orders" : "Transactions") : language === "pt" ? (model.capabilities.orders ? "Pedidos" : "Transações") : (model.capabilities.orders ? "Pedidos" : "Transacciones");
  return language === "en" ? "Net sales · comparable" : language === "pt" ? "Vendas líquidas · comparável" : "Ventas netas · comparable";
}

function titleForKpi(id: DashboardExecutiveKpiId, language: string, model: DashboardExecutiveModel): string {
  switch (id) {
    case "netSales": return language === "en" ? "Net sales · comparable" : language === "pt" ? "Vendas líquidas · comparável" : "Ventas netas · comparable";
    case "averageSale": return language === "en" ? "Average sale" : language === "pt" ? "Venda média" : "Promedio por venta";
    case "transactions": return language === "en" ? (model.capabilities.orders ? "Orders" : "Transactions") : language === "pt" ? (model.capabilities.orders ? "Pedidos" : "Transações") : (model.capabilities.orders ? "Pedidos" : "Transacciones");
    case "profit": return language === "en" ? "Profit" : language === "pt" ? "Lucro" : "Ganancia";
    case "cashClose": return language === "en" ? "Cash close" : language === "pt" ? "Fechamento de caixa" : "Cierre de caja";
    case "inventoryValue": return language === "en" ? "Inventory at cost" : language === "pt" ? "Estoque a custo" : "Inventario a costo";
  }
}

function valueForKpi(kpi: DashboardExecutiveKpi, money: (value: number) => string, language: string): string {
  if (kpi.value === null) {
    return language === "en" ? "Not available" : language === "pt" ? "Não disponível" : "No disponible";
  }
  return kpi.unit === "currency" ? money(kpi.value) : Math.round(kpi.value).toLocaleString(language === "en" ? "en-US" : language === "pt" ? "pt-BR" : "es-CO");
}

function KpiCard({ kpi, model }: { kpi: DashboardExecutiveKpi; model: DashboardExecutiveModel }) {
  const { language, money } = useTranslation();
  const change = changePercent(kpi);
  const value = valueForKpi(kpi, money, language);
  const copy = statusCopy(language, kpi.id, model);

  return (
    <article className="min-h-[156px] rounded-vimdy-xl border border-vimdy-border bg-vimdy-surface p-6 shadow-vimdy-xs">
      <div className="flex items-start justify-between gap-3">
        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-vimdy-text-secondary">
          {titleForKpi(kpi.id, language, model)}
        </p>
        {kpi.id === "cashClose" ? <Wallet size={18} className="text-vimdy-text-tertiary" aria-hidden="true" /> : null}
        {kpi.id === "inventoryValue" ? <Package size={18} className="text-vimdy-text-tertiary" aria-hidden="true" /> : null}
        {kpi.id === "transactions" ? <ReceiptText size={18} className="text-vimdy-text-tertiary" aria-hidden="true" /> : null}
      </div>
      <p className="mt-7 text-2xl xl:text-3xl font-bold tracking-tight text-vimdy-text truncate" title={value}>
        {value}
      </p>
      <div className="mt-3 flex items-center justify-between gap-3 text-sm">
        <span className="text-vimdy-text-tertiary truncate">{copy}</span>
        {change !== null ? (
          <span className="inline-flex items-center gap-1 shrink-0 font-semibold">
            {change > 0 ? <ArrowUpRight size={15} className="text-vimdy-success" /> : change < 0 ? <ArrowDownRight size={15} className="text-vimdy-danger" /> : <Minus size={15} className="text-vimdy-text-tertiary" />}
            <span className={change > 0 ? "text-vimdy-success" : change < 0 ? "text-vimdy-danger" : "text-vimdy-text-tertiary"}>
              {Math.abs(change).toFixed(1)}%
            </span>
          </span>
        ) : null}
      </div>
    </article>
  );
}

export function DashboardExecutiveOverview({ model }: Props) {
  const { language } = useTranslation();
  if (model.status === "loading-profile") return <div className="h-48 rounded-vimdy-xl border border-vimdy-border bg-vimdy-surface animate-pulse" aria-label={language === "en" ? "Loading" : language === "pt" ? "Carregando" : "Cargando"} />;
  if (model.status === "insufficient-data") {
    return (
      <section aria-labelledby="dashboard-executive-overview" className="rounded-vimdy-xl border border-vimdy-border bg-vimdy-surface p-6 shadow-vimdy-xs">
        <h2 id="dashboard-executive-overview" className="text-xl font-bold text-vimdy-text">
          {language === "en" ? "Business overview" : language === "pt" ? "Visão do negócio" : "Resumen del negocio"}
        </h2>
        <p className="mt-2 text-sm text-vimdy-text-secondary">
          {language === "en"
            ? "VIMDY is waiting for the first verified dashboard synchronization. No zeros are presented as real business results."
            : language === "pt"
              ? "O VIMDY está aguardando a primeira sincronização verificada do dashboard. Nenhum zero é apresentado como resultado real."
              : "VIMDY está esperando la primera sincronización verificada del dashboard. Ningún cero se presenta como resultado real."}
        </p>
      </section>
    );
  }

  return (
    <section aria-labelledby="dashboard-executive-overview" className="space-y-4">
      <div className="flex items-end justify-between gap-4">
        <div>
          <h2 id="dashboard-executive-overview" className="text-xl font-bold text-vimdy-text">
            {language === "en" ? "Business overview" : language === "pt" ? "Visão do negócio" : "Resumen del negocio"}
          </h2>
          <p className="mt-1 text-sm text-vimdy-text-secondary">
            {language === "en" ? "The most useful numbers for this business, without forcing irrelevant modules." : language === "pt" ? "Os números mais úteis para este negócio, sem forçar módulos irrelevantes." : "Los números más útiles para este negocio, sin forzar módulos irrelevantes."}
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-5 gap-4">
        {model.kpis.map((kpi) => <KpiCard key={kpi.id} kpi={kpi} model={model} />)}
      </div>
      <p className="text-xs text-vimdy-text-tertiary">
        {language === "en"
          ? "Intraday percentage changes compare the same elapsed business-day interval."
          : language === "pt"
            ? "As variações intradiárias comparam o mesmo intervalo decorrido do dia operacional."
            : "Las variaciones intradía comparan el mismo intervalo transcurrido del día empresarial."}
      </p>
    </section>
  );
}