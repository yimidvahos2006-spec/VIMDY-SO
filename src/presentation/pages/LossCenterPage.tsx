import React from "react";
import { LossCenterDashboard } from "../components/loss/LossCenterDashboard";
import { RequirePermission } from "../navigation/RequirePermission";

export function LossCenterPage() {
  return (
    <RequirePermission requires="reports.view">
      <div className="min-h-screen p-8">
        <LossCenterDashboard />
      </div>
    </RequirePermission>
  );
}