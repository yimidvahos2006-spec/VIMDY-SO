import React from "react";
import { useNavigate } from "react-router-dom";
import { LossCenterDashboard } from "../components/loss/LossCenterDashboard";
import { RequirePermission } from "../navigation/RequirePermission";
import { useLossCenter } from "../../core/store/useLossCenter";

/**
 * Conecta el hook (Kardex → lossEngine) con el dashboard presentacional.
 * Vive dentro de RequirePermission para no cargar datos sin permiso.
 */
function LossCenterConnected() {
  const navigate = useNavigate();
  const { dashboard, setPeriod } = useLossCenter();

  return (
    <LossCenterDashboard
      rows={dashboard.rows}
      expiryRisk={dashboard.expiryRisk}
      expiryWarningDays={dashboard.expiryWarningDays}
      period={dashboard.period}
      onPeriodChange={setPeriod}
      revenue={dashboard.revenue}
      previousTotalCost={dashboard.previousTotalCost}
      currency={dashboard.currency}
      loading={dashboard.loading}
      error={dashboard.error}
      onRegisterLoss={() => navigate("/inventario")}
      onSelectRow={() => navigate("/inventario")}
    />
  );
}

export function LossCenterPage() {
  return (
    <RequirePermission requires="reports.view">
      <div className="min-h-screen p-8">
        <LossCenterConnected />
      </div>
    </RequirePermission>
  );
}