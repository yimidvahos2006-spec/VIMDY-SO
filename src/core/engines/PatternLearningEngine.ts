import { BusinessSnapshotRecord } from "../entities/Entities";
import { IRepository } from "../../infrastructure/di/repositories/IRepository";
import { BusinessAnalyzer } from "./BusinessAnalyzer";

/** Mínimo de días de historial acumulado antes de que un patrón se considere confiable. */
const MIN_DAYS_FOR_TREND = 14;
/** Tamaño de la ventana usada para comparar "reciente" vs "anterior" al medir tendencia. */
const TREND_WINDOW_DAYS = 7;

export interface LearnedPattern {
  readonly kind: "TREND" | "TOP_PRODUCT" | "BEST_WEEKDAY" | "INSUFFICIENT_DATA";
  readonly message: string;
}

function toDayKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/**
 * PatternLearningEngine
 * ---------------------------------------------------------------------------
 * PASO 9 — Aprendizaje. A diferencia del resto de VIMDY Intelligence Engine
 * (que analiza el estado ACTUAL del negocio), este motor acumula una "foto"
 * diaria (BusinessSnapshotRecord) y, con el tiempo, detecta patrones reales
 * comparando esas fotos entre sí — nunca inventa una tendencia con menos
 * datos de los necesarios: si no hay suficiente historial, lo dice
 * explícitamente en vez de fingir una conclusión.
 *
 * No reemplaza a BusinessAnalyzer: lo alimenta. BusinessAnalyzer.buildSnapshot()
 * llama a detectPatterns() y agrega el resultado al contexto que recibe el
 * Copiloto, para que sus recomendaciones mejoren a medida que pasa el tiempo
 * (tal como pide el objetivo final de FASE 2).
 */
export class PatternLearningEngine {
  constructor(
    private readonly repository: IRepository<BusinessSnapshotRecord>,
    private readonly businessAnalyzer: BusinessAnalyzer
  ) {}

  /**
   * Guarda (o actualiza) la foto del negocio correspondiente a HOY.
   * Idempotente: se puede llamar varias veces el mismo día (ej. en cada
   * cierre de turno, si hay varios cajeros) sin generar fotos duplicadas,
   * porque el id de la foto es la fecha misma.
   */
  public async recordTodaySnapshot(businessName: string, currency: string): Promise<void> {
    const snapshot = await this.businessAnalyzer.buildSnapshot(businessName, currency);
    const now = new Date();
    const id = toDayKey(now);

    const record: BusinessSnapshotRecord = {
      id,
      date: now,
      totalSales: snapshot.todaySales,
      salesCount: snapshot.totalOrdersToday,
      averageTicket: snapshot.averageTicketToday,
      topProductName: snapshot.topProducts[0]?.name,
      lowStockCount: snapshot.lowStockProducts.length,
      createdAt: now
    };

    const existing = await this.repository.findById(id);
    if (existing) {
      await this.repository.update(record);
    } else {
      await this.repository.save(record);
    }
  }

  public async getHistory(): Promise<BusinessSnapshotRecord[]> {
    const all = await this.repository.findAll();
    return [...all].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
  }

  /**
   * Detecta patrones reales sobre el historial acumulado. Devuelve una lista
   * ordenada de hallazgos; si no hay suficiente historial, devuelve un único
   * item "INSUFFICIENT_DATA" explicando cuánto falta, en vez de fabricar
   * una tendencia con datos insuficientes.
   */
  public async detectPatterns(): Promise<LearnedPattern[]> {
    const history = await this.getHistory();

    if (history.length < MIN_DAYS_FOR_TREND) {
      return [
        {
          kind: "INSUFFICIENT_DATA",
          message: `Todavía acumulando historial para detectar patrones confiables: ${history.length} de ${MIN_DAYS_FOR_TREND} días necesarios.`
        }
      ];
    }

    const patterns: LearnedPattern[] = [];

    // Tendencia: promedio de los últimos N días vs. los N días anteriores.
    const recentWindow = history.slice(-TREND_WINDOW_DAYS);
    const priorWindow = history.slice(-TREND_WINDOW_DAYS * 2, -TREND_WINDOW_DAYS);

    if (recentWindow.length === TREND_WINDOW_DAYS && priorWindow.length === TREND_WINDOW_DAYS) {
      const avg = (rows: BusinessSnapshotRecord[]) =>
        rows.reduce((sum, r) => sum + r.totalSales, 0) / rows.length;

      const recentAvg = avg(recentWindow);
      const priorAvg = avg(priorWindow);
      const changePercent = priorAvg > 0 ? Math.round(((recentAvg - priorAvg) / priorAvg) * 100) : 0;

      if (Math.abs(changePercent) < 5) {
        patterns.push({
          kind: "TREND",
          message: `Tus ventas se han mantenido estables en los últimos ${TREND_WINDOW_DAYS} días (variación de ${changePercent}% frente a la semana anterior).`
        });
      } else if (changePercent > 0) {
        patterns.push({
          kind: "TREND",
          message: `Tus ventas están creciendo: los últimos ${TREND_WINDOW_DAYS} días promediaron ${changePercent}% más que los ${TREND_WINDOW_DAYS} días anteriores.`
        });
      } else {
        patterns.push({
          kind: "TREND",
          message: `Tus ventas están bajando: los últimos ${TREND_WINDOW_DAYS} días promediaron ${Math.abs(changePercent)}% menos que los ${TREND_WINDOW_DAYS} días anteriores.`
        });
      }
    }

    // Producto que más se repite como "más vendido del día".
    const topProductCounts = new Map<string, number>();
    history.forEach((record) => {
      if (!record.topProductName) return;
      topProductCounts.set(record.topProductName, (topProductCounts.get(record.topProductName) ?? 0) + 1);
    });

    if (topProductCounts.size > 0) {
      const [mostConsistentProduct, days] = [...topProductCounts.entries()].reduce((best, current) =>
        current[1] > best[1] ? current : best
      );

      if (days >= Math.floor(history.length * 0.4)) {
        patterns.push({
          kind: "TOP_PRODUCT",
          message: `"${mostConsistentProduct}" ha sido tu producto más vendido en ${days} de los últimos ${history.length} días registrados: es tu producto ancla.`
        });
      }
    }

    // Mejor día de la semana, medido sobre el historial acumulado (no sobre
    // todas las ventas históricas: esto mide el patrón reciente real).
    const totalsByWeekday = new Map<number, { total: number; count: number }>();
    history.forEach((record) => {
      const day = new Date(record.date).getDay();
      const current = totalsByWeekday.get(day) ?? { total: 0, count: 0 };
      current.total += record.totalSales;
      current.count += 1;
      totalsByWeekday.set(day, current);
    });

    if (totalsByWeekday.size >= 3) {
      const DAY_LABELS = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];
      const [bestDay, stats] = [...totalsByWeekday.entries()].reduce((best, current) =>
        current[1].total / current[1].count > best[1].total / best[1].count ? current : best
      );
      patterns.push({
        kind: "BEST_WEEKDAY",
        message: `Según tu historial acumulado, el ${DAY_LABELS[bestDay]} es tu mejor día de la semana (promedio de $${Math.round(
          stats.total / stats.count
        ).toLocaleString("es-CO")}).`
      });
    }

    if (patterns.length === 0) {
      patterns.push({
        kind: "INSUFFICIENT_DATA",
        message: "Hay suficientes días de historial, pero todavía no se detecta un patrón claro y consistente."
      });
    }

    return patterns;
  }
}