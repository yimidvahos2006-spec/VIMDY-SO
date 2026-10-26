import React from "react";
import { Search } from "lucide-react";

import { CustomerWithStats } from "../../../core/store/useCustomers";
import { useTranslation } from "../../../core/i18n/useTranslation";
import { LevelBadge } from "./LevelBadge";
import { CustomerSortableHeader } from "./CustomerSortableHeader";
import { SortDir, SortKey } from "./customerListing";

export function CustomerTable({
  customers,
  search,
  sortKey,
  sortDir,
  onSearchChange,
  onSort,
  onSelect
}: {
  customers: CustomerWithStats[];
  search: string;
  sortKey: SortKey;
  sortDir: SortDir;
  onSearchChange: (value: string) => void;
  onSort: (key: SortKey) => void;
  onSelect: (customer: CustomerWithStats) => void;
}) {
  const { money } = useTranslation();

  return (
    <div className="rounded-2xl border border-slate-700 bg-slate-800 overflow-hidden">
      <div className="p-4 border-b border-slate-700">
        <div className="relative">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
          <input
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder="Buscar por nombre, teléfono o correo..."
            className="w-full h-10 pl-9 pr-3 rounded-xl bg-vimdy-surface border border-slate-700 text-white text-sm placeholder:text-slate-500 focus:outline-none focus:border-cyan-500"
          />
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-slate-400 border-b border-slate-700">
              <CustomerSortableHeader label="Cliente" active={sortKey === "name"} dir={sortDir} onClick={() => onSort("name")} />
              <th className="px-4 py-3 font-medium">Contacto</th>
              <th className="px-4 py-3 font-medium">Nivel</th>
              <CustomerSortableHeader label="Puntos" active={sortKey === "points"} dir={sortDir} onClick={() => onSort("points")} />
              <CustomerSortableHeader label="Compras" active={sortKey === "purchases"} dir={sortDir} onClick={() => onSort("purchases")} />
              <CustomerSortableHeader label="Valor generado" active={sortKey === "ltv"} dir={sortDir} onClick={() => onSort("ltv")} />
            </tr>
          </thead>
          <tbody>
            {customers.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-10 text-center text-slate-500">
                  No se encontraron clientes.
                </td>
              </tr>
            )}
            {customers.map((customer) => (
              <tr
                key={customer.id}
                onClick={() => onSelect(customer)}
                className="border-b border-slate-800 hover:bg-slate-700/50 cursor-pointer transition-colors"
              >
                <td className="px-4 py-3 text-white font-medium">{customer.name}</td>
                <td className="px-4 py-3 text-slate-400">
                  {customer.phone || customer.email || "—"}
                </td>
                <td className="px-4 py-3">
                  <LevelBadge points={customer.points ?? 0} />
                </td>
                <td className="px-4 py-3 text-white">{(customer.points ?? 0).toLocaleString("es-CO")}</td>
                <td className="px-4 py-3 text-slate-300">{customer.purchaseCount}</td>
                <td className="px-4 py-3 text-cyan-400 font-semibold">{money(customer.ltv)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}