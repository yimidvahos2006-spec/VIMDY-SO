import React, { lazy, Suspense, useState } from "react";
import { ChefHat, Package, ArrowRight } from "lucide-react";
import { InventoryDashboard } from "../components/inventory/InventoryDashboard";
import { RequirePermission } from "../navigation/RequirePermission";

// El panel de insumos se descarga aparte.
const InsumosPanel = lazy(() =>
  import("../components/inventory/InsumosPanel").then((m) => ({ default: m.InsumosPanel }))
);

type Side = "insumos" | "productos";

const Fallback = () => <div className="h-64 w-full animate-pulse rounded-vimdy-xl bg-vimdy-border/20" aria-hidden="true" />;

export const InventoryPage: React.FC = () => {
  // En pantallas anchas (xl) se ven los dos paneles a la vez; en pantallas
  // chicas se alterna con pestañas.
  const [side, setSide] = useState<Side>("productos");
  const tabClass = (active: boolean) =>
    `flex-1 h-11 text-sm font-semibold rounded-vimdy-md transition flex items-center justify-center gap-2 ${
      active ? "bg-vimdy-accent text-vimdy-background" : "text-vimdy-text-secondary hover:text-vimdy-text"
    }`;

  return (
    <RequirePermission requires="inventory.view">
      <div className="min-h-screen p-4 sm:p-6 xl:p-8 space-y-5">
        <div>
          <h1 className="text-3xl font-bold text-vimdy-text">Inventario</h1>
          <p className="text-vimdy-text-secondary text-sm mt-1 flex items-center gap-2 flex-wrap">
            <span className="font-semibold text-vimdy-warning">Insumos</span>
            <ArrowRight size={14} />
            <span className="font-semibold text-vimdy-recipe">Recetas</span>
            <ArrowRight size={14} />
            <span className="font-semibold text-vimdy-accent">Productos de venta</span>
            <span className="text-vimdy-text-tertiary">· Los insumos nunca se venden directo: alimentan las recetas.</span>
          </p>
        </div>

        <div className="xl:hidden flex gap-1 p-1 rounded-vimdy-lg border border-vimdy-border bg-vimdy-surface" role="tablist">
          <button role="tab" aria-selected={side === "insumos"} onClick={() => setSide("insumos")} className={tabClass(side === "insumos")}>
            <ChefHat size={16} /> Ingredientes
          </button>
          <button role="tab" aria-selected={side === "productos"} onClick={() => setSide("productos")} className={tabClass(side === "productos")}>
            <Package size={16} /> Productos de venta
          </button>
        </div>

        <div className="grid grid-cols-1 xl:grid-cols-2 gap-6 items-start">
          <section aria-label="Ingredientes y materia prima" className={`${side === "insumos" ? "block" : "hidden"} xl:block min-w-0`}>
            <Suspense fallback={<Fallback />}>
              <InsumosPanel />
            </Suspense>
          </section>
          <section aria-label="Productos de venta" className={`${side === "productos" ? "block" : "hidden"} xl:block min-w-0 xl:border-l xl:border-vimdy-border xl:pl-6`}>
            <InventoryDashboard />
          </section>
        </div>
      </div>
    </RequirePermission>
  );
};
