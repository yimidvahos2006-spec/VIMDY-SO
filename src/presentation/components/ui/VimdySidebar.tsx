import React, { useMemo } from "react";
import {
  LayoutDashboard,
  ShoppingCart,
  ChefHat,
  Boxes,
  Users,
  UserRound,
  BarChart3,
  DollarSign,
  ShieldAlert,
  Truck,
  Sparkles,
  Bell,
  Settings,
  PanelLeftClose,
  PanelLeftOpen,
  X
} from "lucide-react";

import { NavLink } from "react-router-dom";
import { VimdyLogo } from "./VimdyLogo";
import { VimdyCenter } from "./VimdyCenter";
import { useSidebar } from "../../../core/store/useSidebar";
import { useMobileSidebar } from "../../../core/store/useMobileSidebar";
import { useEnabledModules } from "../../../core/store/useEnabledModules";
import { useCashierShiftStatus } from "../../../hooks/useCashierShiftStatus";
import { MODULE_CATALOG } from "../../../core/config/modules";

const menu = [
  { icon: LayoutDashboard, title: "Dashboard", path: "/dashboard" },
  { icon: ShoppingCart, title: "Caja", path: "/caja" },
  { icon: ChefHat, title: "Cocina", path: "/cocina" },
  { icon: UserRound, title: "Meseros", path: "/meseros" },
  { icon: Boxes, title: "Inventario", path: "/inventario" },
  { icon: Users, title: "Clientes", path: "/clientes" },

  { icon: Truck, title: "Compras", path: "/compras-inteligentes" },
  { icon: DollarSign, title: "Ganancias", path: "/ganancias" },
  { icon: ShieldAlert, title: "Pérdidas", path: "/perdidas" },
  { icon: BarChart3, title: "Reportes", path: "/reportes" },

  { icon: Sparkles, title: "VIMDY IA", path: "/ia" },

  { icon: Bell, title: "Notificaciones", path: "/notificaciones" },
  { icon: Settings, title: "Configuración", path: "/configuracion" }
];

/**
 * Sidebar principal de VIMDY.
 *
 * Comportamiento responsivo (arreglo de visibilidad en pantallas angostas):
 *  - Escritorio (>= md): siempre visible, fijo a la izquierda. `expanded`
 *    (sidebarStore) decide si se ve solo con iconos (84px) o con iconos +
 *    texto (260px). Esto NO cambia.
 *  - Móvil/Tablet (< md): el sidebar no ocupa espacio del contenido. Vive
 *    oculto fuera de pantalla (drawer) y solo aparece como panel
 *    superpuesto cuando el usuario toca el botón de hamburguesa en
 *    VimdyAppLayout. Mientras está abierto, se ve siempre con texto
 *    completo (no tiene sentido un drawer angosto solo de iconos) y un
 *    botón X + un fondo oscuro lo cierran.
 *
 * `showLabels` es la etiqueta/título de cada ítem: siempre visible en
 * móvil (el drawer es ancho), y en escritorio solo si `expanded` es true.
 */
export function VimdySidebar() {
  const { expanded, toggle } = useSidebar();
  const { open: mobileOpen, close: closeMobile } = useMobileSidebar();
  const enabledModules = useEnabledModules();
  const shiftOpen = useCashierShiftStatus();

   const visibleMenu = useMemo(() => {
     if (!enabledModules || enabledModules.length === 0) return menu;

    const enabledSet = new Set(enabledModules);

    const hiddenPaths = new Set(
      MODULE_CATALOG
        .filter(
          module =>
            module.sidebarPath &&
            !enabledSet.has(module.id)
        )
        .map(module => module.sidebarPath as string)
    );

    return menu.filter(
      item => !hiddenPaths.has(item.path)
    );
  }, [enabledModules]);

  // Clase compartida: visible siempre en móvil (sin prefijo), y en
  // escritorio solo si el sidebar está expandido (md:hidden si no).
  const labelClass = expanded ? "" : "md:hidden";

  return (
    <>
      {/* Fondo oscuro detrás del drawer, solo en móvil/tablet cuando está abierto */}
      {mobileOpen && (
        <div
          onClick={closeMobile}
          className="md:hidden fixed inset-0 bg-black/60 z-40"
        />
      )}

      <aside
        className={`
          w-[260px]
          ${expanded ? "md:w-[260px]" : "md:w-[84px]"}
          ${mobileOpen ? "translate-x-0" : "-translate-x-full"}
          md:translate-x-0
          h-screen
          fixed
          top-0
          left-0
          bg-vimdy-background
          border-r
          border-vimdy-border
          flex
          flex-col
          transition-all
          duration-300
          overflow-hidden
          z-50
        `}
      >
        {/* Botón de cerrar, solo visible en el drawer móvil */}
        <button
          onClick={closeMobile}
          className="md:hidden absolute top-4 right-4 w-9 h-9 rounded-xl flex items-center justify-center text-vimdy-text-secondary hover:bg-vimdy-surface hover:text-vimdy-text transition-all z-10"
        >
          <X size={18} />
        </button>

        {/* HEADER */}
        <div
          className={`
            h-[92px]
            border-b
            border-vimdy-border
            flex
            items-center
            justify-between
            px-6
            ${!expanded ? "md:justify-center md:px-0" : ""}
          `}
        >
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-4">
              <VimdyLogo size={42} />

              <div className={labelClass}>
                <h2 className="text-vimdy-text text-lg font-semibold tracking-wide">
                  VIMDY
                </h2>
                <p
                  className={`text-xs font-medium flex items-center gap-1.5 ${
                    shiftOpen ? "text-vimdy-success" : "text-vimdy-danger"
                  }`}
                >
                  <span
                    className={`w-1.5 h-1.5 rounded-full ${
                      shiftOpen ? "bg-vimdy-success" : "bg-vimdy-danger"
                    }`}
                  />
                  {shiftOpen === null ? "..." : shiftOpen ? "En línea" : "Fuera de línea"}
                </p>
              </div>
            </div>

            {/* Centro VIMDY: perfil, notificaciones, IA y más */}
            <VimdyCenter />

            {/* Botón de colapsar — solo tiene sentido en escritorio */}
            <button
              onClick={toggle}
              className={`hidden ${expanded ? "md:flex" : "md:hidden"} w-9 h-9 rounded-xl items-center justify-center text-vimdy-text-secondary hover:bg-vimdy-surface hover:text-vimdy-text transition-all`}
            >
              <PanelLeftClose size={18} />
            </button>
          </div>
        </div>

        {/* Botón de expandir — solo aparece en escritorio colapsado */}
        {!expanded && (
          <div className="hidden md:flex py-4 justify-center">
            <button
              onClick={toggle}
              className="w-10 h-10 rounded-xl flex items-center justify-center text-vimdy-text-secondary hover:bg-vimdy-surface hover:text-vimdy-text transition-all"
            >
              <PanelLeftOpen size={18} />
            </button>
          </div>
        )}

        {/* BODY / MENU */}
        <div
          className={`
            flex-1
            flex
            flex-col
            px-3
            py-4
            gap-1
            overflow-y-auto
          `}
        >
          {visibleMenu.map((item) => {
            const Icon = item.icon;

            const showSeparator =
              item.title === "Compras" ||
              item.title === "VIMDY IA" ||
              item.title === "Notificaciones";

            return (
              <React.Fragment key={item.title}>
                {showSeparator && (
                  <div className="h-px bg-vimdy-border my-3" />
                )}

                <NavLink
                  to={item.path}
                  onClick={closeMobile}
                  className={({ isActive }) => `
                    flex
                    items-center
                    justify-start
                    px-4
                    gap-4
                    ${!expanded ? "md:justify-center md:px-0" : ""}
                    h-12
                    rounded-xl
                    transition-all
                    duration-200
                    ${
                      isActive
                        ? "bg-vimdy-surface-hover text-vimdy-text"
                        : "text-vimdy-text-secondary hover:bg-vimdy-surface hover:text-vimdy-text"
                    }
                  `}
                >
                  {({ isActive }) => (
                    <>
                      <Icon
                        size={20}
                        className={`
                          flex-shrink-0
                          transition-all
                          ${isActive ? "text-vimdy-text" : "text-vimdy-text-secondary"}
                        `}
                      />

                      <span className={`text-sm font-medium tracking-wide ${labelClass}`}>
                        {item.title}
                      </span>
                    </>
                  )}
                </NavLink>
              </React.Fragment>
            );
          })}
        </div>
      </aside>
    </>
  );
}