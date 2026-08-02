import type { BusinessSnapshot } from "../../../core/types/CopilotTypes";
import type { TranslationKey } from "../../../core/i18n/dictionaries";

type TFunction = (key: TranslationKey, vars?: Record<string, string | number>) => string;

/**
 * managerPriorities.ts
 * ---------------------------------------------------------------------------
 * FASE 5 — PASO 1: Gerente Inteligente.
 *
 * Toda la información sale de BusinessSnapshot (BusinessAnalyzer.buildSnapshot),
 * el mismo "cerebro" real que ya usa el Copiloto y las alertas automáticas —
 * no se inventa ni se recalcula nada por separado aquí. Esta función solo
 * ELIGE y ORDENA cuáles de esos datos reales importan hoy, con un máximo de
 * 5, y les asigna color + una acción concreta (nunca genérica).
 */

export type PriorityColor = "red" | "yellow" | "blue" | "green";

export interface ManagerPriority {
  key: string;
  color: PriorityColor;
  icon: string;
  message: string;
  actionLabel: string;
  route: string;
}

export const PRIORITY_COLOR_CLASS: Record<PriorityColor, { text: string; bg: string; border: string; accent: string }> = {
  red: { text: "text-vimdy-danger", bg: "bg-vimdy-danger/10", border: "border-vimdy-danger/30", accent: "bg-vimdy-danger" },
  yellow: { text: "text-vimdy-warning", bg: "bg-vimdy-warning/10", border: "border-vimdy-warning/30", accent: "bg-vimdy-warning" },
  blue: { text: "text-vimdy-accent", bg: "bg-vimdy-accent/10", border: "border-vimdy-accent/30", accent: "bg-vimdy-accent" },
  green: { text: "text-vimdy-success", bg: "bg-vimdy-success/10", border: "border-vimdy-success/30", accent: "bg-vimdy-success" }
};

function money(value: number, currency: string): string {
  return `${Math.round(value).toLocaleString("es-CO")} ${currency}`;
}

/**
 * Misma idea de inferencia por texto que ya usa useAutoAlerts.ts
 * (inferCategory) para no depender de un campo nuevo en SmartAlert.
 */
function routeForSmartAlert(message: string, t: TFunction): { route: string; actionLabel: string } {
  const text = message.toLowerCase();
  if (text.includes("retras") || text.includes("cocina")) {
    return { route: "/cocina", actionLabel: t("route.goToKitchen") };
  }
  if (text.includes("stock") || text.includes("agotad") || text.includes("compra")) {
    return { route: "/inventario", actionLabel: t("route.goToInventory") };
  }
  if (text.includes("venta") || text.includes("meta")) {
    return { route: "/reportes", actionLabel: t("route.viewReport") };
  }
  return { route: "/dashboard", actionLabel: t("route.viewMore") };
}

/**
 * Arma hasta 5 prioridades reales, ya ordenadas: primero lo urgente
 * (rojo), luego advertencias (amarillo), luego información relevante
 * (azul) y por último buenas noticias (verde) — igual al orden del
 * documento de producto: inventario crítico → producción limitada →
 * productos por comprar → producto más rentable → mejor empleado →
 * resumen del negocio.
 */
export function buildManagerPriorities(snapshot: BusinessSnapshot, t: TFunction): ManagerPriority[] {
  const priorities: ManagerPriority[] = [];

  // 1) Alertas críticas/urgentes ya calculadas por BusinessAnalyzer
  // (stock agotado, pedido retrasado en cocina, ventas cayendo, etc.),
  // ya vienen ordenadas RED > ORANGE > GREEN.
  // NOTA: alert.message viene de BusinessAnalyzer (smartAlerts) y todavía
  // se genera en español fijo — ese archivo queda pendiente de traducir
  // aparte, por eso routeForSmartAlert sigue detectando palabras clave
  // en español. Cuando se traduzca BusinessAnalyzer, actualizar también
  // ese detector.
  for (const alert of snapshot.smartAlerts) {
    if (priorities.length >= 5) break;
    if (alert.level === "GREEN") continue; // las buenas noticias van al final, no aquí.
    const { route, actionLabel } = routeForSmartAlert(alert.message, t);
    priorities.push({
      key: `alert-${priorities.length}`,
      color: alert.level === "RED" ? "red" : "yellow",
      icon: alert.level === "RED" ? "⚠️" : "🟡",
      message: alert.message,
      actionLabel,
      route
    });
  }

  // 2) Producción limitada (RecipeEngine, vía BusinessAnalyzer.productionAlerts):
  // productos con receta que hoy no se pueden preparar o casi no alcanzan,
  // con el ingrediente exacto que los frena. Va antes que "por comprar"
  // porque es más específico y accionable ("Compra pan" en vez de solo
  // "stock bajo"). CRITICO se muestra igual de urgente que una alerta roja;
  // ADVERTENCIA como amarilla. Máximo 2, para dejar espacio a lo demás.
  const sortedProductionAlerts = [...snapshot.productionAlerts].sort((a, b) => {
    if (a.level !== b.level) return a.level === "CRITICO" ? -1 : 1;
    return a.maxUnits - b.maxUnits;
  });
  for (const alert of sortedProductionAlerts.slice(0, 2)) {
    if (priorities.length >= 5) break;
    const message =
      alert.level === "CRITICO"
        ? alert.limitingIngredientName
          ? t("priority.production.criticalWithIngredient", { ingredient: alert.limitingIngredientName, product: alert.productName })
          : t("priority.production.criticalNoIngredient", { product: alert.productName })
        : alert.limitingIngredientName
        ? t("priority.production.warningWithIngredient", { ingredient: alert.limitingIngredientName, maxUnits: alert.maxUnits, product: alert.productName })
        : t("priority.production.warningNoIngredient", { maxUnits: alert.maxUnits, product: alert.productName });
    priorities.push({
      key: `production-${alert.productId}`,
      color: alert.level === "CRITICO" ? "red" : "yellow",
      icon: "🍳",
      message,
      actionLabel: t("route.viewRecipe"),
      route: "/inventario"
    });
  }

  // 3) Producto puntual por agotarse (además de la alerta general de stock),
  // solo si no quedó ya cubierto arriba y hay margen.
  const [topPurchase] = snapshot.purchaseSuggestions;
  if (topPurchase && priorities.length < 5) {
    priorities.push({
      key: "purchase",
      color: topPurchase.daysUntilStockout !== null && topPurchase.daysUntilStockout <= 2 ? "red" : "yellow",
      icon: "📦",
      message:
        topPurchase.daysUntilStockout !== null
          ? t("priority.purchase.urgent", { stock: topPurchase.currentStock, name: topPurchase.name, days: topPurchase.daysUntilStockout })
          : t("priority.purchase.simple", { stock: topPurchase.currentStock, name: topPurchase.name }),
      actionLabel: t("route.viewProduct"),
      route: "/inventario"
    });
  }

  // 4) Producto más rentable — información que ayuda a decidir qué impulsar.
  const [topProfit] = snapshot.topProfitProducts;
  if (topProfit && priorities.length < 5) {
    priorities.push({
      key: "profit",
      color: "blue",
      icon: "🍔",
      message: t("priority.profit.message", { name: topProfit.name, amount: money(topProfit.profit, snapshot.currency) }),
      actionLabel: t("route.viewProfits"),
      route: "/reportes"
    });
  }

  // 4.5) PASO 2.5 — Centro de Pérdidas: si este mes se ha perdido dinero
  // real (mermas, vencidos, robos, errores...), el dueño debe saberlo con
  // la misma prioridad que su producto más rentable. Roja si la pérdida
  // supera $200.000, amarilla en cualquier otro caso con pérdida > 0.
  if (snapshot.lossSummary.monthLoss > 0 && priorities.length < 5) {
    const { monthLoss, topLossProduct, topLossCategory } = snapshot.lossSummary;
    const detail = topLossProduct
      ? t("priority.loss.detailProduct", { name: topLossProduct.name })
      : topLossCategory
      ? t("priority.loss.detailCategory", { category: topLossCategory.label.toLowerCase() })
      : "";
    priorities.push({
      key: "loss",
      color: monthLoss > 200000 ? "red" : "yellow",
      icon: "🧯",
      message: t("priority.loss.message", { amount: money(monthLoss, snapshot.currency), detail }),
      actionLabel: t("route.viewLossCenter"),
      route: "/perdidas"
    });
  }

  // 5) Mejor empleado del día/periodo reciente.
  const [topEmployee] = snapshot.topEmployees;
  if (topEmployee && priorities.length < 5) {
    priorities.push({
      key: "employee",
      color: "blue",
      icon: "👨‍🍳",
      message: t("priority.employee.message", { name: topEmployee.name, amount: money(topEmployee.revenue, snapshot.currency), count: topEmployee.salesCount }),
      actionLabel: t("route.viewEmployees"),
      route: "/configuracion"
    });
  }

  // 6) Si todavía hay espacio y no hubo ninguna mala noticia real, cerrar
  // con la mejor buena noticia disponible (venta creciendo o alerta GREEN).
  if (priorities.length < 5) {
    const goodAlert = snapshot.smartAlerts.find((a) => a.level === "GREEN");
    if (goodAlert) {
      priorities.push({
        key: "good-news",
        color: "green",
        icon: "💰",
        message: goodAlert.message,
        actionLabel: t("route.viewReport"),
        route: "/reportes"
      });
    } else if (snapshot.salesGrowthPercent > 0) {
      priorities.push({
        key: "growth",
        color: "green",
        icon: "📈",
        message: t("priority.growth.message", { percent: snapshot.salesGrowthPercent }),
        actionLabel: t("route.viewReport"),
        route: "/reportes"
      });
    }
  }

  return priorities.slice(0, 5);
}

/**
 * Mismos cortes que HealthEngine.calculate() (90/75/50), para que
 * cualquier bloque del Dashboard que muestre la salud del negocio
 * (Bienvenida, Indicadores) diga siempre exactamente lo mismo.
 */
export function healthColorClass(score: number): string {
  if (score >= 75) return "text-vimdy-success";
  if (score >= 50) return "text-vimdy-warning";
  return "text-vimdy-danger";
}

export function healthColorHex(score: number | undefined): string {
  if (score === undefined) return "#5C5C64"; // vimdy-text-tertiary
  if (score >= 75) return "#22C55E"; // vimdy-success
  if (score >= 50) return "#F59E0B"; // vimdy-warning
  return "#EF4444"; // vimdy-danger
}

export function healthLabel(score: number, t: TFunction): string {
  if (score >= 90) return t("health.excellent");
  if (score >= 75) return t("health.good");
  if (score >= 50) return t("health.needsAttention");
  return t("health.critical");
}

/**
 * PASO 1.2 — Bienvenida Inteligente.
 * Una sola frase de estado general del negocio (no un puntaje), para que el
 * dueño entienda su situación sin tener que interpretar un número. Usa los
 * mismos cortes que healthLabel (90/75/50) para no contradecir al Bloque 2.
 */
export function healthPhrase(score: number, t: TFunction): string {
  if (score >= 90) return t("healthPhrase.excellent");
  if (score >= 50) return t("healthPhrase.normal");
  return t("healthPhrase.attention");
}

/**
 * Título corto por tipo de prioridad, para que cada recomendación del
 * Gerente Inteligente (Bloque 3) tenga título + explicación separados,
 * en vez de un solo mensaje largo.
 */
export function priorityTitle(priority: ManagerPriority, t: TFunction): string {
  if (priority.key.startsWith("alert-")) return t("priorityTitle.alert");
  if (priority.key.startsWith("production-")) return t("priorityTitle.production");
  if (priority.key === "purchase") return t("priorityTitle.purchase");
  if (priority.key === "profit") return t("priorityTitle.profit");
  if (priority.key === "loss") return t("priorityTitle.loss");
  if (priority.key === "employee") return t("priorityTitle.employee");
  if (priority.key === "good-news" || priority.key === "growth") return t("priorityTitle.goodPerformance");
  return t("priorityTitle.recommendation");
}

/** Saludo "vivo" según la hora real del dispositivo del usuario. */
export function buildGreeting(ownerName: string | undefined, now: Date, t: TFunction): { title: string; subtitle: string } {
  const hour = now.getHours();
  const timeGreeting = hour < 12 ? t("greeting.morning") : hour < 19 ? t("greeting.afternoon") : t("greeting.evening");
  const firstName = ownerName?.trim().split(" ")[0];
  const title = firstName ? `${timeGreeting}, ${firstName}.` : `${timeGreeting}.`;
  return {
    title,
    subtitle: t("greeting.subtitle")
  };
}