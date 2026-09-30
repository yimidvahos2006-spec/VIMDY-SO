import { Activity } from "lucide-react";

import { VimdyCenter } from "../components/ui/VimdyCenter";
import { DashboardSection } from "../components/dashboard/DashboardSection";
import { DashboardActivity } from "../components/dashboard/DashboardActivity";
import { DashboardCommandHeader } from "../components/dashboard/DashboardCommandHeader";
import { DashboardExecutiveOverview } from "../components/dashboard/DashboardExecutiveOverview";
import { DashboardAttentionCenter } from "../components/dashboard/DashboardAttentionCenter";
import { DashboardOperationsPulse } from "../components/dashboard/DashboardOperationsPulse";
import { DashboardSalesTrend } from "../components/dashboard/DashboardSalesTrend";
import { DashboardCloseStatus } from "../components/dashboard/DashboardCloseStatus";
import { DashboardAdaptiveQuickActions } from "../components/dashboard/DashboardAdaptiveQuickActions";
import { useDashboardExecutive } from "../../hooks/useDashboardExecutive";
import { DailyReportDeliveryStatus } from "../components/dashboard/DailyReportDeliveryStatus";

/**
 * Dashboard ejecutivo VIMDY.
 *
 * Regla de arquitectura: este componente consume un único modelo ejecutivo
 * construido a partir del perfil operativo y del snapshot reconciliado. Los
 * hijos reciben ese modelo por props para no disparar snapshots adicionales.
 */
export function Dashboard() {
  const model = useDashboardExecutive();

  return (
    <div className="w-full min-h-screen flex flex-col">
      <div className="flex justify-end px-8 py-4">
        <VimdyCenter />
      </div>

      <main className="flex-1 w-full px-4 sm:px-6 lg:px-8 pb-10">
        <div className="max-w-[1800px] mx-auto space-y-8">
          <DashboardCommandHeader model={model} />

          <DashboardExecutiveOverview model={model} />

          <DashboardAttentionCenter model={model} />

          <DashboardOperationsPulse model={model} />

          <div className="grid grid-cols-1 2xl:grid-cols-2 gap-8">
            <DashboardSalesTrend model={model} />
            <DashboardCloseStatus model={model} />
          </div>

          <DailyReportDeliveryStatus />

          <DashboardAdaptiveQuickActions model={model} />

          <DashboardSection title="Actividad reciente" icon={Activity} accent="activity">
            <DashboardActivity />
          </DashboardSection>

        </div>
      </main>
    </div>
  );
}