import React, { lazy, Suspense, useEffect, useState } from "react";
import { useLocation } from "react-router-dom";
import { ShoppingCart, Wallet, Receipt } from "lucide-react";

import { PosPage } from "./PosPage";
import { RequirePermission } from "../navigation/RequirePermission";
import { PosCustomer } from "../components/pos/PosCustomer";

// "Venta rápida" (PosPage) es la pestaña inicial y va en el paquete principal.
// "Turno" y "Ventas" se descargan aparte, y se precargan en segundo plano para
// que sigan funcionando aunque se caiga el internet después de abrir Caja.
const loadShiftPanel = () => import("../components/shift/ShiftPanel").then((m) => ({ default: m.ShiftPanel }));
const loadSalesHistoryPanel = () => import("../components/shift/SalesHistoryPanel").then((m) => ({ default: m.SalesHistoryPanel }));
const ShiftPanel = lazy(loadShiftPanel);
const SalesHistoryPanel = lazy(loadSalesHistoryPanel);

type Tab = "venta" | "turno" | "ventas";

function CashOperationsContent() {
  const location = useLocation();
  const initialTab = (location.state as { tab?: Tab })?.tab ?? "venta";
  const [tab, setTab] = useState<Tab>(initialTab);

  useEffect(() => {
    const preload = () => {
      void loadShiftPanel();
      void loadSalesHistoryPanel();
    };
    if (typeof window.requestIdleCallback === "function") {
      const id = window.requestIdleCallback(preload);
      return () => window.cancelIdleCallback(id);
    }
    const id = window.setTimeout(preload, 1500);
    return () => window.clearTimeout(id);
  }, []);

  return (
    <div className="h-screen flex flex-col overflow-hidden">
      {/* pr-[400px]: deja libre la franja donde flotan (position: fixed)
          la campana de notificaciones (right-80 = 320px desde el borde) y
          la insignia de usuario/ADMIN (right-6 = 24px desde el borde) —
          ver NotificationBell.tsx y UserSessionBadge.tsx. Mismo criterio
          que ya usa PosTopBar.tsx (pr-[230px]) para no quedar tapado por
          esos elementos flotantes. */}
      <div className="flex items-center justify-between gap-2 px-4 pt-4 pr-[400px]">
        <div className="flex items-center gap-2">
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

        {/* Botón de cliente reubicado acá (antes tarjeta completa dentro
            del carrito — ver PosCart.tsx). Solo tiene sentido en "Venta
            rápida", que es la pestaña donde se arma la venta actual;
            usePayment().customerId/customerName es el mismo store de
            siempre, así que seguir cambiando de pestaña no pierde el
            cliente elegido. */}
        {tab === "venta" && <PosCustomer compact />}
      </div>

      <div className="flex-1 min-h-0">
        {tab === "venta" && <PosPage />}
        <Suspense fallback={<div className="h-full w-full animate-pulse bg-vimdy-border/10" aria-hidden="true" />}>
          {tab === "turno" && <ShiftPanel />}
          {tab === "ventas" && <SalesHistoryPanel />}
        </Suspense>
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
          ? "bg-vimdy-surface text-vimdy-text border border-vimdy-border"
          : "text-vimdy-text-secondary hover:text-vimdy-text border border-transparent"
      }`}
    >
      {props.icon}
      {props.label}
    </button>
  );
}