import React from "react";
import { ForecastDashboard } from "../components/forecast/ForecastDashboard";
import { RequirePermission } from "../navigation/RequirePermission";

export function ForecastPage() {
  return (
    <RequirePermission requires="reports.view">
      <div className="min-h-screen p-8">
        <ForecastDashboard />
      </div>
    </RequirePermission>
  );
}