import React from "react";
import { useNavigate } from "react-router-dom";
import { ShoppingCart, UserPlus, PackagePlus, ClipboardPlus } from "lucide-react";

import { useTranslation } from "../../../core/i18n/useTranslation";
import type { TranslationKey } from "../../../core/i18n/dictionaries";

interface QuickAction {
  titleKey: TranslationKey;
  icon: React.ComponentType<{ size?: number; className?: string }>;
  badgeClass: string;
  iconClass: string;
  route: string;
}

/**
 * Bloque 4 — Acciones rápidas (VIMDY Experience 1.0, Dashboard V3, Paso 1.1)
 * ---------------------------------------------------------------------------
 * Exactamente 4 acciones, nunca más: Nueva venta, Nuevo cliente, Nuevo
 * producto, Nuevo pedido. Cada botón navega de verdad a la pantalla real
 * donde esa acción se completa (antes eran botones decorativos sin
 * onClick, igual que la tarjeta de WhatsApp que vivía aquí y que no
 * pertenece a ninguno de los 5 bloques).
 *
 * Fase 3 (5.2 — colores fuera de paleta): antes cada acción traía un hex
 * suelto (`color: "#22C55E"`, etc.) aplicado con `style={{ background }}`
 * + el prop `color` de lucide-react. Los 3 primeros ya tenían equivalente
 * EXACTO en tailwind.config.js (success/accent-hover/warning); "Nuevo
 * pedido" (#A78BFA) no tenía match exacto, así que usa vimdy-recipe-hover
 * (#C084FC), el tono morado más cercano ya documentado — no se agregó un
 * token nuevo solo para esta única acción.
 */
const ACTIONS: QuickAction[] = [
  { titleKey: "dashboard.quickAction.newSale", icon: ShoppingCart, badgeClass: "bg-vimdy-success/20", iconClass: "text-vimdy-success", route: "/caja" },
  { titleKey: "dashboard.quickAction.newCustomer", icon: UserPlus, badgeClass: "bg-vimdy-accent-hover/20", iconClass: "text-vimdy-accent-hover", route: "/clientes" },
  { titleKey: "dashboard.quickAction.newProduct", icon: PackagePlus, badgeClass: "bg-vimdy-warning/20", iconClass: "text-vimdy-warning", route: "/inventario" },
  { titleKey: "dashboard.quickAction.newOrder", icon: ClipboardPlus, badgeClass: "bg-vimdy-recipe-hover/20", iconClass: "text-vimdy-recipe-hover", route: "/cocina" }
];

export function DashboardQuickActions() {
  const navigate = useNavigate();
  const { t } = useTranslation();

  return (
    <div className="grid grid-cols-2 xl:grid-cols-4 gap-5">
      {ACTIONS.map((action) => {
        const Icon = action.icon;
        return (
          <button
            key={action.titleKey}
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