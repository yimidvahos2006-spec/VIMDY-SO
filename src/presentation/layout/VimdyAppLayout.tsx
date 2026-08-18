import React from "react";
import { Menu } from "lucide-react";

import { VimdyBackground } from "../components/ui/VimdyBackground";
import { VimdySidebar } from "../components/ui/VimdySidebar";
import { VimdyLogo } from "../components/ui/VimdyLogo";
import { NotificationBell } from "../components/ui/NotificationBell";
import { useSidebar } from "../../core/store/useSidebar";
import { useMobileSidebar } from "../../core/store/useMobileSidebar";
import { useAutoAlerts } from "../../hooks/useAutoAlerts";
import { useDashboardSync } from "../../hooks/useDashboardSync";
import { CopilotButton } from "../components/copilot/CopilotButton";
import { CopilotPanel } from "../components/copilot/CopilotPanel";
import { SubscriptionWarningBanner } from "../components/subscription/SubscriptionWarningBanner";
import { TrialEndedOverlay } from "../components/subscription/TrialEndedOverlay";
import { MobileBottomNav } from "../components/ui/MobileBottomNav";
import { companyConfigStore } from "../../core/store/companyConfigStore";

interface Props {
  children: React.ReactNode;
}

export function VimdyAppLayout({ children }: Props) {

  const { expanded } = useSidebar();
  const { show: openMobileSidebar } = useMobileSidebar();

  // PASO 4 — Alertas automáticas: vigila el negocio en segundo plano (toda
  // la app, no solo el Dashboard) y llena la campana sin que nadie pregunte.
  useAutoAlerts();

  // Recalcula las métricas del Dashboard (ventas de hoy, pedidos, ticket
  // promedio...) desde datos reales, y se actualiza solo cuando cualquier
  // dispositivo (no solo este) vende, agrega un cliente o cambia stock.
  useDashboardSync();

  return (
    <VimdyBackground>

      {companyConfigStore.get().enableAI && <NotificationBell />}

      {/* El sidebar se posiciona solo (fixed) — en escritorio siempre
          visible a la izquierda, en móvil/tablet oculto hasta que se abre
          con el botón de hamburguesa de abajo. */}
      <VimdySidebar />

      <div className="h-screen overflow-hidden">

        {/* Barra superior — SOLO en móvil/tablet (< md). En escritorio el
            sidebar ya está siempre visible, así que esta barra no hace
            falta ahí. Sin esto, en pantallas angostas no había forma de
            abrir el menú: por eso "Configuración" y otros paneles no se
            veían. */}
        <div className="md:hidden h-16 flex items-center gap-3 px-4 border-b border-vimdy-border bg-vimdy-background">
          <button
            onClick={openMobileSidebar}
            className="w-10 h-10 rounded-xl flex items-center justify-center text-vimdy-text-secondary hover:bg-vimdy-surface hover:text-vimdy-text transition-all flex-shrink-0"
          >
            <Menu size={22} />
          </button>
          <VimdyLogo size={28} />
          <span className="text-vimdy-text font-semibold tracking-wide">VIMDY</span>
        </div>

        {/* Contenido — en escritorio reserva el espacio del sidebar con
            margen; en móvil/tablet el sidebar no ocupa espacio (es un
            drawer superpuesto), así que el contenido usa el ancho
            completo. */}
        <main
          className={`
            ml-0
            ${expanded ? "md:ml-[260px]" : "md:ml-[84px]"}
            h-[calc(100vh-4rem)]
            md:h-screen
            overflow-y-auto
            overflow-x-hidden
            transition-all
            duration-300
            pb-16 md:pb-0
          `}
        >
          {children}
        </main>

        {/* Navegación inferior — solo móvil/tablet */}
        <MobileBottomNav />

      </div>

      {/* Copiloto VIMDY: botón flotante + panel, visibles en toda la app.
          Se puede apagar desde Configuración > enableAI. */}
      {companyConfigStore.get().enableAI && (
        <>
          <CopilotPanel />
          <CopilotButton />
        </>
      )}

      {/* VIMDY — FASE 7: aviso de días restantes (PASO 4) y pantalla de
          vencimiento (PASO 5), visibles en toda la app autenticada — no
          solo en Dashboard/Configuración — porque ambos ya deciden solos
          cuándo mostrarse (o no mostrarse) según el estado real del plan. */}
      <SubscriptionWarningBanner />
      <TrialEndedOverlay />

    </VimdyBackground>
  );
}

export default VimdyAppLayout;