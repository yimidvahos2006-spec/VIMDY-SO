import React from "react";
import { CustomerDashboard } from "../components/customers/CustomerDashboard";
import { RequirePermission } from "../navigation/RequirePermission";

export const CustomersPage: React.FC = () => {
  return (
    <RequirePermission requires="customers.view">
      <div className="min-h-screen p-8">
        <CustomerDashboard />
      </div>
    </RequirePermission>
  );
};