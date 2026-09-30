import React from "react";
import { SmartPurchasingDashboard } from "../components/purchasing/SmartPurchasingDashboard";
import { RequirePermission } from "../navigation/RequirePermission";

export function SmartPurchasingPage() {
  return (
    <RequirePermission requires="reports.view">
      <div className="min-h-screen p-8">
        <SmartPurchasingDashboard />
      </div>
    </RequirePermission>
  );
}