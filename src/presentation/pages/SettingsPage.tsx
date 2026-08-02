import React from "react";
import { SettingsDashboard } from "../components/settings/SettingsDashboard";
import { RequirePermission } from "../navigation/RequirePermission";

export function SettingsPage() {
  return (
    <RequirePermission requires="company.settings">
      <div className="min-h-screen p-8">
        <SettingsDashboard />
      </div>
    </RequirePermission>
  );
}