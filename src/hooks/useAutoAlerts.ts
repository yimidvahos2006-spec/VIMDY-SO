import { useEffect } from "react";

import { container } from "../infrastructure/di/CompositionRoot";
import { useDashboard } from "../core/store/useDashboard";
import { businessStore } from "../core/store/businessStore";
import { companyConfigStore } from "../core/store/companyConfigStore";
import { notificationStore, type NotificationCategory } from "../core/store/notificationStore";
import { productCatalogStore } from "../core/store/productCatalogStore";
import { InventoryAI } from "../core/ia/InventoryAI";
import type { SmartAlert } from "../core/types/CopilotTypes";

/** Cada cuánto se revisa el negocio para detectar alertas que dependen del tiempo (ej. un pedido que se retrasa) aunque no haya entrado ninguna venta nueva. */
const REFRESH_INTERVAL_MS = 60_000;

/** Mensaje genérico de "todo bien" — no tiene sentido convertirlo en notificación. */
const NO_ALERTS_MESSAGE = "Todo en orden: sin alertas críticas en este momento.";

const ALERT_META: Record<SmartAlert["level"], { title: string; type: "error" | "warning" | "success" }> = {
  RED: { title: "Alerta crítica", type: "error" },
  ORANGE: { title: "Advertencia", type: "warning" },
  GREEN: { title: "Buenas noticias", type: "success" }
};

/**
 * SmartAlert no trae una categoría explícita, así que se infiere del texto
 * del mensaje (mismo patrón que ya usa el copiloto para reconocer alertas).
 * Si no calza con nada conocido, cae en "GENERAL".
 */
function inferCategory(alert: SmartAlert): NotificationCategory {
  const text = alert.message.toLowerCase();
  if (text.includes("stock") || text.includes("agotad")) return "STOCK_BAJO";
  if (text.includes("retras") || text.includes("pedido") || text.includes("cocina")) return "PEDIDO_RETRASADO";
  if (text.includes("meta") || text.includes("objetivo")) return "META_CUMPLIDA";
  return "GENERAL";
}

const inventoryAI = new InventoryAI();

/**
 * useAutoAlerts
 * ---------------------------------------------------------------------------
 * PASO 4 — Alertas automáticas.
 *
 * Se monta UNA sola vez, en VimdyAppLayout (toda la app), y vigila los
 * smartAlerts que ya calcula BusinessAnalyzer:
 *
 *   🔴 Stock bajo / agotado
 *   🔴 Pedido retrasado en cocina
 *   🟠 Ventas bajando (≥15% por debajo de ayer)
 *   🟢 Meta de ventas del día alcanzada
 *
 * y los empuja automáticamente a notificationStore — nadie tiene que
 * preguntarle nada al Copiloto para enterarse. notificationStore ya evita
 * duplicados mientras la alerta siga activa (misma `key`).
 *
 * Se recalcula cada vez que cambian los pedidos (venta real, vía
 * dashboardStore) y también cada minuto, porque alertas como "pedido
 * retrasado" dependen del tiempo transcurrido, no solo de nuevas ventas.
 */
export function useAutoAlerts() {
  const dashboard = useDashboard();
  const aiEnabled = companyConfigStore.get().enableAI;

  useEffect(() => {
    if (!aiEnabled) return;
    let cancelled = false;

    async function check() {
      await notificationStore.init();
      if (cancelled) return;

      const business = businessStore.get();
      const config = companyConfigStore.get();
      const snapshot = await container.businessAnalyzer.get().buildSnapshot(
        business.name || "Mi negocio",
        config.currency
      );
      if (cancelled) return;

      snapshot.smartAlerts
        .filter((alert) => alert.message !== NO_ALERTS_MESSAGE)
        .forEach((alert) => {
          const meta = ALERT_META[alert.level];
          const category = inferCategory(alert);
          notificationStore.add(meta.title, `${alert.icon} ${alert.message}`, meta.type, alert.message, category);
        });

      // 🟣 IA recomienda comprar: se apoya en InventoryAI sobre el catálogo
      // real (productCatalogStore), igual que hace Inventario para mostrar
      // sus propias recomendaciones de compra.
      const products = productCatalogStore.getSnapshot();
      inventoryAI.generatePurchaseRecommendations(products).forEach((rec) => {
        if (rec.priority !== "CRITICAL" && rec.priority !== "HIGH") return;
        const message = `Comprar ${rec.recommendedPurchase} u. de "${rec.productName}" (quedan ${rec.currentStock})`;
        notificationStore.addPurchaseRecommendation(message, `IA_COMPRA:${rec.productId}`);
      });
    }

    check();
    const interval = setInterval(check, REFRESH_INTERVAL_MS);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dashboard.data.orders, aiEnabled]);
}