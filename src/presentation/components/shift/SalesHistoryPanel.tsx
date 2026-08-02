import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  Search,
  Receipt,
  Loader2,
  RotateCcw,
  ChevronDown,
  ChevronUp,
  CheckCircle2,
  XCircle,
  Ban
} from "lucide-react";

import { container } from "../../../infrastructure/di/CompositionRoot";
import { useAuth } from "../../context/AuthContext";
import { useTranslation } from "../../../core/i18n/useTranslation";
import { formatMoney } from "../../../core/utils/formatMoney";
import { companyConfigStore } from "../../../core/store/companyConfigStore";
import { translateBusinessError } from "../../../core/errors/translateBusinessError";
import { toast } from "../../../core/store/toastStore";
import type { Sale, SaleStatus } from "../../../core/entities/Entities";

const STATUS_LABELS: Record<SaleStatus, string> = {
  PENDING_PAYMENT: "Pendiente de pago",
  PAID: "Pagada",
  CLOSED: "Cerrada",
  CANCELLED: "Cancelada",
  REFUNDED: "Reembolsada",
  OPEN: "Abierta"
};

const STATUS_STYLE: Record<SaleStatus, string> = {
  PENDING_PAYMENT: "bg-amber-500/15 text-amber-400",
  PAID: "bg-emerald-500/15 text-emerald-400",
  CLOSED: "bg-emerald-500/15 text-emerald-400",
  CANCELLED: "bg-slate-500/15 text-slate-400",
  REFUNDED: "bg-red-500/15 text-red-400",
  OPEN: "bg-sky-500/15 text-sky-400"
};

const PAYMENT_METHOD_LABELS: Record<string, string> = {
  CASH: "Efectivo",
  CARD: "Tarjeta",
  TRANSFER: "Transferencia",
  QR: "QR",
  MIXED: "Mixto"
};

/**
 * Historial de ventas + reembolso.
 *
 * Antes de este panel, SalesEngine.refundSale() ya existía y funcionaba
 * (revierte el pago, restituye inventario, registra el egreso en caja y
 * marca la venta como REFUNDED) pero no estaba conectado a NINGÚN botón
 * ni pantalla: un cajero no tenía forma de buscar una venta pasada ni de
 * reembolsarla desde la UI (bloqueante #3 de la auditoría). Este panel
 * cierra ese hueco: buscar -> ver detalle -> reembolsar, con motivo
 * obligatorio y permiso "sales.refund".
 *
 * Hay dos flujos de reembolso, cada uno conectado a su método real del
 * motor:
 *   - "Reembolsar todo" -> SalesEngine.refundSale() (venta completa,
 *     como siempre).
 *   - "Reembolso parcial" -> SalesEngine.partialRefundSale() (elegís
 *     cantidad por producto; prorratea impuesto/descuento y solo repone
 *     al inventario lo que efectivamente se devuelve). Se puede repetir
 *     varias veces sobre la misma venta mientras queden unidades sin
 *     devolver — SalesEngine.getRefundableQuantities() calcula cuánto
 *     queda de cada producto sumando los reembolsos parciales previos.
 */
export function SalesHistoryPanel() {
  const { user, can } = useAuth();
  const { language } = useTranslation();

  const [sales, setSales] = useState<Sale[]>([]);
  const [productNames, setProductNames] = useState<Record<string, string>>({});
  const [customerNames, setCustomerNames] = useState<Record<string, string>>({});
  const [query, setQuery] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [refundTarget, setRefundTarget] = useState<Sale | null>(null);
  const [refundReason, setRefundReason] = useState("");
  const [isRefunding, setIsRefunding] = useState(false);

  const [partialTarget, setPartialTarget] = useState<Sale | null>(null);
  const [partialReason, setPartialReason] = useState("");
  const [partialQuantities, setPartialQuantities] = useState<Record<string, number>>({});
  const [isPartialRefunding, setIsPartialRefunding] = useState(false);

  const money = useCallback(
    (value: number) => formatMoney(value, companyConfigStore.get().currency, language),
    [language]
  );

  const canRefund = can("sales.refund");

  const loadSales = useCallback(async () => {
    setIsLoading(true);
    try {
      const [allSales, products, customers] = await Promise.all([
        container.salesEngine.getAllSales(),
        container.inventoryEngine.listAll(),
        container.customerEngine.getAllCustomers()
      ]);

      const sorted = [...allSales].sort(
        (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
      );

      setSales(sorted);
      setProductNames(
        Object.fromEntries(products.map(product => [product.id, product.name]))
      );
      setCustomerNames(
        Object.fromEntries(customers.map(customer => [customer.id, customer.name]))
      );
    } catch (err) {
      toast.error(translateBusinessError(err, "No se pudo cargar el historial de ventas."));
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadSales();
  }, [loadSales]);

  const filteredSales = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return sales;

    return sales.filter(sale => {
      const customerName = customerNames[sale.customerId]?.toLowerCase() ?? "";
      return (
        sale.id.toLowerCase().includes(normalized) ||
        (sale.code?.toLowerCase().includes(normalized) ?? false) ||
        sale.customerId.toLowerCase().includes(normalized) ||
        customerName.includes(normalized) ||
        (sale.notes?.toLowerCase().includes(normalized) ?? false)
      );
    });
  }, [sales, query, customerNames]);

  function canBeRefunded(sale: Sale): boolean {
    return sale.status === "PAID" || sale.status === "CLOSED";
  }

  /**
   * Si la venta ya tuvo al menos un reembolso parcial, el botón de
   * "Reembolsar todo" se oculta: refundSale() no sabe de reembolsos
   * parciales previos y repondría a inventario TODOS los ítems otra
   * vez, aunque ya se hubiera repuesto una parte. En ese caso, la
   * única forma segura de terminar de cerrar la venta es seguir
   * usando el reembolso parcial (precargado con lo que quede).
   */
  function hasPartialRefunds(sale: Sale): boolean {
    return (sale.refunds?.length ?? 0) > 0;
  }

  function refundableQuantities(sale: Sale): Record<string, number> {
    return container.salesEngine.getRefundableQuantities(sale);
  }

  function openRefund(sale: Sale) {
    setRefundReason("");
    setRefundTarget(sale);
  }

  function openPartialRefund(sale: Sale) {
    setPartialReason("");
    setPartialQuantities({});
    setPartialTarget(sale);
  }

  function setPartialQuantity(productId: string, quantity: number, max: number) {
    const clamped = Math.max(0, Math.min(quantity, max));
    setPartialQuantities(prev => ({ ...prev, [productId]: clamped }));
  }

  async function confirmPartialRefund() {
    if (!partialTarget) return;

    const reason = partialReason.trim();
    if (!reason) {
      toast.error("Escribe un motivo para poder reembolsar.");
      return;
    }

    const items = Object.entries(partialQuantities)
      .filter(([, quantity]) => quantity > 0)
      .map(([productId, quantity]) => ({ productId, quantity }));

    if (items.length === 0) {
      toast.error("Elegí al menos un producto y una cantidad para devolver.");
      return;
    }

    setIsPartialRefunding(true);
    try {
      const result = await container.salesEngine.partialRefundSale(
        partialTarget.id,
        items,
        reason,
        user?.id
      );
      toast.success(
        `Reembolso parcial de ${money(result.amount)} aplicado a ${
          partialTarget.code ?? partialTarget.id
        }.`
      );
      setPartialTarget(null);
      await loadSales();
    } catch (err) {
      toast.error(translateBusinessError(err, "No se pudo aplicar el reembolso parcial."));
    } finally {
      setIsPartialRefunding(false);
    }
  }

  async function confirmRefund() {
    if (!refundTarget) return;

    const reason = refundReason.trim();
    if (!reason) {
      toast.error("Escribe un motivo para poder reembolsar.");
      return;
    }

    setIsRefunding(true);
    try {
      await container.salesEngine.refundSale(refundTarget.id, reason, user?.id);
      toast.success(`Venta ${refundTarget.code ?? refundTarget.id} reembolsada.`);
      setRefundTarget(null);
      await loadSales();
    } catch (err) {
      toast.error(translateBusinessError(err, "No se pudo reembolsar la venta."));
    } finally {
      setIsRefunding(false);
    }
  }

  return (
    <div className="h-full flex flex-col p-4 sm:p-6 gap-4 overflow-hidden">
      <div className="flex items-center gap-3">
        <div className="relative flex-1 max-w-md">
          <Search
            size={16}
            className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500"
          />
          <input
            value={query}
            onChange={event => setQuery(event.target.value)}
            placeholder="Buscar por código, cliente o nota..."
            className="w-full h-10 pl-9 pr-3 rounded-xl bg-slate-900/60 border border-slate-800 text-sm text-slate-200 placeholder:text-slate-500 focus:outline-none focus:border-emerald-500/60"
          />
        </div>
        <span className="text-xs text-slate-500">
          {filteredSales.length} venta{filteredSales.length === 1 ? "" : "s"}
        </span>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto rounded-2xl border border-slate-800 bg-vimdy-surface">
        {isLoading ? (
          <div className="flex items-center justify-center h-40 text-slate-500 gap-2">
            <Loader2 size={18} className="animate-spin" />
            Cargando ventas...
          </div>
        ) : filteredSales.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-40 text-slate-500 gap-2">
            <Receipt size={22} />
            <span className="text-sm">No se encontraron ventas.</span>
          </div>
        ) : (
          <ul className="divide-y divide-slate-800">
            {filteredSales.map(sale => {
              const isExpanded = expandedId === sale.id;
              const status = sale.status ?? "PAID";
              const customerName = customerNames[sale.customerId] ?? "Cliente general";

              return (
                <li key={sale.id}>
                  <button
                    type="button"
                    onClick={() => setExpandedId(isExpanded ? null : sale.id)}
                    className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-slate-800/40 transition-colors"
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-semibold text-slate-100 truncate">
                          {sale.code ?? sale.id}
                        </span>
                        <span
                          className={`text-[11px] font-medium px-2 py-0.5 rounded-full shrink-0 ${STATUS_STYLE[status]}`}
                        >
                          {STATUS_LABELS[status]}
                        </span>
                      </div>
                      <div className="text-xs text-slate-500 truncate">
                        {customerName} ·{" "}
                        {new Date(sale.createdAt).toLocaleString(
                          language === "en" ? "en-US" : "es-CO",
                          { dateStyle: "short", timeStyle: "short" }
                        )}
                      </div>
                    </div>
                    <span className="text-sm font-semibold text-slate-200 shrink-0">
                      {money(sale.total)}
                    </span>
                    {isExpanded ? (
                      <ChevronUp size={16} className="text-slate-500 shrink-0" />
                    ) : (
                      <ChevronDown size={16} className="text-slate-500 shrink-0" />
                    )}
                  </button>

                  {isExpanded && (
                    <div className="px-4 pb-4">
                      <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-3 space-y-3">
                        <ul className="space-y-1.5">
                          {(() => {
                            const refundedQuantities =
                              container.salesEngine.getRefundedQuantities(sale);

                            return sale.items.map((item, index) => {
                              const refundedQty = refundedQuantities[item.productId] ?? 0;

                              return (
                                <li
                                  key={`${sale.id}-${item.productId}-${index}`}
                                  className="flex items-center justify-between text-sm text-slate-300"
                                >
                                  <span className="truncate">
                                    {item.quantity}× {productNames[item.productId] ?? "Producto"}
                                    {refundedQty > 0 && (
                                      <span className="text-amber-400 text-xs ml-1.5">
                                        ({refundedQty} devuelta{refundedQty === 1 ? "" : "s"})
                                      </span>
                                    )}
                                  </span>
                                  <span className="text-slate-400 shrink-0">
                                    {money(item.price * item.quantity)}
                                  </span>
                                </li>
                              );
                            });
                          })()}
                        </ul>

                        <div className="border-t border-slate-800 pt-3 flex items-center justify-between text-xs text-slate-500">
                          <span>
                            {PAYMENT_METHOD_LABELS[sale.paymentMethod ?? ""] ??
                              sale.paymentMethod ??
                              "—"}
                          </span>
                          <span>Total {money(sale.total)}</span>
                        </div>

                        {sale.notes && (
                          <p className="text-xs text-slate-500 whitespace-pre-line">
                            {sale.notes}
                          </p>
                        )}

                        <div className="flex items-center justify-end gap-2 pt-1">
                          {canBeRefunded(sale) ? (
                            canRefund ? (
                              <>
                                <button
                                  type="button"
                                  onClick={() => openPartialRefund(sale)}
                                  className="flex items-center gap-1.5 h-9 px-3 rounded-lg text-sm font-medium bg-amber-500/10 text-amber-400 hover:bg-amber-500/20 transition-colors"
                                >
                                  <RotateCcw size={14} />
                                  Reembolso parcial
                                </button>
                                {!hasPartialRefunds(sale) && (
                                  <button
                                    type="button"
                                    onClick={() => openRefund(sale)}
                                    className="flex items-center gap-1.5 h-9 px-3 rounded-lg text-sm font-medium bg-red-500/10 text-red-400 hover:bg-red-500/20 transition-colors"
                                  >
                                    <RotateCcw size={14} />
                                    Reembolsar todo
                                  </button>
                                )}
                              </>
                            ) : (
                              <span className="flex items-center gap-1.5 text-xs text-slate-500">
                                <Ban size={13} />
                                No tienes permiso para reembolsar
                              </span>
                            )
                          ) : status === "REFUNDED" ? (
                            <span className="flex items-center gap-1.5 text-xs text-red-400">
                              <XCircle size={13} />
                              Ya fue reembolsada
                            </span>
                          ) : (
                            <span className="flex items-center gap-1.5 text-xs text-slate-500">
                              <CheckCircle2 size={13} />
                              No se puede reembolsar en este estado
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {refundTarget && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 p-4"
          onClick={() => !isRefunding && setRefundTarget(null)}
        >
          <div
            className="w-full max-w-sm rounded-2xl border border-slate-700 bg-slate-800 p-6"
            onClick={event => event.stopPropagation()}
          >
            <h2 className="text-slate-100 font-semibold text-base mb-1">
              Reembolsar venta {refundTarget.code ?? refundTarget.id}
            </h2>
            <p className="text-slate-400 text-sm mb-4">
              Se revertirá el pago ({money(refundTarget.total)}), se devolverá el
              inventario y quedará registrado como egreso en el turno de caja.
              Esta acción no se puede deshacer.
            </p>

            <label className="block text-xs font-medium text-slate-400 mb-1.5">
              Motivo del reembolso
            </label>
            <textarea
              value={refundReason}
              onChange={event => setRefundReason(event.target.value)}
              placeholder="Ej. Cliente devolvió el producto, pedido equivocado..."
              rows={3}
              autoFocus
              className="w-full rounded-lg bg-slate-900/60 border border-slate-700 text-sm text-slate-200 placeholder:text-slate-500 p-3 mb-5 focus:outline-none focus:border-red-500/60 resize-none"
            />

            <div className="flex justify-end gap-2">
              <button
                type="button"
                disabled={isRefunding}
                onClick={() => setRefundTarget(null)}
                className="h-10 px-4 rounded-lg border border-slate-700 text-slate-300 text-sm font-medium hover:bg-slate-700/50 transition-colors disabled:opacity-50"
              >
                Cancelar
              </button>
              <button
                type="button"
                disabled={isRefunding}
                onClick={confirmRefund}
                className="h-10 px-4 rounded-lg text-sm font-semibold bg-red-500 text-white hover:bg-red-400 transition-colors disabled:opacity-50 flex items-center gap-2"
              >
                {isRefunding && <Loader2 size={14} className="animate-spin" />}
                Confirmar reembolso
              </button>
            </div>
          </div>
        </div>
      )}

      {partialTarget && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 p-4"
          onClick={() => !isPartialRefunding && setPartialTarget(null)}
        >
          <div
            className="w-full max-w-md rounded-2xl border border-slate-700 bg-slate-800 p-6"
            onClick={event => event.stopPropagation()}
          >
            <h2 className="text-slate-100 font-semibold text-base mb-1">
              Reembolso parcial — {partialTarget.code ?? partialTarget.id}
            </h2>
            <p className="text-slate-400 text-sm mb-4">
              Elegí cuántas unidades de cada producto se devuelven. El monto
              se calcula proporcional a esas unidades (impuesto y descuento
              incluidos) y se repone solo esa cantidad al inventario.
            </p>

            <div className="space-y-2.5 mb-4 max-h-56 overflow-y-auto pr-1">
              {(() => {
                const refundable = refundableQuantities(partialTarget);

                return partialTarget.items.map((item, index) => {
                  const max = refundable[item.productId] ?? 0;
                  const selected = partialQuantities[item.productId] ?? 0;

                  return (
                    <div
                      key={`${partialTarget.id}-${item.productId}-${index}`}
                      className="flex items-center justify-between gap-3"
                    >
                      <div className="min-w-0">
                        <p className="text-sm text-slate-200 truncate">
                          {productNames[item.productId] ?? "Producto"}
                        </p>
                        <p className="text-xs text-slate-500">
                          {max > 0
                            ? `${max} disponible${max === 1 ? "" : "s"} para devolver`
                            : "Ya no queda nada por devolver"}
                        </p>
                      </div>

                      <div className="flex items-center gap-2 shrink-0">
                        <button
                          type="button"
                          disabled={selected <= 0}
                          onClick={() =>
                            setPartialQuantity(item.productId, selected - 1, max)
                          }
                          className="w-7 h-7 rounded-md border border-slate-700 text-slate-300 text-sm disabled:opacity-30 hover:bg-slate-700/50"
                        >
                          −
                        </button>
                        <span className="w-6 text-center text-sm text-slate-200">
                          {selected}
                        </span>
                        <button
                          type="button"
                          disabled={selected >= max}
                          onClick={() =>
                            setPartialQuantity(item.productId, selected + 1, max)
                          }
                          className="w-7 h-7 rounded-md border border-slate-700 text-slate-300 text-sm disabled:opacity-30 hover:bg-slate-700/50"
                        >
                          +
                        </button>
                      </div>
                    </div>
                  );
                });
              })()}
            </div>

            <label className="block text-xs font-medium text-slate-400 mb-1.5">
              Motivo del reembolso
            </label>
            <textarea
              value={partialReason}
              onChange={event => setPartialReason(event.target.value)}
              placeholder="Ej. Un producto llegó dañado, el cliente devolvió una unidad..."
              rows={2}
              className="w-full rounded-lg bg-slate-900/60 border border-slate-700 text-sm text-slate-200 placeholder:text-slate-500 p-3 mb-5 focus:outline-none focus:border-amber-500/60 resize-none"
            />

            <div className="flex justify-end gap-2">
              <button
                type="button"
                disabled={isPartialRefunding}
                onClick={() => setPartialTarget(null)}
                className="h-10 px-4 rounded-lg border border-slate-700 text-slate-300 text-sm font-medium hover:bg-slate-700/50 transition-colors disabled:opacity-50"
              >
                Cancelar
              </button>
              <button
                type="button"
                disabled={isPartialRefunding}
                onClick={confirmPartialRefund}
                className="h-10 px-4 rounded-lg text-sm font-semibold bg-amber-500 text-slate-900 hover:bg-amber-400 transition-colors disabled:opacity-50 flex items-center gap-2"
              >
                {isPartialRefunding && <Loader2 size={14} className="animate-spin" />}
                Confirmar reembolso parcial
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}