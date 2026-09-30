import { Boxes, ChefHat, CircleDollarSign, Factory, Users, Utensils } from "lucide-react";

import { useTranslation } from "../../../core/i18n/useTranslation";
import type { DashboardExecutiveModel, DashboardExecutiveOperation } from "../../../core/dashboard/executive/DashboardExecutiveTypes";

interface Props { model: DashboardExecutiveModel; }

function operationLabel(id: DashboardExecutiveOperation["id"], language: string): string {
  if (language === "en") {
    return ({ cash: "Cash", tables: "Tables", kitchen: "Kitchen", inventory: "Inventory", customers: "Customers", production: "Production" } as const)[id];
  }
  if (language === "pt") {
    return ({ cash: "Caixa", tables: "Mesas", kitchen: "Cozinha", inventory: "Estoque", customers: "Clientes", production: "Produção" } as const)[id];
  }
  return ({ cash: "Caja", tables: "Mesas", kitchen: "Cocina", inventory: "Inventario", customers: "Clientes", production: "Producción" } as const)[id];
}

function operationIcon(id: DashboardExecutiveOperation["id"]) {
  return ({ cash: CircleDollarSign, tables: Utensils, kitchen: ChefHat, inventory: Boxes, customers: Users, production: Factory } as const)[id];
}

export function DashboardOperationsPulse({ model }: Props) {
  const { language, money } = useTranslation();
  const empty = language === "en" ? "No additional operational modules apply to this business." : language === "pt" ? "Nenhum outro módulo operacional se aplica a este negócio." : "No hay otros módulos operativos aplicables a este negocio.";

  return (
    <section aria-labelledby="dashboard-operations" className="rounded-vimdy-xl border border-vimdy-border bg-vimdy-surface p-6 shadow-vimdy-xs">
      <h2 id="dashboard-operations" className="text-xl font-bold text-vimdy-text">{language === "en" ? "Operations" : language === "pt" ? "Operação" : "Operación"}</h2>
      <p className="mt-1 text-sm text-vimdy-text-secondary">{language === "en" ? "Only the operational areas this business actually uses." : language === "pt" ? "Somente as áreas operacionais que este negócio realmente usa." : "Solo las áreas operativas que este negocio realmente utiliza."}</p>

      {model.operations.length === 0 ? (
        <p className="mt-6 text-sm text-vimdy-text-secondary">{empty}</p>
      ) : (
        <div className="mt-6 grid grid-cols-2 lg:grid-cols-3 2xl:grid-cols-6 gap-3">
          {model.operations.map((operation) => {
            const Icon = operationIcon(operation.id);
            const value = operation.id === "cash"
              ? operation.value === null ? "—" : money(operation.value)
              : operation.value === null ? "—" : Math.round(operation.value).toLocaleString(language === "en" ? "en-US" : language === "pt" ? "pt-BR" : "es-CO");

            const secondary = operation.id === "tables" && operation.secondaryValue !== null
              ? `/ ${Math.round(operation.secondaryValue)}`
              : operation.id === "inventory" && operation.secondaryValue !== null
                ? money(operation.secondaryValue)
                : operation.id === "customers" && operation.secondaryValue !== null
                  ? (language === "en" ? "total " : language === "pt" ? "total " : "total ") + Math.round(operation.secondaryValue)
                  : operation.id === "cash" && operation.secondaryValue !== null
                    ? money(operation.secondaryValue)
                    : operation.id === "production" && operation.secondaryValue !== null
                      ? (language === "en" ? "capacity " : language === "pt" ? "capacidade " : "capacidad ") + Math.round(operation.secondaryValue)
                      : null;

            return (
              <article key={operation.id} className="rounded-vimdy-lg border border-vimdy-border bg-vimdy-surface-hover p-4">
                <div className="flex items-center gap-2 text-vimdy-text-secondary">
                  <Icon size={17} aria-hidden="true" />
                  <span className="text-sm font-medium">{operationLabel(operation.id, language)}</span>
                </div>
                <div className="mt-4 flex items-baseline gap-2">
                  <span className="text-xl font-bold text-vimdy-text truncate">{value}</span>
                  {secondary ? <span className="text-xs text-vimdy-text-tertiary truncate">{secondary}</span> : null}
                </div>
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}