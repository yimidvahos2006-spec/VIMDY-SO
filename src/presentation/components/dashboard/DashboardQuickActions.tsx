import React from "react";
import { useNavigate } from "react-router-dom";
import { ShoppingCart, UserPlus, PackagePlus, ClipboardPlus } from "lucide-react";

import { useTranslation } from "../../../core/i18n/useTranslation";
import { useDashboardAdaptive } from "../../../core/dashboard/adaptive/useDashboardAdaptive";
import { getVisibleDashboardQuickActions, type DashboardQuickActionId } from "../../../core/dashboard/adaptive/DashboardAdaptiveView";
import type { TranslationKey } from "../../../core/i18n/dictionaries";

interface QuickAction {
  id: DashboardQuickActionId;
  titleKey: TranslationKey;
  icon: React.ComponentType<{ size?: number; className?: string }>;
  badgeClass: string;
  iconClass: string;
  route: string;
}

const ACTIONS: readonly QuickAction[] = [
  { id: "newSale", titleKey: "dashboard.quickAction.newSale", icon: ShoppingCart, badgeClass: "bg-vimdy-success/20", iconClass: "text-vimdy-success", route: "/caja" },
  { id: "newCustomer", titleKey: "dashboard.quickAction.newCustomer", icon: UserPlus, badgeClass: "bg-vimdy-accent-hover/20", iconClass: "text-vimdy-accent-hover", route: "/clientes" },
  { id: "newProduct", titleKey: "dashboard.quickAction.newProduct", icon: PackagePlus, badgeClass: "bg-vimdy-warning/20", iconClass: "text-vimdy-warning", route: "/inventario" },
  { id: "newOrder", titleKey: "dashboard.quickAction.newOrder", icon: ClipboardPlus, badgeClass: "bg-vimdy-recipe-hover/20", iconClass: "text-vimdy-recipe-hover", route: "/cocina" },
];

export function DashboardQuickActions() {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const adaptive = useDashboardAdaptive();
  const visible = getVisibleDashboardQuickActions(adaptive);

  if (!adaptive.isReady || visible.length === 0) return null;

  return (
    <div className={`grid grid-cols-2 gap-5 ${visible.length >= 4 ? "xl:grid-cols-4" : visible.length === 3 ? "xl:grid-cols-3" : "xl:grid-cols-2"}`}>
      {visible.map((id) => {
        const action = ACTIONS.find((candidate) => candidate.id === id);
        if (!action) return null;
        const Icon = action.icon;

        return (
          <button
            key={action.id}
            onClick={() => navigate(action.route)}
            className="group bg-vimdy-surface border border-vimdy-border rounded-vimdy-lg p-6 hover:border-vimdy-accent transition-colors duration-vimdy-normal text-left"
          >
            <div className={`w-14 h-14 rounded-vimdy-md flex items-center justify-center mb-5 ${action.badgeClass}`}>
              <Icon size={28} className={action.iconClass} />
            </div>
            <p className="text-vimdy-text font-semibold text-vimdy-body">{t(action.titleKey)}</p>
          </button>
        );
      })}
    </div>
  );
}