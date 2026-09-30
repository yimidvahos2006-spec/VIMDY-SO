import React, { useState } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import {
  LayoutDashboard,
  ShoppingCart,
  Package,
  Wallet,
  MoreHorizontal,
  ChefHat,
  UserRound,
  Users,
  BarChart3,
  DollarSign,
  ShieldAlert,
  Truck,
  Sparkles,
  Bell,
  Settings,
  X
} from "lucide-react";

import { useEnabledModules } from "../../../core/store/useEnabledModules";
import { MODULE_CATALOG } from "../../../core/config/modules";

const MAIN_ITEMS = [
  { icon: LayoutDashboard, label: "Inicio", path: "/dashboard" },
  { icon: ShoppingCart, label: "Vender", path: "/caja", state: { tab: "venta" as const } },
  { icon: Package, label: "Productos", path: "/inventario" },
  { icon: Wallet, label: "Caja", path: "/caja", state: { tab: "turno" as const } }
];

const MORE_ITEMS = [
  { icon: ChefHat, label: "Cocina", path: "/cocina", moduleId: "cocina" as const },
  { icon: UserRound, label: "Meseros", path: "/meseros", moduleId: "mesas" as const },
  { icon: Users, label: "Clientes", path: "/clientes", moduleId: "clientes" as const },
  { icon: BarChart3, label: "Reportes", path: "/reportes" },
  { icon: DollarSign, label: "Ganancias", path: "/ganancias" },
  { icon: ShieldAlert, label: "Pérdidas", path: "/perdidas" },
  { icon: Truck, label: "Compras", path: "/compras-inteligentes" },
  { icon: Sparkles, label: "VIMDY IA", path: "/ia", moduleId: "ia" as const },
  { icon: Bell, label: "Notificaciones", path: "/notificaciones" },
  { icon: Settings, label: "Configuración", path: "/configuracion" }
];

export function MobileBottomNav() {
  const navigate = useNavigate();
  const location = useLocation();
  const enabledModules = useEnabledModules();
  const [moreOpen, setMoreOpen] = useState(false);

  const enabledSet = new Set(enabledModules ?? []);

  const visibleMoreItems = MORE_ITEMS.filter((item) => {
    if (!item.moduleId) return true;
    return enabledSet.has(item.moduleId);
  });

  const isActive = (path: string, state?: Record<string, unknown>) => {
    if (location.pathname !== path) return false;
    if (!state) return true;
    return Object.entries(state).every(([key, value]) => location.state?.[key] === value);
  };

  return (
    <>
      {/* Fondo oscuro del drawer "Más" */}
      {moreOpen && (
        <div
          className="fixed inset-0 bg-black/60 z-40 md:hidden"
          onClick={() => setMoreOpen(false)}
        />
      )}

      {/* Drawer "Más" */}
      <div
        className={`
          fixed bottom-16 left-0 right-0 z-50 md:hidden
          bg-vimdy-surface border-t border-vimdy-border
          transition-transform duration-200 ease-out
          ${moreOpen ? "translate-y-0" : "translate-y-full"}
        `}
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-vimdy-border">
          <span className="text-vimdy-text font-semibold text-sm">Más</span>
          <button
            onClick={() => setMoreOpen(false)}
            className="w-8 h-8 rounded-lg flex items-center justify-center text-zinc-400 hover:text-white hover:bg-vimdy-surface-hover transition-all"
          >
            <X size={18} />
          </button>
        </div>
        <div className="grid grid-cols-4 gap-1 p-2 max-h-[60vh] overflow-y-auto">
          {visibleMoreItems.map((item) => {
            const Icon = item.icon;
            const active = location.pathname === item.path;

            return (
              <button
                key={item.path}
                onClick={() => {
                  navigate(item.path);
                  setMoreOpen(false);
                }}
                className={`
                  flex flex-col items-center gap-1 p-2 rounded-xl text-xs font-medium transition-all
                  ${
                    active
                      ? "bg-vimdy-accent/15 text-vimdy-accent"
                      : "text-zinc-400 hover:text-white hover:bg-vimdy-surface-hover"
                  }
                `}
              >
                <Icon size={22} />
                <span className="truncate w-full text-center">{item.label}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Barra inferior */}
      <nav className="fixed bottom-0 left-0 right-0 z-40 md:hidden bg-vimdy-background border-t border-vimdy-border">
        <div className="flex items-center justify-around h-16 px-2">
          {MAIN_ITEMS.map((item) => {
            const Icon = item.icon;
            const active = isActive(item.path, item.state);

            return (
              <button
                key={`${item.path}-${item.state?.tab ?? 'default'}`}
                onClick={() => navigate(item.path, item.state ? { state: item.state } : undefined)}
                className={`
                  flex flex-col items-center justify-center gap-1 flex-1 h-full transition-all
                  ${active ? "text-vimdy-accent" : "text-zinc-500 hover:text-zinc-300"}
                `}
              >
                <Icon size={22} className={active ? "text-vimdy-accent" : ""} />
                <span className="text-[10px] font-medium leading-none">{item.label}</span>
              </button>
            );
          })}

          <button
            onClick={() => setMoreOpen((prev) => !prev)}
            className={`
              flex flex-col items-center justify-center gap-1 flex-1 h-full transition-all
              ${moreOpen ? "text-vimdy-accent" : "text-zinc-500 hover:text-zinc-300"}
            `}
          >
            <MoreHorizontal size={22} className={moreOpen ? "text-vimdy-accent" : ""} />
            <span className="text-[10px] font-medium leading-none">Más</span>
          </button>
        </div>
      </nav>
    </>
  );
}
