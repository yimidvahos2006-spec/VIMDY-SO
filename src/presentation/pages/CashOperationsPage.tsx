import React, { useState } from "react";
import { ShoppingCart, Wallet, Receipt } from "lucide-react";

import { PosPage } from "./PosPage";
import { ShiftPanel } from "../components/shift/ShiftPanel";
import { SalesHistoryPanel } from "../components/shift/SalesHistoryPanel";
import { RequirePermission } from "../navigation/RequirePermission";

type Tab = "venta" | "turno" | "ventas";

/**
 * Antes, "/caja" mostraba directamente PosPage y la pantalla real de
 * apertura/cierre de caja (CashModule) vivía sin ruta, leyendo además
 * de un store falso desconectado de las ventas. Ahora ambas vistas
 * comparten la misma ruta y el mismo motor de datos (ShiftEngine /
 * CashEngine), así que lo que se cobra en Venta rápida sí aparece en
 * el arqueo del turno.
 */
function CashOperationsContent() {
  const [tab, setTab] = useState<Tab>("venta");

  return (
    <div className="h-screen flex flex-col overflow-hidden">
      <div className="flex items-center gap-2 px-4 pt-4">
        <TabButton
          active={tab === "venta"}
          onClick={() => setTab("venta")}
          icon={<ShoppingCart className="w-4 h-4" />}
          label="Venta rápida"
        />
        <TabButton
          active={tab === "turno"}
          onClick={() => setTab("turno")}
          icon={<Wallet className="w-4 h-4" />}
          label="Turno de caja"
        />
        <TabButton
          active={tab === "ventas"}
          onClick={() => setTab("ventas")}
          icon={<Receipt className="w-4 h-4" />}
          label="Ventas"
        />
      </div>

      <div className="flex-1 min-h-0">
        {tab === "venta" && <PosPage />}
        {tab === "turno" && <ShiftPanel />}
        {tab === "ventas" && <SalesHistoryPanel />}
      </div>
    </div>
  );
}

export function CashOperationsPage() {
  return (
    <RequirePermission requires="cash.view">
      <CashOperationsContent />
    </RequirePermission>
  );
}

function TabButton(props: { active: boolean; onClick: () => void; icon: React.ReactNode; label: string }) {
  return (
    <button
      onClick={props.onClick}
      className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium transition-colors ${
        props.active
          ? "bg-vimdy-surface text-emerald-400 border border-slate-800"
          : "text-slate-500 hover:text-slate-300 border border-transparent"
      }`}
    >
      {props.icon}
      {props.label}
    </button>
  );
}