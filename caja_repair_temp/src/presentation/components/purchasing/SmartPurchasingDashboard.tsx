import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import { ShoppingCart, AlertTriangle, Package, Info, ShoppingBag, ClipboardList, History as HistoryIcon } from "lucide-react";

import { EmptyState } from "../ui/EmptyState";
import { Skeleton, SkeletonCards, SkeletonPanel } from "../ui/Skeleton";
import { VimdyButton } from "../ui/VimdyButton";
import { CreatePurchaseOrderModal } from "./CreatePurchaseOrderModal";
import { PurchaseOrdersPanel } from "./PurchaseOrdersPanel";
import { PurchaseHistoryTable } from "./PurchaseHistoryTable";

import { useSmartPurchasing } from "../../../core/store/useSmartPurchasing";
import { PurchaseRecommendation, PurchaseUrgency } from "../../../core/engines/PurchaseIntelligenceEngine";
import { usePurchaseOrders } from "../../../hooks/usePurchaseOrders";
import { useSuppliers } from "../../../hooks/useSuppliers";
import { useProducts } from "../../../hooks/useProducts";

const URGENCY_LABEL: Record<PurchaseUrgency, string> = {
  ALTA: "🔴 Alta",
  MEDIA: "🟡 Media",
  BAJA: "🟢 Baja"
};

const URGENCY_ROW_CLASS: Record<PurchaseUrgency, string> = {
  ALTA: "border-vimdy-danger/30 bg-vimdy-danger/5",
  MEDIA: "border-vimdy-warning/30 bg-vimdy-warning/5",
  BAJA: "border-vimdy-border bg-vimdy-surface"
};

const URGENCY_BADGE_CLASS: Record<PurchaseUrgency, string> = {
  ALTA: "border-vimdy-danger/30 bg-vimdy-danger/10 text-vimdy-danger",
  MEDIA: "border-vimdy-warning/30 bg-vimdy-warning/10 text-vimdy-warning",
  BAJA: "border-vimdy-success/30 bg-vimdy-success/10 text-vimdy-success"
};

const ALERT_CLASS: Record<PurchaseUrgency, string> = {
  ALTA: "border-vimdy-danger/30 bg-vimdy-danger/10 text-vimdy-danger",
  MEDIA: "border-vimdy-warning/30 bg-vimdy-warning/10 text-vimdy-warning",
  BAJA: "border-vimdy-success/30 bg-vimdy-success/10 text-vimdy-success"
};

function formatQuantity(quantity: number, unit: string | null): string {
  const rounded = Number.isInteger(quantity) ? quantity : Math.round(quantity * 10) / 10;
  return unit ? `${rounded} ${unit}` : `${rounded} unidad(es)`;
}

type Tab = "recomendaciones" | "ordenes" | "historial";

/**
 * SmartPurchasingDashboard — VIMDY FASE 5, PASO 2.6 + 2.7 (Compras Inteligentes).
 * ---------------------------------------------------------------------------
 * PASO 2.6 (análisis): muestra lo que calculó PurchaseIntelligenceEngine —
 * qué comprar, cuánto, con qué urgencia y por qué.
 * PASO 2.7 (ejecución): convierte cada recomendación en una orden real
 * ("Crear orden") y administra su ciclo de vida completo — comprar,
 * posponer, cancelar — sin salir de VIMDY. Toda compra recibida actualiza
 * el inventario automáticamente y queda guardada en el historial.
 */
export function SmartPurchasingDashboard() {
  const navigate = useNavigate();
  const { recommendations, loading, error, urgencyCounts, hasRecommendations } = useSmartPurchasing();
  const { suppliers } = useSuppliers();
  const { products } = useProducts();
  const purchaseOrders = usePurchaseOrders();

  const [tab, setTab] = useState<Tab>("recomendaciones");
  const [orderTarget, setOrderTarget] = useState<PurchaseRecommendation | null>(null);

  const orderTargetProduct = orderTarget ? products.find((p) => p.id === orderTarget.productId) ?? null : null;

  const TABS: { key: Tab; label: string; icon: React.ReactNode; count?: number }[] = [
    { key: "recomendaciones", label: "Recomendaciones", icon: <ShoppingBag size={15} /> },
    { key: "ordenes", label: "Órdenes abiertas", icon: <ClipboardList size={15} />, count: purchaseOrders.openOrders.length },
    { key: "historial", label: "Historial", icon: <HistoryIcon size={15} /> }
  ];

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <Skeleton className="h-8 w-56" />
        </div>
        <SkeletonCards count={3} />
        <SkeletonPanel />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-vimdy-text flex items-center gap-2">
          <ShoppingCart size={26} className="text-vimdy-accent" />
          Compras Inteligentes
        </h1>
        <p className="text-vimdy-text-secondary text-sm mt-1">
          Qué necesitas comprar y por qué, calculado con tus ventas e ingredientes reales. Crea la orden,
          márcala como comprada y VIMDY actualiza el inventario solo.
        </p>
      </div>

      <div className="flex items-center gap-2 border-b border-vimdy-border-subtle pb-1">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`flex items-center gap-1.5 px-4 py-2 text-sm rounded-t-xl transition-colors ${
              tab === t.key
                ? "bg-vimdy-surface text-vimdy-text border border-b-0 border-vimdy-border"
                : "text-vimdy-text-secondary hover:text-vimdy-text"
            }`}
          >
            {t.icon}
            {t.label}
            {t.count !== undefined && t.count > 0 && (
              <span className="ml-1 text-xs px-1.5 py-0.5 rounded-vimdy-xs bg-vimdy-accent/20 text-vimdy-accent">
                {t.count}
              </span>
            )}
          </button>
        ))}
      </div>

      {error && (
        <div className="rounded-vimdy-md border border-vimdy-danger/40 bg-vimdy-danger/10 text-vimdy-danger text-sm px-4 py-3">
          {error}
        </div>
      )}

      {tab === "ordenes" && (
        <PurchaseOrdersPanel
          orders={purchaseOrders.openOrders}
          suppliers={suppliers}
          products={products}
          actions={purchaseOrders}
        />
      )}

      {tab === "historial" && (
        <PurchaseHistoryTable history={purchaseOrders.history} suppliers={suppliers} products={products} />
      )}

      {tab === "recomendaciones" && !hasRecommendations && (
        <EmptyState
          icon={<Package size={28} />}
          title="No necesitas comprar nada por ahora."
          description="En cuanto un insumo se acerque a agotarse, según tus ventas reales, va a aparecer aquí."
        />
      )}

      {tab === "recomendaciones" && hasRecommendations && (
        <>
          {/* Resumen por urgencia */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="rounded-vimdy-lg border border-vimdy-danger/30 bg-vimdy-danger/5 p-5">
              <p className="text-vimdy-danger text-xs font-semibold uppercase tracking-wide">🔴 Urgencia alta</p>
              <p className="text-vimdy-text text-3xl font-bold mt-1">{urgencyCounts.ALTA}</p>
              <p className="text-vimdy-text-tertiary text-xs mt-1">Cómpralo hoy.</p>
            </div>
            <div className="rounded-vimdy-lg border border-vimdy-warning/30 bg-vimdy-warning/5 p-5">
              <p className="text-vimdy-warning text-xs font-semibold uppercase tracking-wide">🟡 Urgencia media</p>
              <p className="text-vimdy-text text-3xl font-bold mt-1">{urgencyCounts.MEDIA}</p>
              <p className="text-vimdy-text-tertiary text-xs mt-1">Prográmalo esta semana.</p>
            </div>
            <div className="rounded-vimdy-lg border border-vimdy-success/30 bg-vimdy-success/5 p-5">
              <p className="text-vimdy-success text-xs font-semibold uppercase tracking-wide">🟢 Urgencia baja</p>
              <p className="text-vimdy-text text-3xl font-bold mt-1">{urgencyCounts.BAJA}</p>
              <p className="text-vimdy-text-tertiary text-xs mt-1">Todavía tienes margen.</p>
            </div>
          </div>

          {/* Alertas rápidas */}
          <div className="rounded-vimdy-lg border border-vimdy-border bg-vimdy-surface p-5">
            <div className="flex items-center gap-2 mb-3">
              <AlertTriangle size={18} className="text-vimdy-warning" />
              <h3 className="text-vimdy-text font-bold">Alertas</h3>
            </div>
            <div className="space-y-2">
              {recommendations.map((rec) => (
                <div
                  key={rec.productId}
                  className={`flex items-start gap-2 text-sm px-3 py-2 rounded-vimdy-md border ${ALERT_CLASS[rec.urgency]}`}
                >
                  <span>{rec.alert}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Tabla de recomendaciones */}
          <div className="rounded-vimdy-lg border border-vimdy-border bg-vimdy-surface overflow-hidden">
            <div className="p-5 pb-0 flex items-center gap-2">
              <Info size={16} className="text-vimdy-accent" />
              <h3 className="text-vimdy-text font-bold">Recomendaciones de compra</h3>
            </div>
            <div className="overflow-x-auto p-5">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-vimdy-text-tertiary text-xs uppercase tracking-wide">
                    <th className="pb-3 pr-4">Producto</th>
                    <th className="pb-3 pr-4">Cantidad recomendada</th>
                    <th className="pb-3 pr-4">Urgencia</th>
                    <th className="pb-3 pr-4">Días restantes</th>
                    <th className="pb-3 pr-4">Motivo</th>
                    <th className="pb-3"></th>
                  </tr>
                </thead>
                <tbody>
                  {recommendations.map((rec) => (
                    <tr key={rec.productId} className={`border-t ${URGENCY_ROW_CLASS[rec.urgency]}`}>
                      <td className="py-3 pr-4 text-vimdy-text font-medium">
                        {rec.productName}
                        {rec.consumedViaRecipes && (
                          <span className="ml-2 text-xs px-1.5 py-0.5 rounded-vimdy-xs bg-vimdy-recipe/15 text-vimdy-recipe border border-vimdy-recipe/30">
                            vía recetas
                          </span>
                        )}
                      </td>
                      <td className="py-3 pr-4 text-vimdy-text">
                        {formatQuantity(rec.recommendedQuantity, rec.unit)}
                        {!rec.basedOnSalesHistory && (
                          <span className="block text-[11px] text-vimdy-warning font-normal">
                            Sin historial de ventas — solo repone al mínimo
                          </span>
                        )}
                      </td>
                      <td className="py-3 pr-4">
                        <span className={`text-xs px-2 py-1 rounded-vimdy-sm border ${URGENCY_BADGE_CLASS[rec.urgency]}`}>
                          {URGENCY_LABEL[rec.urgency]}
                        </span>
                      </td>
                      <td className="py-3 pr-4 text-vimdy-text-secondary">
                        {rec.daysUntilStockout !== null ? `${rec.daysUntilStockout} día(s)` : "—"}
                      </td>
                      <td className="py-3 pr-4 text-vimdy-text-secondary">{rec.reason}</td>
                      <td className="py-3">
                        <VimdyButton
                          variant="secondary"
                          className="!px-3 !py-1.5 text-xs whitespace-nowrap"
                          onClick={() => setOrderTarget(rec)}
                        >
                          Crear orden
                        </VimdyButton>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="flex justify-end">
            <VimdyButton variant="secondary" icon={<Package size={16} />} onClick={() => navigate("/inventario")}>
              Ver inventario
            </VimdyButton>
          </div>
        </>
      )}

      {orderTarget && orderTargetProduct && (
        <CreatePurchaseOrderModal
          open={!!orderTarget}
          onClose={() => setOrderTarget(null)}
          product={orderTargetProduct}
          suggestedQuantity={orderTarget.recommendedQuantity}
          suppliers={suppliers}
          onConfirm={async (input) => {
            const created = await purchaseOrders.createOrder({
              items: [{ productId: orderTargetProduct.id, quantity: input.quantity, unitPrice: input.unitPrice }],
              supplierId: input.supplierId,
              expectedDeliveryDate: input.expectedDeliveryDate
            });
            return !!created;
          }}
        />
      )}
    </div>
  );
}