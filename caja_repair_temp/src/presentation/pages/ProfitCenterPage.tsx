import React from "react";
import { ProfitCenterDashboard } from "../components/profit/ProfitCenterDashboard";
import { RequirePermission } from "../navigation/RequirePermission";

export function ProfitCenterPage() {
  return (
    <RequirePermission requires="reports.view">
      <div className="min-h-screen p-8">
        <ProfitCenterDashboard />
      </div>
    </RequirePermission>
  );
}