import React, { useEffect, useState } from "react";
import { Star, X, Pencil, Trash2, Receipt, Phone, Mail, Calendar, Loader2 } from "lucide-react";

import { getLoyaltyInfo, CustomerWithStats } from "../../../core/store/useCustomers";
import { Sale } from "../../../core/entities/Entities";
import { getSaleNetTotal } from "../../../core/utils/saleRefunds";
import { useTranslation } from "../../../core/i18n/useTranslation";
import { LEVEL_ICON } from "./LevelBadge";

export function CustomerDetailModal({
  customer,
  fetchSales,
  getProductName,
  onClose,
  onEdit,
  onDelete
}: {
  customer: CustomerWithStats;
  fetchSales: (customerId: string) => Promise<Sale[]>;
  getProductName: (id: string) => string;
  onClose: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const { money } = useTranslation();
  const level = getLoyaltyInfo(customer.points ?? 0);
  const Icon = LEVEL_ICON[level.level];

  // FASE 3 (Optimización): el historial de compras de este cliente ya no
  // viene precargado desde afuera — se pide justo al abrir la ficha, y
  // mientras tanto se muestra un estado de carga real (spinner), no un
  // "Cargando..." mudo ni, peor, una lista vacía que parece decir "sin
  // compras" cuando en realidad todavía no llegó la respuesta.
  const [sales, setSales] = useState<Sale[] | null>(null);
  const [salesError, setSalesError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setSales(null);
    setSalesError(false);

    fetchSales(customer.id)
      .then((result) => {
        if (!cancelled) setSales(result);
      })
      .catch(() => {
        if (!cancelled) setSalesError(true);
      });

    return () => {
      cancelled = true;
    };
  }, [customer.id, fetchSales]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg max-h-[85vh] overflow-y-auto rounded-2xl bg-vimdy-surface border border-slate-700 p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 mb-4">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-14 h-14 rounded-full bg-cyan-500 flex items-center justify-center flex-shrink-0 text-slate-950 font-bold text-xl">
              {customer.name.charAt(0).toUpperCase()}
            </div>
            <div className="min-w-0">
              <h3 className="text-white font-bold text-lg truncate">{customer.name}</h3>
              <div className="flex items-center gap-1.5 mt-1">
                <Icon size={13} className="text-yellow-400" />
                <span className="text-slate-300 text-xs font-semibold">Cliente {level.label}</span>
                <div className="flex items-center gap-0.5 ml-1">
                  {Array.from({ length: 5 }).map((_, i) => (
                    <Star
                      key={i}
                      size={11}
                      className={i < level.stars ? "text-yellow-400 fill-yellow-400" : "text-slate-600"}
                    />
                  ))}
                </div>
              </div>
            </div>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-white flex-shrink-0">
            <X size={20} />
          </button>
        </div>

        <div className="grid grid-cols-3 gap-3 mb-4">
          <MiniStat label="Puntos" value={(customer.points ?? 0).toLocaleString("es-CO")} />
          <MiniStat label="Compras" value={customer.purchaseCount.toString()} />
          <MiniStat label="Valor total" value={money(customer.ltv)} />
        </div>

        <div className="space-y-2 mb-4 text-sm">
          {customer.phone && (
            <div className="flex items-center gap-2 text-slate-300">
              <Phone size={14} className="text-slate-500" />
              {customer.phone}
            </div>
          )}
          {customer.email && (
            <div className="flex items-center gap-2 text-slate-300">
              <Mail size={14} className="text-slate-500" />
              {customer.email}
            </div>
          )}
          {customer.documentNumber && (
            <div className="flex items-center gap-2 text-slate-300">
              <Receipt size={14} className="text-slate-500" />
              {customer.documentType ?? "Documento"}: {customer.documentNumber}
            </div>
          )}
          {customer.lastPurchaseAt && (
            <div className="flex items-center gap-2 text-slate-300">
              <Calendar size={14} className="text-slate-500" />
              Última compra: {customer.lastPurchaseAt.toLocaleDateString("es-CO")}
            </div>
          )}
        </div>

        <div className="flex gap-2 mb-4">
          <button
            onClick={onEdit}
            className="flex-1 flex items-center justify-center gap-2 h-10 rounded-xl bg-slate-800 border border-slate-700 hover:border-cyan-500 text-white text-sm font-semibold transition"
          >
            <Pencil size={14} />
            Editar
          </button>
          <button
            onClick={onDelete}
            className="flex-1 flex items-center justify-center gap-2 h-10 rounded-xl bg-red-500/10 border border-red-500/30 hover:bg-red-500/20 text-red-300 text-sm font-semibold transition"
          >
            <Trash2 size={14} />
            Eliminar
          </button>
        </div>

        <div>
          <div className="flex items-center gap-2 text-slate-400 text-xs font-semibold uppercase tracking-wide mb-2">
            <Receipt size={13} />
            Historial de compras
          </div>
          {sales === null ? (
            <div className="flex items-center justify-center gap-2 py-6 text-slate-400 text-sm">
              <Loader2 size={16} className="animate-spin" />
              Cargando historial...
            </div>
          ) : salesError ? (
            <p className="text-red-300 text-sm py-4 text-center">
              No se pudo cargar el historial. Intenta de nuevo.
            </p>
          ) : sales.length === 0 ? (
            <p className="text-slate-500 text-sm py-4 text-center">
              Este cliente aún no tiene compras registradas.
            </p>
          ) : (
            <div className="space-y-2 max-h-56 overflow-y-auto pr-1">
              {sales.map((sale) => (
                <div
                  key={sale.id}
                  className="rounded-xl border border-slate-800 bg-slate-800/60 px-3 py-2.5"
                >
                  <div className="flex items-center justify-between">
                    <span className="text-white text-sm font-semibold">
                      {sale.code ?? sale.id.slice(0, 8)}
                    </span>
                    <span className="text-cyan-400 text-sm font-bold">{money(getSaleNetTotal(sale))}</span>
                  </div>
                  <div className="flex items-center justify-between mt-1">
                    <span className="text-slate-500 text-xs">
                      {new Date(sale.createdAt).toLocaleString("es-CO")}
                    </span>
                    <span className="text-slate-500 text-xs">
                      {sale.items.length} {sale.items.length === 1 ? "producto" : "productos"}
                    </span>
                  </div>
                  <p className="text-slate-400 text-xs mt-1 truncate">
                    {sale.items.map((item) => getProductName(item.productId)).join(", ")}
                  </p>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl bg-slate-800 border border-slate-700 px-3 py-2.5 text-center">
      <p className="text-white font-bold text-sm truncate">{value}</p>
      <p className="text-slate-500 text-xs mt-0.5">{label}</p>
    </div>
  );
}