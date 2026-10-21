import React, { lazy, Suspense, useState } from "react";
import { ChefHat, Package } from "lucide-react";
import { InventoryDashboard } from "../components/inventory/InventoryDashboard";
import { InventorySummaryBar } from "../components/inventory/InventorySummaryBar";
import { RequirePermission } from "../navigation/RequirePermission";
import { useInventory } from "../../core/store/useInventory";

// El panel de insumos se descarga aparte.
const InsumosPanel = lazy(() =>
  import("../components/inventory/InsumosPanel").then((m) => ({ default: m.InsumosPanel }))
);

type Side = "insumos" | "productos";

const Fallback = () => <div className="h-64 w-full animate-pulse rounded-vimdy-xl bg-vimdy-border/20" aria-hidden="true" />;

// El inventario se carga UNA sola vez aquí y se comparte con la barra de
// resumen y con los dos paneles: así los números de arriba y las tablas de
// abajo siempre salen de los mismos datos. Va dentro de RequirePermission
// para que quien no tiene permiso no dispare ninguna carga.
const InventoryContent: React.FC = () => {
  const inventory = useInventory();
  // Una sola columna en todas las pantallas (computador, tablet y celular):
  // dos pestañas, Insumos (lo que compras) y Productos (lo que vendes).
  // Los dos paneles siguen montados; solo se oculta el que no se está viendo,
  // así no se pierde lo que el usuario estaba haciendo al cambiar de pestaña.
  const [side, setSide] = useState<Side>("productos");
  const tabClass = (active: boolean) =>
    `flex-1 h-11 text-sm font-semibold rounded-vimdy-md transition flex items-center justify-center gap-2 ${
      active ? "bg-vimdy-accent text-vimdy-background" : "text-vimdy-text-secondary hover:text-vimdy-text"
    }`;

  const productCount = inventory.sellableProducts.filter((p) => p.active !== false).length;
  const insumoCount = inventory.insumos.filter((p) => p.active !== false).length;

  return (
    <div className="min-h-screen p-4 sm:p-6 xl:p-8 space-y-5">
      <div>
        <h1 className="text-3xl font-bold text-vimdy-text">Inventario</h1>
        <p className="text-vimdy-text-secondary text-sm mt-1">
          <span className="font-semibold text-vimdy-warning">Insumos</span>: lo que compras y guardas.{" "}
          <span className="font-semibold text-vimdy-accent">Productos</span>: lo que vendes en Caja.
        </p>
      </div>

      <InventorySummaryBar products={inventory.products} loading={inventory.loading} onGoTo={setSide} />

      <div className="flex gap-1 p-1 rounded-vimdy-lg border border-vimdy-border bg-vimdy-surface max-w-md" role="tablist">
        <button role="tab" aria-selected={side === "productos"} onClick={() => setSide("productos")} className={tabClass(side === "productos")}>
          <Package size={16} /> Productos{!inventory.loading && <span className="opacity-80">({productCount})</span>}
        </button>
        <button role="tab" aria-selected={side === "insumos"} onClick={() => setSide("insumos")} className={tabClass(side === "insumos")}>
          <ChefHat size={16} /> Insumos{!inventory.loading && <span className="opacity-80">({insumoCount})</span>}
        </button>
      </div>

      <div>
        <section aria-label="Insumos" className={`${side === "insumos" ? "block" : "hidden"} min-w-0`}>
          <Suspense fallback={<Fallback />}>
            <InsumosPanel inventory={inventory} />
          </Suspense>
        </section>
        <section aria-label="Productos" className={`${side === "productos" ? "block" : "hidden"} min-w-0`}>
          <InventoryDashboard inventory={inventory} />
        </section>
      </div>
    </div>
  );
};

export const InventoryPage: React.FC = () => (
  <RequirePermission requires="inventory.view">
    <InventoryContent />
  </RequirePermission>
);