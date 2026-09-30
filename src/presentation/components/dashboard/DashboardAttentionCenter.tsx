import { AlertTriangle, CheckCircle2, Info, TrendingDown } from "lucide-react";

import { useTranslation } from "../../../core/i18n/useTranslation";
import type { DashboardExecutiveAttention, DashboardExecutiveModel } from "../../../core/dashboard/executive/DashboardExecutiveTypes";

interface Props { model: DashboardExecutiveModel; }

function attentionText(id: DashboardExecutiveAttention["id"], language: string, value: number | null, money: (v: number) => string): { title: string; detail: string } {
  if (language === "en") {
    switch (id) {
      case "cashDifference": return { title: "Cash difference detected", detail: `Closing difference: ${money(value ?? 0)}` };
      case "cashOpen": return { title: "Cash shift is still open", detail: "There is no final counted close yet." };
      case "inventoryLow": return { title: "Low-stock products", detail: `${Math.round(value ?? 0)} product(s) are below the configured minimum.` };
      case "inventoryValuation": return { title: "Inventory valuation is incomplete", detail: "At least one stock-tracked product with stock is missing a reliable purchase cost." };
      case "kitchenPending": return { title: "Kitchen work is pending", detail: `${Math.round(value ?? 0)} kitchen order(s) are pending.` };
      case "salesDrop": return { title: "Sales are below the comparable period", detail: `${Math.abs(value ?? 0).toFixed(1)}% below the comparable period.` };
    }
  }
  if (language === "pt") {
    switch (id) {
      case "cashDifference": return { title: "Diferença de caixa detectada", detail: `Diferença no fechamento: ${money(value ?? 0)}` };
      case "cashOpen": return { title: "O caixa ainda está aberto", detail: "Ainda não existe um fechamento contado definitivo." };
      case "inventoryLow": return { title: "Produtos com estoque baixo", detail: `${Math.round(value ?? 0)} produto(s) abaixo do mínimo configurado.` };
      case "inventoryValuation": return { title: "Valoração do estoque incompleta", detail: "Falta um custo de compra confiável em pelo menos um produto com estoque controlado." };
      case "kitchenPending": return { title: "Há trabalho pendente na cozinha", detail: `${Math.round(value ?? 0)} pedido(s) de cozinha pendentes.` };
      case "salesDrop": return { title: "As vendas estão abaixo do comparável", detail: `${Math.abs(value ?? 0).toFixed(1)}% abaixo do período comparável.` };
    }
  }
  switch (id) {
    case "cashDifference": return { title: "Diferencia de caja detectada", detail: `Diferencia en cierre: ${money(value ?? 0)}` };
    case "cashOpen": return { title: "La caja sigue abierta", detail: "Todavía no existe un cierre contado definitivo." };
    case "inventoryLow": return { title: "Productos con inventario bajo", detail: `${Math.round(value ?? 0)} producto(s) están por debajo del mínimo configurado.` };
    case "inventoryValuation": return { title: "Valoración de inventario incompleta", detail: "Al menos un producto con stock controlado no tiene un costo de compra confiable." };
    case "kitchenPending": return { title: "Hay trabajo pendiente en cocina", detail: `${Math.round(value ?? 0)} pedido(s) de cocina están pendientes.` };
    case "salesDrop": return { title: "Las ventas están por debajo del comparable", detail: `${Math.abs(value ?? 0).toFixed(1)}% por debajo del período comparable.` };
  }
}

export function DashboardAttentionCenter({ model }: Props) {
  const { language, money } = useTranslation();
  const empty = language === "en" ? "No relevant issues detected from the data currently available." : language === "pt" ? "Nenhum problema relevante detectado com os dados disponíveis." : "No se detectaron problemas relevantes con los datos disponibles.";

  return (
    <section aria-labelledby="dashboard-attention" className="rounded-vimdy-xl border border-vimdy-border bg-vimdy-surface p-6 shadow-vimdy-xs">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 id="dashboard-attention" className="text-xl font-bold text-vimdy-text">{language === "en" ? "What matters now" : language === "pt" ? "O que importa agora" : "Lo importante ahora"}</h2>
          <p className="mt-1 text-sm text-vimdy-text-secondary">{language === "en" ? "Operational signals derived from real business data." : language === "pt" ? "Sinais operacionais derivados dos dados reais do negócio." : "Señales operativas derivadas de los datos reales del negocio."}</p>
        </div>
        <Info size={18} className="text-vimdy-text-tertiary shrink-0" aria-hidden="true" />
      </div>

      {model.attention.length === 0 ? (
        <div className="mt-6 flex items-center gap-3 rounded-vimdy-lg border border-vimdy-border bg-vimdy-surface-hover px-4 py-4 text-sm text-vimdy-text-secondary">
          <CheckCircle2 size={18} className="text-vimdy-success shrink-0" aria-hidden="true" />
          <span>{empty}</span>
        </div>
      ) : (
        <div className="mt-6 grid grid-cols-1 lg:grid-cols-2 gap-3">
          {model.attention.map((item) => {
            const copy = attentionText(item.id, language, item.value, money);
            const Icon = item.id === "salesDrop" ? TrendingDown : item.severity === "warning" ? AlertTriangle : Info;
            return (
              <article key={item.id} className="flex gap-3 rounded-vimdy-lg border border-vimdy-border bg-vimdy-surface-hover p-4">
                <Icon size={18} className={item.severity === "warning" ? "text-vimdy-warning shrink-0 mt-0.5" : "text-vimdy-text-tertiary shrink-0 mt-0.5"} aria-hidden="true" />
                <div className="min-w-0">
                  <h3 className="font-semibold text-vimdy-text">{copy.title}</h3>
                  <p className="mt-1 text-sm text-vimdy-text-secondary">{copy.detail}</p>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}
