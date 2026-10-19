import React, { lazy, Suspense, useState } from "react";
import { InventoryDashboard } from "../components/inventory/InventoryDashboard";
import { RequirePermission } from "../navigation/RequirePermission";

// El panel de insumos solo se descarga si el usuario abre esa pestaña.
const InsumosPanel = lazy(() =>
  import("../components/inventory/InsumosPanel").then((m) => ({ default: m.InsumosPanel }))
);

type InventoryTab = "productos" | "insumos";

export const InventoryPage: React.FC = () => {
  const [tab, setTab] = useState<InventoryTab>("productos");

  return (
    <RequirePermission requires="inventory.view">
      <div className="min-h-screen p-8">
        <div className="flex gap-2 border-b border-vimdy-border mb-6">
          <button
            onClick={() => setTab("productos")}
            className={`px-4 py-2 text-sm font-semibold border-b-2 transition ${
              tab === "productos"
                ? "border-vimdy-accent text-vimdy-accent"
                : "border-transparent text-vimdy-text-secondary hover:text-vimdy-text"
            }`}
          >
            Productos
          </button>
          <button
            onClick={() => setTab("insumos")}
            className={`px-4 py-2 text-sm font-semibold border-b-2 transition ${
              tab === "insumos"
                ? "border-vimdy-accent text-vimdy-accent"
                : "border-transparent text-vimdy-text-secondary hover:text-vimdy-text"
            }`}
          >
            Insumos
          </button>
        </div>

        {tab === "productos" ? (
          <InventoryDashboard />
        ) : (
          <Suspense fallback={<div className="h-64 w-full animate-pulse rounded-vimdy-xl bg-vimdy-border/20" aria-hidden="true" />}>
            <InsumosPanel />
          </Suspense>
        )}
      </div>
    </RequirePermission>
  );
};