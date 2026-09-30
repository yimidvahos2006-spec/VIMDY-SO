import { ClipboardPlus, PackagePlus, ShoppingCart, UserPlus } from "lucide-react";
import { useNavigate } from "react-router-dom";

import { useTranslation } from "../../../core/i18n/useTranslation";
import type { DashboardExecutiveQuickActionId, DashboardExecutiveModel } from "../../../core/dashboard/executive/DashboardExecutiveTypes";

interface Props { model: DashboardExecutiveModel; }

const ACTION_META: Record<DashboardExecutiveQuickActionId, { icon: typeof ShoppingCart; route: string; key: "dashboard.quickAction.newSale" | "dashboard.quickAction.newCustomer" | "dashboard.quickAction.newProduct" | "dashboard.quickAction.newOrder" }> = {
  newSale: { icon: ShoppingCart, route: "/caja", key: "dashboard.quickAction.newSale" },
  newCustomer: { icon: UserPlus, route: "/clientes", key: "dashboard.quickAction.newCustomer" },
  newProduct: { icon: PackagePlus, route: "/inventario", key: "dashboard.quickAction.newProduct" },
  newOrder: { icon: ClipboardPlus, route: "/cocina", key: "dashboard.quickAction.newOrder" },
};

export function DashboardAdaptiveQuickActions({ model }: Props) {
  const navigate = useNavigate();
  const { t, language } = useTranslation();
  if (model.quickActions.length === 0) return null;

  return (
    <section aria-labelledby="dashboard-actions" className="rounded-vimdy-xl border border-vimdy-border bg-vimdy-surface p-6 shadow-vimdy-xs">
      <div>
        <h2 id="dashboard-actions" className="text-xl font-bold text-vimdy-text">{language === "en" ? "Quick actions" : language === "pt" ? "Ações rápidas" : "Acciones rápidas"}</h2>
        <p className="mt-1 text-sm text-vimdy-text-secondary">{language === "en" ? "Only actions supported by this business configuration." : language === "pt" ? "Somente ações suportadas pela configuração deste negócio." : "Solo acciones soportadas por la configuración de este negocio."}</p>
      </div>
      <div className="mt-6 grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3">
        {model.quickActions.map((id) => {
          const meta = ACTION_META[id];
          const Icon = meta.icon;
          return (
            <button
              key={id}
              type="button"
              onClick={() => navigate(meta.route)}
              className="group rounded-vimdy-lg border border-vimdy-border bg-vimdy-surface-hover p-4 text-left transition-colors duration-vimdy-normal hover:border-vimdy-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-vimdy-accent"
            >
              <div className="flex items-center gap-3">
                <span className="inline-flex h-10 w-10 items-center justify-center rounded-vimdy-md bg-vimdy-accent/10 text-vimdy-accent" aria-hidden="true">
                  <Icon size={19} />
                </span>
                <span className="font-semibold text-vimdy-text">{t(meta.key)}</span>
              </div>
            </button>
          );
        })}
      </div>
    </section>
  );
}
