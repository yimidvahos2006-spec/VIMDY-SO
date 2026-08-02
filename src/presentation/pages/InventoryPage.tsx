import React from "react";
import { InventoryDashboard } from "../components/inventory/InventoryDashboard";
import { RequirePermission } from "../navigation/RequirePermission";

export const InventoryPage: React.FC = () => {
  return (
    <RequirePermission requires="inventory.view">
      <div className="min-h-screen p-8">
        <InventoryDashboard />
      </div>
    </RequirePermission>
  );
};