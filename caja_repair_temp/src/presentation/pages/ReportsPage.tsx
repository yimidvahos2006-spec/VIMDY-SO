import React from "react";
import { ReportsDashboard } from "../components/reports/ReportsDashboard";
import { RequirePermission } from "../navigation/RequirePermission";

export function ReportsPage() {
  return (
    <RequirePermission requires="reports.view">
      <div className="min-h-screen p-4 sm:p-8">
        <ReportsDashboard />
      </div>
    </RequirePermission>
  );
}