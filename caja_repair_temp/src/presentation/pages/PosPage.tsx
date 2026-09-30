import React, { useState } from "react";

import { PosTopBar } from "../components/pos/PosTopBar";
import { PosCategoriesPanel } from "../components/pos/PosCategoriesPanel";
import { PosProducts } from "../components/pos/PosProducts";
import { PosSalePanel } from "../components/pos/PosSalePanel";
import { PosStatusBar } from "../components/pos/PosStatusBar";
import { PosWeightEntryModal } from "../components/pos/PosWeightEntryModal";
import { PosVariantSelectorModal } from "../components/pos/PosVariantSelectorModal";
import { ShoppingCart, PackageOpen } from "lucide-react";

export function PosPage() {
  const [mobileTab, setMobileTab] = useState<"products" | "cart">("products");

  return (
    <div className="h-full flex flex-col overflow-hidden">

      <PosTopBar />

      {/* Mobile tab switcher - hidden on desktop */}
      <div className="flex md:hidden border-b border-vimdy-border bg-vimdy-background">
        <button
          onClick={() => setMobileTab("products")}
          className={`flex-1 flex items-center justify-center gap-2 h-12 text-sm font-bold transition ${
            mobileTab === "products"
              ? "text-vimdy-accent border-b-2 border-vimdy-accent"
              : "text-vimdy-text-secondary"
          }`}
        >
          <PackageOpen size={18} />
          Productos
        </button>
        <button
          onClick={() => setMobileTab("cart")}
          className={`flex-1 flex items-center justify-center gap-2 h-12 text-sm font-bold transition relative ${
            mobileTab === "cart"
              ? "text-vimdy-accent border-b-2 border-vimdy-accent"
              : "text-vimdy-text-secondary"
          }`}
        >
          <ShoppingCart size={18} />
          Venta actual
        </button>
      </div>

      {/* Desktop: 3 columns. Mobile: single column with tabs */}
      <div className="flex-1 min-h-0 overflow-hidden">
        {/* Desktop layout */}
        <div className="hidden md:grid grid-cols-[180px_1fr_280px] lg:grid-cols-[220px_1fr_360px] gap-4 h-full">
          {/* Columna 1: Categorías */}
          <div className="min-h-0 bg-vimdy-surface border border-vimdy-border rounded-vimdy-lg overflow-hidden">
            <PosCategoriesPanel />
          </div>

          {/* Columna 2: Productos */}
          <div className="min-h-0 bg-vimdy-surface border border-vimdy-border rounded-vimdy-lg p-4 overflow-y-auto">
            <PosProducts />
          </div>

          {/* Columna 3: Venta actual (Carrito + Pago combinados) */}
          <div className="min-h-0 bg-vimdy-surface border border-vimdy-border rounded-vimdy-lg overflow-hidden">
            <PosSalePanel />
          </div>
        </div>

        {/* Mobile layout */}
        <div className="md:hidden h-full flex flex-col">
          {mobileTab === "products" ? (
            <div className="flex-1 min-h-0 flex flex-col">
              {/* Categories as horizontal scroll on mobile */}
              <div className="bg-vimdy-surface border-b border-vimdy-border px-2 py-2 flex-shrink-0">
                <PosCategoriesPanel />
              </div>
              <div className="flex-1 min-h-0 bg-vimdy-surface p-3 overflow-y-auto">
                <PosProducts />
              </div>
            </div>
          ) : (
            <div className="flex-1 min-h-0 bg-vimdy-surface overflow-y-auto">
              <PosSalePanel />
            </div>
          )}
        </div>
      </div>

      <PosStatusBar />

      {/* BLOQUEANTE (auditoría Fase 2 — Supermercado): un solo modal
          compartido, controlado por weightEntryStore. Se abre tanto desde
          PosTopBar (escaneo) como desde PosProducts (clic en tarjeta). */}
      <PosWeightEntryModal />

      {/* PENDIENTE #1 de Pre-Lanzamiento (auditoría ago 2026): un solo modal
          compartido, controlado por variantSelectorStore. Se abre tanto
          desde PosProducts (clic en tarjeta) como desde PosTopBar
          (escaneo), solo para productos con tamaños/extras configurados. */}
      <PosVariantSelectorModal />

    </div>
  );
}