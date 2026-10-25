import React, { lazy, Suspense, useMemo, useState } from "react";
import { AlertTriangle, ChefHat, ClipboardCheck, Package, Trash2 } from "lucide-react";
import { InventoryCountModal } from "../components/inventory/InventoryCountModal";
import { DeleteItemsModal } from "../components/inventory/DeleteItemsModal";
import { InventoryDashboard } from "../components/inventory/InventoryDashboard";
import { InventorySummaryBar } from "../components/inventory/InventorySummaryBar";
import { NegativeStockReport } from "../components/inventory/NegativeStockReport";
import { isNegativeStock } from "../../core/utils/negativeStockReport";
import { RequirePermission } from "../navigation/RequirePermission";
import { useInventory } from "../../core/store/useInventory";

// El panel de insumos se descarga aparte.
const InsumosPanel = lazy(() =>
  import("../components/inventory/InsumosPanel").then((m) => ({ default: m.InsumosPanel }))
);

type Side = "insumos" | "productos" | "negativos";

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
  // Al tocar "Ver productos" se pide a la tabla que filtre por estado
  // (agotado/bajo). `nonce` hace que el pedido funcione aunque se repita.
  const [statusRequest, setStatusRequest] = useState<{ status: "bajo" | "agotado"; nonce: number } | null>(null);
  const goTo = (target: Side, status?: "bajo" | "agotado") => {
    setSide(target);
    if (status && target === "productos") setStatusRequest({ status, nonce: Date.now() });
  };
  const [showDelete, setShowDelete] = useState(false);
  const [showCount, setShowCount] = useState(false);
  const tabClass = (active: boolean) =>
    `flex-1 h-11 text-sm font-semibold rounded-vimdy-md transition flex items-center justify-center gap-2 ${
      active ? "bg-vimdy-accent text-vimdy-background" : "text-vimdy-text-secondary hover:text-vimdy-text"
    }`;

  const productCount = inventory.sellableProducts.filter((p) => p.active !== false).length;
  const insumoCount = inventory.insumos.filter((p) => p.active !== false).length;
  const negativeCount = useMemo(() => inventory.products.filter(isNegativeStock).length, [inventory.products]);

  return (
    <div className="min-h-screen p-4 sm:p-6 xl:p-8 space-y-5">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-3xl font-bold text-vimdy-text">Inventario</h1>
          <p className="text-vimdy-text-secondary text-sm mt-1">
            <span className="font-semibold text-vimdy-warning">Insumos</span>: lo que compras y guardas.{" "}
            <span className="font-semibold text-vimdy-accent">Productos</span>: lo que vendes en Caja.
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
        <button
          onClick={() => setShowCount(true)}
          className="h-10 px-4 rounded-vimdy-md border border-vimdy-border text-vimdy-text text-sm font-semibold flex items-center gap-2 hover:border-vimdy-accent hover:bg-vimdy-accent/10 transition"
        >
          <ClipboardCheck size={16} /> Contar inventario
        </button>
        <button
          onClick={() => setShowDelete(true)}
          className="h-10 px-4 rounded-vimdy-md border border-vimdy-danger/40 text-vimdy-danger text-sm font-semibold flex items-center gap-2 hover:bg-vimdy-danger/10 transition"
        >
          <Trash2 size={16} /> Eliminar producto
        </button>
        </div>
      </div>

      <InventorySummaryBar products={inventory.products} loading={inventory.loading} onGoTo={goTo} />

      <div className="flex gap-1 p-1 rounded-vimdy-lg border border-vimdy-border bg-vimdy-surface max-w-xl" role="tablist">
        <button role="tab" aria-selected={side === "productos"} onClick={() => setSide("productos")} className={tabClass(side === "productos")}>
          <Package size={16} /> Productos{!inventory.loading && <span className="opacity-80">({productCount})</span>}
        </button>
        <button role="tab" aria-selected={side === "insumos"} onClick={() => setSide("insumos")} className={tabClass(side === "insumos")}>
          <ChefHat size={16} /> Insumos{!inventory.loading && <span className="opacity-80">({insumoCount})</span>}
        </button>
        <button role="tab" aria-selected={side === "negativos"} onClick={() => setSide("negativos")} className={tabClass(side === "negativos")}>
          <AlertTriangle size={16} className={!inventory.loading && negativeCount > 0 && side !== "negativos" ? "text-vimdy-danger" : undefined} /> En negativo
          {!inventory.loading && (
            <span className={negativeCount > 0 && side !== "negativos" ? "font-bold text-vimdy-danger" : "opacity-80"}>({negativeCount})</span>
          )}
        </button>
      </div>

      <div>
        <section aria-label="Insumos" className={`${side === "insumos" ? "block" : "hidden"} min-w-0`}>
          <Suspense fallback={<Fallback />}>
            <InsumosPanel inventory={inventory} />
          </Suspense>
        </section>
        <section aria-label="Productos" className={`${side === "productos" ? "block" : "hidden"} min-w-0`}>
          <InventoryDashboard inventory={inventory} statusRequest={statusRequest} />
        </section>
        <section aria-label="En negativo" className={`${side === "negativos" ? "block" : "hidden"} min-w-0`}>
          <NegativeStockReport inventory={inventory} onRegularize={() => setShowCount(true)} />
        </section>
      </div>
      {showCount && <InventoryCountModal inventory={inventory} onClose={() => setShowCount(false)} />}
      {showDelete && <DeleteItemsModal inventory={inventory} initialKind={side === "insumos" ? "insumos" : "productos"} onClose={() => setShowDelete(false)} />}
    </div>
  );
};

export const InventoryPage: React.FC = () => (
  <RequirePermission requires="inventory.view">
    <InventoryContent />
  </RequirePermission>
);