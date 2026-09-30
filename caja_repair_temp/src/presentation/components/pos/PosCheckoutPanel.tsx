import React from "react";
import { CircleDot, ArrowUpCircle, AlertTriangle, Receipt } from "lucide-react";

import { usePayment } from "../../../core/store/usePayment";
import { PosPayment } from "./PosPayment";
import { OrderPriority } from "../../../core/entities/Entities";
import { useTranslation } from "../../../core/i18n/useTranslation";
import { TranslationKey } from "../../../core/i18n/dictionaries";

/**
 * Mismas 3 opciones y mismo default (NORMAL) que usa Mesas en
 * TableDetailPanel — así toda comanda, venga de donde venga, llega a
 * Cocina con la misma prioridad "manual" (piso) que KitchenDashboard y
 * KitchenCard ya saben leer (order.priority ?? "NORMAL").
 */
const PRIORITY_OPTIONS: {
  value: OrderPriority;
  labelKey: TranslationKey;
  icon: React.ReactNode;
  activeClass: string;
}[] = [
  { value: "NORMAL", labelKey: "pos.checkout.priority.normal", icon: <CircleDot size={16} />, activeClass: "bg-vimdy-surface-active text-vimdy-text" },
  { value: "HIGH", labelKey: "pos.checkout.priority.high", icon: <ArrowUpCircle size={16} />, activeClass: "bg-vimdy-warning text-vimdy-background" },
  { value: "URGENT", labelKey: "pos.checkout.priority.urgent", icon: <AlertTriangle size={16} />, activeClass: "bg-vimdy-danger text-vimdy-background" }
];

/**
 * Contenido de la pestaña "Pago" dentro del panel combinado de Venta
 * actual. El total, el aviso de caja cerrada y el botón COBRAR viven
 * en PosSalePanel (son comunes a ambas pestañas, no solo a esta).
 */
export function PosCheckoutPanel() {

  const { priority, setPriority, requiresInvoice, setRequiresInvoice } = usePayment();
  const { t } = useTranslation();

  return (

    <div className="px-4 py-4 space-y-4">

      <div>
        <h3 className="text-vimdy-h3 text-vimdy-text mb-2">{t("pos.checkout.priorityTitle")}</h3>
        <div className="grid grid-cols-3 gap-2">
          {PRIORITY_OPTIONS.map((option) => {
            const active = option.value === priority;
            return (
              <button
                key={option.value}
                type="button"
                onClick={() => setPriority(option.value)}
                aria-pressed={active}
                className={`flex items-center justify-center gap-1.5 h-10 rounded-vimdy-md text-vimdy-small font-bold transition ${
                  active ? option.activeClass : "bg-vimdy-surface text-vimdy-text-secondary hover:bg-vimdy-surface-hover"
                }`}
              >
                {option.icon}
                {t(option.labelKey)}
              </button>
            );
          })}
        </div>
      </div>

      {/* Paso 7 — botón Cobrar inteligente: si esta venta necesita factura,
          el botón final de PosSalePanel cambia de "Cobrar" a
          "Pagar y facturar". */}
      <button
        type="button"
        onClick={() => setRequiresInvoice(!requiresInvoice)}
        aria-pressed={requiresInvoice}
        className={`w-full flex items-center justify-between gap-2 h-12 px-4 rounded-vimdy-md border-2 text-vimdy-small font-semibold transition ${
          requiresInvoice
            ? "bg-vimdy-accent/10 border-vimdy-accent/60 text-vimdy-accent-hover"
            : "bg-vimdy-surface text-vimdy-text-secondary border-vimdy-border hover:border-vimdy-accent/50"
        }`}
      >
        <span className="flex items-center gap-2">
          <Receipt size={16} />
          {t("pos.checkout.needsInvoice")}
        </span>
        <span
          className={`w-9 h-5 rounded-full relative transition-colors ${
            requiresInvoice ? "bg-vimdy-accent" : "bg-vimdy-border"
          }`}
        >
          <span
            className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-transform ${
              requiresInvoice ? "translate-x-4" : "translate-x-0.5"
            }`}
          />
        </span>
      </button>

      <PosPayment />

    </div>

  );

}