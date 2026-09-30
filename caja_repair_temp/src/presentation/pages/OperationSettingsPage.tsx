import React from "react";
import { OperationSettings } from "../components/settings/OperationSettings";
import { RequirePermission } from "../navigation/RequirePermission";

export const OperationSettingsPage: React.FC = () => {
  return (
    <RequirePermission requires="company.settings">
      <div className="min-h-screen p-8">
        <OperationSettings />
      </div>
    </RequirePermission>
  );
};
