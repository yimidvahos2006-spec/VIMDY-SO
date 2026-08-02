import { CopilotEngine } from "../../core/engines/CopilotEngine";
import { CopilotApiClient } from "../../infrastructure/di/CopilotApiClient";
import { CopilotContextSnapshot, CopilotMessage } from "../../core/types/CopilotTypes";
import { formatMoney } from "../../core/utils/formatMoney";

/**
 * Cuántos mensajes previos de la conversación se reenvían a Claude junto
 * con la pregunta nueva. El contexto del negocio (ventas, inventario,
 * caja, alertas) ya se reconstruye completo y al minuto en cada pregunta
 * vía CopilotEngine.buildContextSnapshot — no depende del historial. Este
 * límite solo preserva el hilo conversacional reciente (ej. una pregunta
 * de seguimiento como "¿y la semana pasada?"), evitando que una sesión
 * larga (muchas preguntas seguidas) haga crecer el costo y la latencia de
 * cada llamada sin ningún beneficio real.
 */
const MAX_HISTORY_MESSAGES = 16;

/**
 * Convierte el snapshot de contexto en texto plano legible, que es lo que
 * de verdad entiende un modelo de lenguaje mejor que JSON crudo.
 */
function snapshotToPrompt(snapshot: CopilotContextSnapshot): string {
  const lines: string[] = [];

  lines.push(`Negocio: ${snapshot.businessName} (moneda: ${snapshot.currency})`);
  lines.push(`Fecha/hora del reporte: ${snapshot.generatedAt}`);
  lines.push("");
  lines.push("=== VENTAS ===");
  lines.push(`Ventas de hoy: ${formatMoney(snapshot.todaySales, snapshot.currency)} (${snapshot.totalOrdersToday} pedidos)`);
  lines.push(`Ventas de ayer: ${formatMoney(snapshot.yesterdaySales, snapshot.currency)}`);
  lines.push(
    `Variación hoy vs ayer: ${snapshot.salesGrowthPercent >= 0 ? "+" : ""}${snapshot.salesGrowthPercent}%`
  );
  lines.push(`Ventas históricas totales: ${formatMoney(snapshot.totalSalesAllTime, snapshot.currency)}`);

  if (snapshot.bestDayOfWeek) {
    lines.push(
      `Mejor día de la semana históricamente: ${snapshot.bestDayOfWeek.day} (${formatMoney(
        snapshot.bestDayOfWeek.total,
        snapshot.currency
      )} acumulados)`
    );
  }

  lines.push("");
  lines.push("=== PRODUCTOS MÁS VENDIDOS (por ingresos) ===");
  if (snapshot.topProducts.length === 0) {
    lines.push("Aún no hay ventas suficientes para calcular el top de productos.");
  } else {
    snapshot.topProducts.forEach((product, index) => {
      lines.push(
        `${index + 1}. ${product.name} — ${product.quantity} unidades — ${formatMoney(
          product.revenue,
          snapshot.currency
        )}`
      );
    });
  }

  lines.push("");
  lines.push("=== INVENTARIO BAJO ===");
  if (snapshot.lowStockProducts.length === 0) {
    lines.push("No hay productos con inventario bajo en este momento.");
  } else {
    snapshot.lowStockProducts.forEach((product) => {
      lines.push(`- ${product.name}: stock actual ${product.stock}, mínimo ${product.minStock}`);
    });
  }

  lines.push("");
  lines.push("=== PRODUCTOS MÁS RENTABLES (ganancia = precio venta - precio compra) ===");
  if (snapshot.topProfitProducts.length === 0) {
    lines.push(
      "No hay suficientes productos con precio de compra registrado para calcular ganancia. Sugiere al dueño capturar el precio de compra en cada producto."
    );
  } else {
    snapshot.topProfitProducts.forEach((product, index) => {
      lines.push(
        `${index + 1}. ${product.name} — ganancia total ${formatMoney(product.profit, snapshot.currency)} (${product.unitsSold} unidades, margen ${product.marginPercent}%)`
      );
    });
  }

  lines.push("");
  lines.push("=== EMPLEADOS QUE MÁS VENDEN ===");
  if (snapshot.topEmployees.length === 0) {
    lines.push("Aún no hay ventas suficientes asociadas a un empleado específico.");
  } else {
    snapshot.topEmployees.forEach((employee, index) => {
      lines.push(
        `${index + 1}. ${employee.name} — ${formatMoney(employee.revenue, snapshot.currency)} en ${employee.salesCount} ventas`
      );
    });
  }

  lines.push("");
  lines.push("=== EMPLEADOS QUE MÁS ANULAN/REEMBOLSAN VENTAS ===");
  if (snapshot.topRefundingEmployees.length === 0) {
    lines.push("No hay cancelaciones ni reembolsos registrados a nombre de un empleado.");
  } else {
    snapshot.topRefundingEmployees.forEach((employee, index) => {
      lines.push(
        `${index + 1}. ${employee.name} — ${employee.total} anulación(es) en total (${employee.cancelCount} cancelación(es), ${employee.refundCount} reembolso(s))`
      );
    });
  }

  lines.push("");
  lines.push("=== QUÉ COMPRAR (basado en velocidad de venta real de los últimos 30 días) ===");
  if (snapshot.purchaseSuggestions.length === 0) {
    lines.push("No hay productos que necesiten reposición urgente ahora mismo.");
  } else {
    snapshot.purchaseSuggestions.forEach((item) => {
      const eta =
        item.daysUntilStockout === null
          ? "sin ventas recientes para estimar cuándo se agota"
          : `se agota en ~${item.daysUntilStockout} día(s)`;
      const suggestion = item.hasSalesHistory
        ? `Sugerencia: comprar ${item.suggestedQuantity} unidades.`
        : `Aún no hay ventas registradas de este producto, así que no se puede calcular una cantidad basada en demanda real. Sugerencia: reponer ${item.suggestedQuantity} unidad(es) para llegar al mínimo que definiste.`;
      const salesLine = item.hasSalesHistory
        ? `vende ~${item.avgDailySales}/día, ${eta}`
        : "sin historial de ventas todavía";
      lines.push(`- ${item.name}: stock ${item.currentStock}, ${salesLine}. ${suggestion}`);
    });
  }

  lines.push("");
  lines.push("=== PRODUCTOS QUE CASI NO ROTAN (stock alto, ventas casi nulas en 30 días) ===");
  if (snapshot.slowMovers.length === 0) {
    lines.push("No hay productos estancados detectados.");
  } else {
    snapshot.slowMovers.forEach((item) => {
      lines.push(`- ${item.name}: stock ${item.stock}, solo ${item.unitsSoldLast30Days} unidad(es) vendida(s) en 30 días.`);
    });
  }

  lines.push("");
  lines.push("=== MESAS QUE MÁS TARDAN (duración promedio del pedido) ===");
  if (snapshot.tableTurnover.length === 0) {
    lines.push("Aún no hay suficientes pedidos de mesa completados para medir esto.");
  } else {
    snapshot.tableTurnover.forEach((row) => {
      lines.push(`- ${row.tableName}: ${row.avgMinutes} min en promedio (${row.ordersCount} pedidos medidos)`);
    });
  }

  lines.push("");
  lines.push("=== PROYECCIÓN PARA LOS PRÓXIMOS 7 DÍAS (estimado, no garantizado) ===");
  if (!snapshot.weeklyForecast) {
    lines.push("Aún no hay suficiente historial de ventas para proyectar la semana.");
  } else {
    lines.push(
      `Total estimado semana: ${formatMoney(snapshot.weeklyForecast.projectedTotal, snapshot.currency)} (basado en ${snapshot.weeklyForecast.basedOnWeeks} semana(s) de historial)`
    );
    snapshot.weeklyForecast.byDay.forEach((d) => {
      lines.push(`- ${d.day}: ~${formatMoney(d.projected, snapshot.currency)}`);
    });
  }

  lines.push("");
  lines.push("=== CAJA ===");
  lines.push(`Saldo total de caja: ${formatMoney(snapshot.cash.balance, snapshot.currency)}`);
  lines.push(`Saldo generado hoy: ${formatMoney(snapshot.cash.todayBalance, snapshot.currency)}`);

  lines.push("");
  lines.push("=== MESAS (estado en vivo) ===");
  lines.push(
    `Libres: ${snapshot.tableStatus.free} | Ocupadas: ${snapshot.tableStatus.busy} | Esperando comida: ${snapshot.tableStatus.waitingFood} | Esperando cuenta: ${snapshot.tableStatus.waitingBill} | Pagando: ${snapshot.tableStatus.paying} | Reservadas: ${snapshot.tableStatus.reserved} (total ${snapshot.tableStatus.total})`
  );

  lines.push("");
  lines.push("=== PEDIDOS RETRASADOS EN COCINA ===");
  if (snapshot.delayedOrders.length === 0) {
    lines.push("No hay pedidos retrasados en este momento.");
  } else {
    snapshot.delayedOrders.forEach((order) => {
      lines.push(`- ${order.origin} (${order.status}): esperando hace ${order.minutesWaiting} min`);
    });
  }

  lines.push("");
  lines.push("=== CLIENTES ===");
  lines.push(`Total de clientes registrados: ${snapshot.customerStats.totalCustomers}`);
  lines.push(`Clientes nuevos hoy: ${snapshot.customerStats.newCustomersToday}`);
  if (snapshot.customerStats.topCustomers.length > 0) {
    lines.push("Clientes que más le compran al negocio:");
    snapshot.customerStats.topCustomers.forEach((c, i) => {
      lines.push(
        `${i + 1}. ${c.name} — ${formatMoney(c.totalSpent, snapshot.currency)} en ${c.purchaseCount} compra(s)`
      );
    });
  }

  lines.push("");
  lines.push("=== ALERTAS INTELIGENTES ===");
  snapshot.smartAlerts.forEach((alert) => lines.push(`${alert.icon} ${alert.message}`));

  lines.push("");
  lines.push("=== OPERACIÓN ===");
  lines.push(`Alertas críticas activas: ${snapshot.criticalAlertsCount}`);
  lines.push(`Productos agotados: ${snapshot.outOfStockCount}`);
  lines.push(`Comandas de cocina pendientes: ${snapshot.kitchenPendingCount}`);
  lines.push(`Ticket promedio de hoy: ${formatMoney(snapshot.averageTicketToday, snapshot.currency)}`);
  lines.push(`Salud del negocio: ${snapshot.healthScore}/100 — ${snapshot.healthMessage}`);

  if (snapshot.aiRecommendations.length > 0) {
    lines.push("");
    lines.push("=== RECOMENDACIONES YA CALCULADAS POR EL SISTEMA ===");
    snapshot.aiRecommendations.forEach((rec) => lines.push(`- ${rec}`));
  }

  if (snapshot.learnedPatterns.length > 0) {
    lines.push("");
    lines.push("=== PATRONES APRENDIDOS DEL HISTORIAL (PASO 9) ===");
    snapshot.learnedPatterns.forEach((pattern) => lines.push(`- ${pattern.message}`));
  }

  return lines.join("\n");
}

const SYSTEM_INSTRUCTIONS = `
Eres el Copiloto VIMDY: el gerente virtual del negocio dentro del sistema VIMDY OS.
No eres un chatbot genérico — eres un asesor de negocio que solo habla con datos reales.

Reglas:
- Responde SIEMPRE en español, de forma directa, breve y accionable (como un gerente hablándole al dueño).
- Usa SOLO los datos del "CONTEXTO DEL NEGOCIO" que se te entrega abajo. Nunca inventes cifras.
- Si te preguntan algo que no está en el contexto (ej. datos de hace 6 meses si no aparecen), dilo con honestidad
  y sugiere dónde podría revisarlo dentro de VIMDY (ej. "revísalo en Reportes > Histórico").
- Cuando detectes un problema (inventario bajo, ventas cayendo, alertas críticas), sé propositivo:
  sugiere una acción concreta, no solo describas el problema.
- La proyección semanal es un ESTIMADO basado en patrones históricos, no una garantía. Si el negocio
  tiene poco historial, dilo abiertamente en vez de sonar más seguro de lo que los datos permiten.
- Usa cifras formateadas con la moneda del negocio.
- Mantén las respuestas cortas (máximo 4-5 líneas) salvo que te pidan un análisis detallado.
- Si te preguntan "¿Cómo voy?" o algo equivalente (resumen general, cómo está el negocio), responde con un
  resumen ejecutivo corto: ventas (y si suben o bajan), utilidad si hay datos de margen, clientes nuevos,
  ticket promedio, productos por agotarse, y 1-2 recomendaciones concretas — todo con las cifras reales del
  contexto, nunca inventadas.
- Si te piden ejecutar una acción dentro de VIMDY (crear producto, abrir caja, buscar un cliente, cerrar
  turno, etc.), tú todavía no puedes ejecutarla directamente: indícale con precisión en qué módulo de VIMDY
  hacerlo (ej. "Ve a Inventario → Nuevo producto" o "Ve a Caja → Abrir turno"), y si el contexto ya tiene la
  información que buscaba (ej. buscar un cliente que aparece en el top de clientes), dásela de una vez.
`.trim();

/**
 * CopilotService
 * ---------------------------------------------------------------------------
 * Capa de "Use Case": arma el contexto real del negocio (vía CopilotEngine),
 * construye el system prompt, y delega el envío a Claude en CopilotApiClient.
 * Es lo que la UI (CopilotPanel.tsx) llama directamente.
 */
export class CopilotService {
  constructor(
    private readonly engine: CopilotEngine,
    private readonly apiClient: CopilotApiClient
  ) {}

  public async ask(
    question: string,
    history: CopilotMessage[],
    businessName: string,
    currency: string
  ): Promise<string> {
    const snapshot = await this.engine.buildContextSnapshot(businessName, currency);
    const contextBlock = snapshotToPrompt(snapshot);

    const system = `${SYSTEM_INSTRUCTIONS}\n\n=== CONTEXTO DEL NEGOCIO (datos reales, actualizados ahora) ===\n${contextBlock}`;

    const recentHistory =
      history.length > MAX_HISTORY_MESSAGES ? history.slice(-MAX_HISTORY_MESSAGES) : history;

    const fullHistory: CopilotMessage[] = [
      ...recentHistory,
      {
        id: `local-${Date.now()}`,
        role: "user",
        content: question,
        createdAt: new Date()
      }
    ];

    return this.apiClient.sendMessage(system, fullHistory);
  }
}