import { Gauge, Zap, Activity } from "lucide-react";

import { useTranslation } from "../../core/i18n/useTranslation";
import { DashboardWelcome } from "../components/dashboard/DashboardWelcome";
import { DashboardIndicators } from "../components/dashboard/DashboardIndicators";
import { GerenteInteligente } from "../components/dashboard/GerenteInteligente";
import { DashboardQuickActions } from "../components/dashboard/DashboardQuickActions";
import { DailyReportButton } from "../components/dashboard/DailyReportButton";
import { DashboardActivity } from "../components/dashboard/DashboardActivity";
import { DashboardSection } from "../components/dashboard/DashboardSection";

/**
 * Dashboard — VIMDY Experience 1.0, Dashboard V3, Paso 1.1
 * ---------------------------------------------------------------------------
 * Estructura fija de 5 bloques, en este orden, y nada más:
 *   1. Bienvenida Inteligente (DashboardWelcome)      — ancho completo
 *   2. Indicadores principales (DashboardIndicators)  — Ventas, Ganancia,
 *      Caja, Pedidos, Salud del negocio
 *   3. Gerente Inteligente (GerenteInteligente)        — recomendaciones
 *      accionables (título + explicación + botón)
 *   4. Acciones rápidas (DashboardQuickActions)         — 4 acciones
 *   5. Actividad reciente (DashboardActivity)           — ventas, pedidos
 *      y movimientos recientes
 *
 * Ya no hay sistema de widgets reordenables/ocultables ni panel de
 * personalización: los 5 bloques son fijos, así que ese layout dejó de
 * tener sentido. El antiguo DashboardHeader (buscador, campana y
 * engranaje sin funcionalidad, más un badge de usuario falso que se
 * pisaba con el UserSessionBadge real) tampoco pertenece a ninguno de
 * los 5 bloques y se eliminó por completo.
 */
export function Dashboard() {
  const { t } = useTranslation();

  return (
    <div className="w-full min-h-screen flex flex-col">
      <main className="flex-1 w-full px-8 py-10">
        <div className="max-w-[1800px] mx-auto grid grid-cols-12 gap-8">

          {/* Bloque 1 — Bienvenida Inteligente */}
          <DashboardWelcome />

          {/* Bloque 2 — Indicadores principales */}
          <DashboardSection title={t("dashboard.section.indicators")} icon={Gauge} accent="indicators">
            <DashboardIndicators />
          </DashboardSection>

          {/* Bloque 3 — Gerente Inteligente */}
          <GerenteInteligente />

          {/* Bloque 4 — Acciones rápidas */}
          <DashboardSection title={t("dashboard.section.quickActions")} icon={Zap} accent="actions">
            <DashboardQuickActions />
          </DashboardSection>

          {/* Bloque 4.1 — Reporte diario por WhatsApp */}
          <DailyReportButton />

          {/* Bloque 5 — Actividad reciente */}
          <DashboardSection title={t("dashboard.section.activity")} icon={Activity} accent="activity">
            <DashboardActivity />
          </DashboardSection>

        </div>
      </main>
    </div>
  );
}