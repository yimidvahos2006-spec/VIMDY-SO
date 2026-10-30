import type { CopilotContextSnapshot, CopilotMessage } from "../../core/types/CopilotTypes";
import { formatMoney } from "../../core/utils/formatMoney";
import { maskedStatusText } from "../../core/utils/stockMask";
import { AiProvider } from "../../core/ia/aiProvider";

/**
 * Convierte el snapshot de contexto en texto plano legible, que es lo que
 * de verdad entiende un modelo de lenguaje mejor que JSON crudo.
 */
export function snapshotToPrompt(snapshot: CopilotContextSnapshot): string {
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
  if (snapshot.stockMasked) {
    lines.push(
      "NOTA: hay un conteo de inventario a ciegas abierto, así que las cantidades exactas de stock están ocultas para esta persona. Solo se conoce el estado de cada producto (Disponible / Stock bajo / Agotado). No des, estimes ni inventes cantidades de stock; si te las piden, explica que están ocultas hasta que cierre el conteo."
    );
  }
  if (snapshot.lowStockProducts.length === 0) {
    lines.push("No hay productos con inventario bajo en este momento.");
  } else {
    snapshot.lowStockProducts.forEach((product) => {
      lines.push(
        product.stockMasked
          ? `- ${product.name}: ${maskedStatusText(product.stockStatus ?? "LOW")}`
          : `- ${product.name}: stock actual ${product.stock}, mínimo ${product.minStock}`
      );
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
      if (item.stockMasked) {
        lines.push(`- ${item.name}: ${maskedStatusText(item.stockStatus ?? "LOW")}. Conviene reponerlo (cantidad exacta oculta).`);
        return;
      }
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
  if (snapshot.cash.openShifts === 0) {
    lines.push("No hay ninguna caja abierta en este momento.");
  } else {
    lines.push(`Efectivo esperado en caja ahora (fondo inicial + ventas en efectivo − salidas): ${formatMoney(snapshot.cash.balance, snapshot.currency)}`);
  }
  lines.push(`Movimiento de caja de hoy (entradas − salidas, incluye tarjeta/transferencia): ${formatMoney(snapshot.cash.todayBalance, snapshot.currency)}`);

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

/**
 * CopilotService
 * ---------------------------------------------------------------------------
 * Capa de aplicación que conserva la firma usada por CopilotPanel y CopilotPage.
 * AiProvider se encarga de reconstruir el contexto actualizado, crear el
 * System Prompt e invocar CopilotApiClient a través del transporte seguro.
 *
 * businessName y currency se mantienen en la firma pública por compatibilidad
 * con la interfaz existente; el contexto financiero nuevo obtiene la moneda y
 * la zona horaria desde la configuración empresarial del propio agregador.
 */
export class CopilotService {
  constructor(private readonly aiProvider: AiProvider) {}

  public async ask(
    question: string,
    history: CopilotMessage[],
    _businessName: string,
    _currency: string
  ): Promise<string> {
    return this.aiProvider.ask(question, history);
  }
}