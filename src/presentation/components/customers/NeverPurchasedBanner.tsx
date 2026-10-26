import React from "react";

import { CustomerWithStats } from "../../../core/store/useCustomers";

/**
 * Clientes registrados que todavía no han hecho ninguna compra pagada.
 * No se muestra nada si la lista viene vacía.
 */
export function NeverPurchasedBanner({
  customers,
  onSelect
}: {
  customers: CustomerWithStats[];
  onSelect: (customer: CustomerWithStats) => void;
}) {
  if (customers.length === 0) return null;

  return (
    <div className="rounded-2xl border border-amber-500/20 bg-amber-500/5 px-5 py-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <p className="text-amber-300 text-sm font-semibold">
            {customers.length === 1
              ? "1 cliente registrado todavía no ha comprado"
              : `${customers.length} clientes registrados todavía no han comprado`}
          </p>
          <p className="text-slate-400 text-xs mt-1">
            Buena oportunidad para una primera compra con un incentivo o recordatorio.
          </p>
        </div>
        <div className="flex flex-wrap gap-2 max-w-full">
          {customers.slice(0, 6).map((c) => (
            <button
              key={c.id}
              onClick={() => onSelect(c)}
              className="text-xs bg-amber-500/10 hover:bg-amber-500/20 border border-amber-500/25 text-amber-200 rounded-full px-3 py-1.5 transition"
            >
              {c.name}
            </button>
          ))}
          {customers.length > 6 && (
            <span className="text-xs text-slate-500 self-center">
              +{customers.length - 6} más
            </span>
          )}
        </div>
      </div>
    </div>
  );
}