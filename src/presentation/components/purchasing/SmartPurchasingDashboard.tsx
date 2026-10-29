import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import { ShoppingCart, Package, ShoppingBag, ClipboardList, History as HistoryIcon, FilePlus2 } from "lucide-react";

import { EmptyState } from "../ui/EmptyState";
import { Skeleton, SkeletonCards, SkeletonPanel } from "../ui/Skeleton";
import { VimdyButton } from "../ui/VimdyButton";
import { CreatePurchaseOrderModal } from "./CreatePurchaseOrderModal";
import { DirectPurchaseModal } from "./DirectPurchaseModal";
import { PurchaseOrdersPanel } from "./PurchaseOrdersPanel";
import { PurchaseRecommendationsPanel } from "./PurchaseRecommendationsPanel";
import { PurchaseHistoryTable } from "./PurchaseHistoryTable";

import { useSmartPurchasing } from "../../../core/store/useSmartPurchasing";
import type { PurchaseRecommendation } from "../../../core/engines/PurchaseIntelligenceEngine";
import { usePurchaseOrders } from "../../../hooks/usePurchaseOrders";
import { useSuppliers } from "../../../hooks/useSuppliers";
import { useProducts } from "../../../hooks/useProducts";

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
  const { recommendations, summary, loading, error, hasRecommendations } = useSmartPurchasing();
  const { suppliers } = useSuppliers();
  const { products } = useProducts();
  const purchaseOrders = usePurchaseOrders();

  const [tab, setTab] = useState<Tab>("recomendaciones");
  const [orderTarget, setOrderTarget] = useState<PurchaseRecommendation | null>(null);
  const [directPurchaseOpen, setDirectPurchaseOpen] = useState(false);

  const orderTargetProduct = orderTarget ? products.find((p) => p.id === orderTarget.productId) ?? null : null;

  const TABS: { key: Tab; label: string; icon: React.ReactNode; count?: number }[] = [
    { key: "recomendaciones", label: "Recomendaciones", icon: <ShoppingBag size={15} />, count: recommendations.length },
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
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold text-vimdy-text flex items-center gap-2">
            <ShoppingCart size={26} className="text-vimdy-accent" />
            Compras Inteligentes
          </h1>
          <p className="text-vimdy-text-secondary text-sm mt-1">
            Qué necesitas comprar y por qué, calculado con tus ventas e ingredientes reales. Crea la orden,
            márcala como comprada y VIMDY actualiza el inventario solo. Si la mercancía llegó con factura y sin
            orden previa, regístrala como compra directa.
          </p>
        </div>
        <VimdyButton
          variant="secondary"
          icon={<FilePlus2 size={16} />}
          className="shrink-0 whitespace-nowrap"
          onClick={() => setDirectPurchaseOpen(true)}
        >
          Compra directa
        </VimdyButton>
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
          title={
            summary && !summary.hasSalesHistory
              ? "Aún no hay ventas para analizar."
              : "No necesitas comprar nada por ahora."
          }
          description={
            summary && !summary.hasSalesHistory
              ? "Cuando empieces a vender, VIMDY medirá cuánto se consume de cada insumo y te dirá qué comprar."
              : "En cuanto un insumo se acerque a agotarse, según tus ventas reales, va a aparecer aquí."
          }
        />
      )}

      {tab === "recomendaciones" && hasRecommendations && (
        <>
          <PurchaseRecommendationsPanel
            recommendations={recommendations}
            summary={summary}
            onCreateOrder={setOrderTarget}
          />

          <div className="flex justify-end">
            <VimdyButton variant="secondary" icon={<Package size={16} />} onClick={() => navigate("/inventario")}>
              Ver inventario
            </VimdyButton>
          </div>
        </>
      )}

      <DirectPurchaseModal
        open={directPurchaseOpen}
        onClose={() => setDirectPurchaseOpen(false)}
        suppliers={suppliers}
        products={products}
        onConfirm={async (input) => {
          const messages = await purchaseOrders.recordDirectPurchase(input);
          return messages !== null;
        }}
      />

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