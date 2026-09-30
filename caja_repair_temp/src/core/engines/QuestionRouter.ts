import { BusinessAnalyzer } from "./BusinessAnalyzer";
import { BusinessSnapshot } from "../types/CopilotTypes";
import { formatMoney } from "../utils/formatMoney";

/**
 * QuestionRouter
 * ---------------------------------------------------------------------------
 * El "cerebro del chat" para las preguntas más frecuentes del negocio.
 *
 * VIMDY ya tiene dos capas de lenguaje natural en el Copiloto:
 *   1) CommandEngine  (PASO 6) — reconoce ÓRDENES ("crea un producto",
 *      "abre la caja") y ejecuta una acción/navegación.
 *   2) CopilotService — para todo lo demás, le manda el negocio completo
 *      a Claude y deja que responda con lenguaje natural libre.
 *
 * QuestionRouter es la capa que faltaba entre las dos: reconoce PREGUNTAS
 * frecuentes ("¿cuánto vendí hoy?", "¿qué debo comprar?", "¿quién vende
 * más?") y las responde al instante con BusinessAnalyzer — el mismo motor
 * que alimenta al Dashboard y al Copiloto — sin gastar la API de Claude ni
 * esperar respuesta de red.
 *
 * Es intencionalmente simple (coincidencia de patrones, no un LLM): rápido,
 * gratis y determinista, igual que CommandEngine. Si el texto no calza con
 * ninguna pregunta conocida, devuelve null y CopilotService sigue el camino
 * normal (preguntarle a Claude, que puede responder cualquier cosa con todo
 * el contexto del negocio).
 *
 * BusinessAnalyzer nunca inventa cifras — solo agrega datos reales — así que
 * las respuestas de este router son tan confiables como las del Copiloto.
 */

type QuestionHandler = {
  readonly name: string;
  readonly test: (text: string) => boolean;
  readonly build: (snapshot: BusinessSnapshot) => string;
};

/** Quita tildes/diéresis y pasa a minúsculas, para que el matching no dependa de acentos. */
function normalize(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim();
}

const HANDLERS: QuestionHandler[] = [
  // ¿Cuánto vendí hoy?
  {
    name: "VENTAS_HOY",
    test: (t) => /\b(cuanto|como van|como voy con)\b.*\bvent/.test(t) || /vend[ií](.*hoy)?\??$/.test(t) || /ventas de hoy/.test(t),
    build: (s) => {
      const trend = s.salesGrowthPercent >= 0 ? "arriba" : "abajo";
      return `Hoy llevas ${formatMoney(s.todaySales, s.currency)} en ${s.totalOrdersToday} pedido(s), ${Math.abs(
        s.salesGrowthPercent
      )}% ${trend} respecto a ayer (${formatMoney(s.yesterdaySales, s.currency)}).`;
    }
  },

  // ¿Qué debo comprar?
  {
    name: "QUE_COMPRAR",
    test: (t) => /(debo|deberia|tengo que|necesito) comprar|que hay que comprar|recomendacion(es)? de compra|que compro/.test(t),
    build: (s) => {
      if (s.purchaseSuggestions.length === 0) {
        return "No hay productos que necesiten reposición urgente ahora mismo.";
      }
      const lines = s.purchaseSuggestions
        .slice(0, 5)
        .map((item) =>
          item.hasSalesHistory
            ? `- ${item.name}: comprar ${item.suggestedQuantity} unidades${
                item.daysUntilStockout !== null ? ` (se agota en ~${item.daysUntilStockout} día(s))` : ""
              }`
            : `- ${item.name}: reponer ${item.suggestedQuantity} unidad(es) hasta tu mínimo definido (aún no hay ventas registradas para calcular una cantidad basada en demanda)`
        );
      return `Esto es lo que te recomiendo comprar ahora:\n${lines.join("\n")}`;
    }
  },

  // ¿Qué productos se están agotando / stock bajo?
  {
    name: "STOCK_BAJO",
    test: (t) => /productos? (se estan |estan )?agotando|inventario bajo|stock bajo|poco stock/.test(t),
    build: (s) => {
      if (s.lowStockProducts.length === 0) return "No hay productos con inventario bajo en este momento.";
      const lines = s.lowStockProducts
        .slice(0, 8)
        .map((p) => `- ${p.name}: stock ${p.stock} (mínimo ${p.minStock})`);
      return `Productos con inventario bajo:\n${lines.join("\n")}`;
    }
  },

  // ¿Cuánto puedo preparar de X? / ¿qué me falta para producir?
  {
    name: "CAPACIDAD_PRODUCCION",
    test: (t) =>
      /cuant[oa]s? (\w+\s+)?puedo (preparar|hacer|producir)|capacidad de produccion|que me falta para (preparar|producir)|que puedo preparar/.test(
        t
      ),
    build: (s) => {
      if (s.productionAlerts.length === 0) {
        return "Toda tu producción está al día: ningún producto con receta tiene su capacidad limitada ahora mismo.";
      }
      const lines = s.productionAlerts
        .slice(0, 8)
        .map((p) => {
          const icon = p.level === "CRITICO" ? "🔴" : "🟠";
          const capacity =
            p.maxUnits > 0
              ? `puedes preparar ${p.maxUnits} unidad(es)`
              : "no puedes preparar ninguna unidad";
          const limiting = p.limitingIngredientName ? ` — te falta ${p.limitingIngredientName}` : "";
          return `${icon} ${p.productName}: ${capacity}${limiting}`;
        });
      return `Esto es lo que limita tu producción hoy:\n${lines.join("\n")}`;
    }
  },

  // ¿Quién vende más? / ¿qué empleado vende más?
  {
    name: "TOP_VENDEDOR",
    test: (t) => /quien vende mas|mejor vendedor|empleado que mas vende|que empleado vende/.test(t),
    build: (s) => {
      const [top] = s.topEmployees;
      if (!top) return "Aún no hay ventas suficientes asociadas a un empleado específico.";
      return `${top.name} es quien más vende: ${formatMoney(top.revenue, s.currency)} en ${top.salesCount} venta(s).`;
    }
  },

  // ¿Qué empleado anula/cancela/reembolsa más ventas?
  {
    name: "TOP_ANULADOR",
    test: (t) =>
      /quien anula mas|que empleado anula mas|empleado que mas anula|quien cancela mas ventas|que empleado cancela mas|quien reembolsa mas|que empleado reembolsa mas|empleado que mas devuelve/.test(
        t
      ),
    build: (s) => {
      const [top] = s.topRefundingEmployees;
      if (!top) return "No hay cancelaciones ni reembolsos registrados a nombre de un empleado.";
      return `${top.name} es quien más anula ventas: ${top.total} anulación(es) en total (${top.cancelCount} cancelación(es), ${top.refundCount} reembolso(s)).`;
    }
  },

  // ¿Qué producto deja más ganancia / es más rentable?
  {
    name: "PRODUCTO_RENTABLE",
    test: (t) => /producto (me )?deja mas ganancia|producto mas rentable|cual producto (es )?mas rentable|que me deja mas plata/.test(t),
    build: (s) => {
      const [top] = s.topProfitProducts;
      if (!top) {
        return "Registra el precio de compra de tus productos para calcular cuál deja más ganancia.";
      }
      return `"${top.name}" es el más rentable: ${formatMoney(top.profit, s.currency)} de ganancia (margen ${top.marginPercent}%, ${top.unitsSold} unidades vendidas).`;
    }
  },

  // ¿Qué producto vendo más / cuál es mi producto estrella?
  {
    name: "PRODUCTO_ESTRELLA",
    test: (t) => /que producto vendo mas|producto (mas vendido|estrella)|mi producto estrella/.test(t),
    build: (s) => {
      const [top] = s.topProducts;
      if (!top) return "Aún no hay ventas suficientes para identificar un producto estrella.";
      return `"${top.name}" es tu producto estrella: ${top.quantity} unidades vendidas por ${formatMoney(top.revenue, s.currency)}.`;
    }
  },

  // ¿Cuánto hay en caja?
  {
    name: "CAJA",
    test: (t) => /cuanto( dinero)? hay en caja|saldo de caja|como esta la caja|cuanta plata hay en caja/.test(t),
    build: (s) =>
      `Saldo total de caja: ${formatMoney(s.cash.balance, s.currency)}. Generado hoy: ${formatMoney(
        s.cash.todayBalance,
        s.currency
      )}.`
  },

  // ¿Qué pedidos están retrasados?
  {
    name: "PEDIDOS_RETRASADOS",
    test: (t) => /pedidos? (estan )?retrasad|comandas? retrasad|se esta demorando|pedidos atrasados/.test(t),
    build: (s) => {
      if (s.delayedOrders.length === 0) return "No hay pedidos retrasados en este momento.";
      const lines = s.delayedOrders
        .slice(0, 8)
        .map((o) => `- ${o.origin} (${o.status}): esperando hace ${o.minutesWaiting} min`);
      return `Pedidos retrasados en cocina:\n${lines.join("\n")}`;
    }
  },

  // ¿Qué pasará esta semana? / pronóstico
  {
    name: "PRONOSTICO_SEMANA",
    test: (t) => /pasar\w*\s+esta semana|pronostico( de)?( la)? semana|proyeccion( de)?( la)? semana|como estara la semana/.test(t),
    build: (s) => {
      if (!s.weeklyForecast) return "Aún no hay suficiente historial de ventas para proyectar la semana.";
      const lines = s.weeklyForecast.byDay.map((d) => `- ${d.day}: ~${formatMoney(d.projected, s.currency)}`);
      return `Proyección para los próximos 7 días: ${formatMoney(
        s.weeklyForecast.projectedTotal,
        s.currency
      )} en total (basado en ${s.weeklyForecast.basedOnWeeks} semana(s) de historial).\n${lines.join("\n")}`;
    }
  },

  // ¿Qué alertas hay?
  {
    name: "ALERTAS",
    test: (t) => /que alertas hay|hay alguna alerta|alertas activas/.test(t),
    build: (s) => s.smartAlerts.map((a) => `${a.icon} ${a.message}`).join("\n")
  },

  // ¿Cuántos clientes tengo / clientes nuevos?
  {
    name: "CLIENTES",
    test: (t) => /cuantos clientes|clientes nuevos/.test(t),
    build: (s) =>
      `Tienes ${s.customerStats.totalCustomers} cliente(s) registrado(s), ${s.customerStats.newCustomersToday} nuevo(s) hoy.`
  },

  // ¿Cómo va mi negocio? — resumen ejecutivo corto.
  {
    name: "RESUMEN_NEGOCIO",
    test: (t) =>
      /como (va|voy|esta|vamos)( mi negocio| el negocio)?\W*$/.test(t) ||
      /resumen (ejecutivo|del negocio)|dame un resumen|como esta el negocio/.test(t),
    build: (s) => {
      const lines: string[] = [];
      lines.push(`📊 Resumen de ${s.businessName}`);
      lines.push(
        `Ventas hoy: ${formatMoney(s.todaySales, s.currency)} (${s.salesGrowthPercent >= 0 ? "+" : ""}${
          s.salesGrowthPercent
        }% vs ayer) — ${s.totalOrdersToday} pedido(s)`
      );
      lines.push(`Ticket promedio: ${formatMoney(s.averageTicketToday, s.currency)}`);
      if (s.topProfitProducts.length > 0) {
        const topProfitTotal = s.topProfitProducts.reduce((sum, p) => sum + p.profit, 0);
        lines.push(
          `Ganancia de tus ${s.topProfitProducts.length} producto(s) más rentables: ${formatMoney(topProfitTotal, s.currency)}`
        );
      }
      lines.push(
        `Clientes: ${s.customerStats.totalCustomers} registrados (${s.customerStats.newCustomersToday} nuevo(s) hoy)`
      );
      lines.push(`Productos por agotarse: ${s.lowStockProducts.length}`);
      const criticalProduction = s.productionAlerts.filter((p) => p.level === "CRITICO")[0];
      if (criticalProduction) {
        const limiting = criticalProduction.limitingIngredientName
          ? ` (te falta ${criticalProduction.limitingIngredientName})`
          : "";
        lines.push(`🔴 No puedes preparar más "${criticalProduction.productName}"${limiting}`);
      }
      if (s.delayedOrders[0]) {
        lines.push(`Pedido más retrasado: ${s.delayedOrders[0].origin} (${s.delayedOrders[0].minutesWaiting} min esperando)`);
      }
      lines.push(`Salud del negocio: ${s.healthScore}/100 — ${s.healthMessage}`);
      if (s.smartAlerts[0] && s.smartAlerts[0].level !== "GREEN") {
        lines.push(`${s.smartAlerts[0].icon} ${s.smartAlerts[0].message}`);
      }
      if (s.aiRecommendations[0]) {
        lines.push(`Recomendación: ${s.aiRecommendations[0]}`);
      }
      return lines.join("\n");
    }
  },

  // ¿Qué recomienda la IA? (PASO 3 — SalesAI, InventoryAI, FinanceAI, CustomerAI, PredictionAI, RecommendationAI)
  {
    name: "RECOMENDACIONES_IA",
    test: (t) =>
      /que recomienda la ia|recomendaciones? de la ia|que dice la ia|prediccion de ventas|que me recomiendas/.test(t),
    build: (s) => {
      const { recommendations, prediction, finance } = s.aiInsights;
      if (recommendations.length === 0) {
        return `No hay recomendaciones críticas ahora mismo. Predicción para mañana: ${formatMoney(
          prediction.expectedSales,
          s.currency
        )} en ~${prediction.expectedOrders} pedido(s). ${prediction.recommendation}`;
      }
      const lines = recommendations
        .slice(0, 5)
        .map((r) => `- [${r.priority}] ${r.title}: ${r.description}`);
      lines.push(`Predicción para mañana: ${formatMoney(prediction.expectedSales, s.currency)}.`);
      lines.push(`Estado financiero: ${finance.status}.`);
      return lines.join("\n");
    }
  }
];

export class QuestionRouter {
  constructor(private readonly businessAnalyzer: BusinessAnalyzer) {}

  /**
   * Devuelve una respuesta instantánea si la pregunta calza con un patrón
   * conocido, o null si debe seguir el camino normal (preguntarle a Claude).
   * El snapshot solo se construye si de verdad hay un patrón que lo necesita,
   * para no gastar cómputo de más en preguntas que van a ir a Claude igual.
   */
  public async answer(rawText: string, businessName: string, currency: string): Promise<string | null> {
    const text = normalize(rawText);
    if (!text) return null;

    const handler = HANDLERS.find((h) => h.test(text));
    if (!handler) return null;

    const snapshot = await this.businessAnalyzer.buildSnapshot(businessName, currency);
    return handler.build(snapshot);
  }
}