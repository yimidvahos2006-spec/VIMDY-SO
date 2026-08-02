import React from "react";

import { PosTopBar } from "../components/pos/PosTopBar";
import { PosCategoriesPanel } from "../components/pos/PosCategoriesPanel";
import { PosProducts } from "../components/pos/PosProducts";
import { PosSalePanel } from "../components/pos/PosSalePanel";
import { PosStatusBar } from "../components/pos/PosStatusBar";
import { PosWeightEntryModal } from "../components/pos/PosWeightEntryModal";

export function PosPage() {
  return (
    <div className="h-full p-4 flex flex-col gap-4 overflow-hidden">

      <PosTopBar />

      <div className="grid grid-cols-[220px_1fr_360px] gap-4 flex-1 min-h-0">

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

      <PosStatusBar />

      {/* BLOQUEANTE (auditoría Fase 2 — Supermercado): un solo modal
          compartido, controlado por weightEntryStore. Se abre tanto desde
          PosTopBar (escaneo) como desde PosProducts (clic en tarjeta). */}
      <PosWeightEntryModal />

    </div>
  );
}