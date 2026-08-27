import { useCallback, useEffect, useMemo, useState } from "react";
import { container, productsReady, categoriesReady } from "../../infrastructure/di/CompositionRoot";
import { Category, InventoryMovement, LossCategory, Product, Sale, User } from "../entities/Entities";
import { Profitability } from "../engines/RecipeEngine";
import { LOSS_CATEGORY_LABEL, LOSS_CATEGORY_ORDER } from "../engines/lossCategoryLabels";
import { useVimdyEvent } from "../../hooks/useVimdyCore";
import { getSaleNetTotal } from "../utils/saleRefunds";

/**
 * useLossCenter — VIMDY FASE 5, PASO 2.5 (Centro de Pérdidas)
 * ---------------------------------------------------------------------------
 * Convierte cada salida de inventario SIN venta (merma, vencido, consumo
 * interno, robo, error, daño, ajuste administrativo, otro) en dinero real
 * perdido. Sigue el mismo patrón que useProfitCenter: carga una vez,
 * se refresca solo con los eventos reales del negocio, y todo lo derivado
 * usa useMemo. La fuente de la pérdida es siempre InventoryMovement
 * (KardexEngine), nunca inventada; el valor en dinero sale del mismo costo
 * real que ya calcula RecipeEngine para Centro de Ganancias — si el costo
 * de un producto no es confiable, ese movimiento no se suma a ningún total
 * (mismo criterio que costUnreliable en useProfitCenter).
 */

export type LossRange = "hoy" | "semana" | "mes" | "año" | "todo";

export const LOSS_RANGE_LABEL: Record<LossRange, string> = {
  hoy: "Hoy",
  semana: "Esta semana",
  mes: "Este mes",
  año: "Este año",
  todo: "Todo"
};

export type RiskLevel = "BAJO" | "MEDIO" | "ALTO";

export const RISK_LEVEL_LABEL: Record<RiskLevel, string> = {
  BAJO: "🟢 Bajo",
  MEDIO: "🟡 Medio",
  ALTO: "🔴 Alto"
};

export interface LossFilters {
  range: LossRange;
  category: LossCategory | "all";
  productId: string; // "all" = sin filtro
  employeeId: string; // "all" = sin filtro (nombre de quien registró el movimiento)
}

export interface LossProductRow {
  productId: string;
  name: string;
  categoryId: string;
  categoryName: string;
  quantityLost: number;
  valueLost: number;
  mainReason: LossCategory;
  mainReasonLabel: string;
  movementsCount: number;
  costUnreliable: boolean;
}

export interface LossHistoryEntry {
  id: string;
  productId: string;
  productName: string;
  quantity: number;
  value: number;
  costUnreliable: boolean;
  reason: string;
  lossCategory: LossCategory;
  lossCategoryLabel: string;
  performedBy?: string;
  date: Date;
}

export interface LossAlert {
  level: "RED" | "ORANGE" | "YELLOW";
  icon: string;
  message: string;
}

export interface LossRecommendation {
  productId: string;
  productName: string;
  action: string;
}

export interface LossBucket {
  label: string;
  value: number;
}

function startOfDay(date: Date): Date {
  const copy = new Date(date);
  copy.setHours(0, 0, 0, 0);
  return copy;
}

function startOfWeek(date: Date): Date {
  const copy = startOfDay(date);
  const day = copy.getDay();
  copy.setDate(copy.getDate() - day);
  return copy;
}

function rangeStart(range: LossRange): Date | null {
  const now = new Date();
  if (range === "hoy") return startOfDay(now);
  if (range === "semana") return startOfWeek(now);
  if (range === "mes") return new Date(now.getFullYear(), now.getMonth(), 1);
  if (range === "año") return new Date(now.getFullYear(), 0, 1);
  return null;
}

function fixed2(value: number): number {
  return Math.round(value * 100) / 100;
}

/** Categorías que representan una salida "evitable" con mejores procesos (todo menos robo). Usado para "dinero recuperable". */
const RECOVERABLE_CATEGORIES: LossCategory[] = ["MERMA", "VENCIDO", "ERROR", "DAÑO", "AJUSTE_ADMINISTRATIVO", "OTRO"];

export function useLossCenter() {
  const [movements, setMovements] = useState<InventoryMovement[]>([]);
  const [sales, setSales] = useState<Sale[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [employees, setEmployees] = useState<User[]>([]);
  const [profitability, setProfitability] = useState<Map<string, Profitability>>(new Map());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [filters, setFilters] = useState<LossFilters>({
    range: "mes",
    category: "all",
    productId: "all",
    employeeId: "all"
  });

  const load = useCallback(async () => {
    await Promise.all([productsReady, categoriesReady]);
    const [allMovements, allSales, allProducts, allCategories, allUsers, allProfitability] = await Promise.all([
      container.kardexEngine.get().getAllMovements(),
      container.salesEngine.get().getAllSales(),
      container.inventoryEngine.get().listAll(),
      container.categoryEngine.get().listAll(),
      container.userEngine.get().listUsers(),
      container.recipeEngine.get().getAllProfitability()
    ]);
    setMovements(allMovements);
    setSales(allSales);
    setProducts(allProducts);
    setCategories(allCategories);
    setEmployees(allUsers);
    setProfitability(allProfitability);
  }, []);

  useEffect(() => {
    setLoading(true);
    setError(null);
    load()
      .catch((e: any) => setError(e?.message ?? "No se pudo cargar el Centro de Pérdidas."))
      .finally(() => setLoading(false));
  }, [load]);

  // Se refresca solo, sin recargar la página, ante cualquier movimiento
  // real de inventario (merma, ajuste, venta que cambia costo/receta) o de caja.
  useVimdyEvent("inventory", () => {
    load().catch((e: any) => setError(e?.message ?? "No se pudo cargar el Centro de Pérdidas."));
  });
  useVimdyEvent("sale", () => {
    load().catch((e: any) => setError(e?.message ?? "No se pudo cargar el Centro de Pérdidas."));
  });
  useVimdyEvent("payment", () => {
    load().catch((e: any) => setError(e?.message ?? "No se pudo cargar el Centro de Pérdidas."));
  });

  const productById = useMemo(() => new Map(products.map((p) => [p.id, p])), [products]);
  const categoryById = useMemo(() => new Map(categories.map((c) => [c.id, c])), [categories]);

  /** Solo movimientos que son una pérdida real: salida de stock con motivo de pérdida registrado. */
  const lossMovements = useMemo(
    () => movements.filter((m) => m.type === "DECREASE" && !!m.lossCategory),
    [movements]
  );

  /** Valor en dinero de UN movimiento de pérdida, según el costo real ya calculado por RecipeEngine. */
  const movementValue = useCallback(
    (productId: string, quantity: number) => {
      const p = profitability.get(productId);
      if (!p) return { value: 0, costUnreliable: true };
      return { value: fixed2(p.cost * quantity), costUnreliable: p.costUnreliable };
    },
    [profitability]
  );

  // ---------------------------------------------------------------------
  // RESUMEN GENERAL — siempre visible, independiente de los filtros:
  // pérdida de hoy/semana/mes/año sobre TODO el histórico de movimientos.
  // ---------------------------------------------------------------------
  const alwaysOnSummary = useMemo(() => {
    const now = new Date();
    const boundaries = {
      hoy: startOfDay(now),
      semana: startOfWeek(now),
      mes: new Date(now.getFullYear(), now.getMonth(), 1),
      año: new Date(now.getFullYear(), 0, 1)
    };
    const totals = { hoy: 0, semana: 0, mes: 0, año: 0 };
    let recoverable = 0;

    lossMovements.forEach((m) => {
      const { value, costUnreliable } = movementValue(m.productId, m.quantity);
      if (costUnreliable) return;
      const date = new Date(m.date);
      if (date.getTime() >= boundaries.hoy.getTime()) totals.hoy += value;
      if (date.getTime() >= boundaries.semana.getTime()) totals.semana += value;
      if (date.getTime() >= boundaries.mes.getTime()) totals.mes += value;
      if (date.getTime() >= boundaries.año.getTime()) totals.año += value;
      if (date.getTime() >= boundaries.mes.getTime() && m.lossCategory && RECOVERABLE_CATEGORIES.includes(m.lossCategory)) {
        recoverable += value;
      }
    });

    // Nivel de riesgo: pérdida del mes como porcentaje de las ventas del
    // mes. Si todavía no hay ventas este mes, se usa un umbral absoluto
    // razonable para no dividir por cero ni ocultar el riesgo.
    const monthRevenue = sales
      .filter((s) => {
        const created = new Date(s.createdAt);
        return (
          created.getTime() >= boundaries.mes.getTime() &&
          (s.status === "PAID" || s.status === "CLOSED" || !s.status)
        );
      })
      // Fase 3 (5.2 / consistencia con reembolso parcial): antes sumaba
      // s.total a secas. Una venta con devolución parcial se queda en
      // PAID/CLOSED (no cambia de status), así que sin restar lo
      // reembolsado, el % de pérdida sobre ventas queda artificialmente
      // más bajo de lo real — justo el tipo de "el número no cuadra" que
      // el bloqueante #1.11 de la auditoría marca como crítico.
      .reduce((sum, s) => sum + getSaleNetTotal(s), 0);

    let riskLevel: RiskLevel = "BAJO";
    if (monthRevenue > 0) {
      const ratio = (totals.mes / monthRevenue) * 100;
      riskLevel = ratio >= 12 ? "ALTO" : ratio >= 5 ? "MEDIO" : "BAJO";
    } else {
      riskLevel = totals.mes > 300000 ? "ALTO" : totals.mes > 80000 ? "MEDIO" : "BAJO";
    }

    return {
      day: fixed2(totals.hoy),
      week: fixed2(totals.semana),
      month: fixed2(totals.mes),
      year: fixed2(totals.año),
      recoverable: fixed2(recoverable),
      riskLevel
    };
  }, [lossMovements, movementValue, sales]);

  // ---------------------------------------------------------------------
  // Movimientos filtrados por rango + categoría + producto + empleado
  // ---------------------------------------------------------------------
  const filteredMovements = useMemo(() => {
    const from = rangeStart(filters.range);
    return lossMovements.filter((m) => {
      if (from && new Date(m.date).getTime() < from.getTime()) return false;
      if (filters.category !== "all" && m.lossCategory !== filters.category) return false;
      if (filters.productId !== "all" && m.productId !== filters.productId) return false;
      if (filters.employeeId !== "all" && (m.performedBy ?? "Sistema") !== filters.employeeId) return false;
      return true;
    });
  }, [lossMovements, filters]);

  // ---------------------------------------------------------------------
  // CLASIFICACIÓN DE PÉRDIDAS — cuánto dinero se perdió por cada motivo.
  // ---------------------------------------------------------------------
  const lossByCategory: LossBucket[] = useMemo(() => {
    const agg = new Map<LossCategory, number>();
    filteredMovements.forEach((m) => {
      if (!m.lossCategory) return;
      const { value, costUnreliable } = movementValue(m.productId, m.quantity);
      if (costUnreliable) return;
      agg.set(m.lossCategory, (agg.get(m.lossCategory) ?? 0) + value);
    });
    return LOSS_CATEGORY_ORDER.filter((c) => agg.has(c)).map((c) => ({
      label: LOSS_CATEGORY_LABEL[c],
      value: fixed2(agg.get(c) ?? 0)
    }));
  }, [filteredMovements, movementValue]);

  // ---------------------------------------------------------------------
  // PRODUCTOS MÁS AFECTADOS — agregado por producto sobre el alcance filtrado.
  // ---------------------------------------------------------------------
  const productRows: LossProductRow[] = useMemo(() => {
    const agg = new Map<
      string,
      { quantity: number; value: number; count: number; byCategory: Map<LossCategory, number>; unreliable: boolean }
    >();

    filteredMovements.forEach((m) => {
      if (!m.lossCategory) return;
      const { value, costUnreliable } = movementValue(m.productId, m.quantity);
      const current =
        agg.get(m.productId) ?? { quantity: 0, value: 0, count: 0, byCategory: new Map(), unreliable: false };
      current.quantity += m.quantity;
      current.value += costUnreliable ? 0 : value;
      current.count += 1;
      current.unreliable = current.unreliable || costUnreliable;
      current.byCategory.set(m.lossCategory, (current.byCategory.get(m.lossCategory) ?? 0) + m.quantity);
      agg.set(m.productId, current);
    });

    const rows: LossProductRow[] = [];
    agg.forEach((value, productId) => {
      const product = productById.get(productId);
      if (!product) return;
      const category = categoryById.get(product.categoryId);
      const mainReason = [...value.byCategory.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "OTRO";
      rows.push({
        productId,
        name: product.name,
        categoryId: product.categoryId,
        categoryName: category?.name ?? "Sin categoría",
        quantityLost: value.quantity,
        valueLost: fixed2(value.value),
        mainReason,
        mainReasonLabel: LOSS_CATEGORY_LABEL[mainReason],
        movementsCount: value.count,
        costUnreliable: value.unreliable
      });
    });

    return rows.sort((a, b) => b.valueLost - a.valueLost);
  }, [filteredMovements, movementValue, productById, categoryById]);

  const topAffectedProducts = useMemo(() => productRows.slice(0, 10), [productRows]);

  const filteredSummary = useMemo(() => {
    const totalValue = productRows.reduce((s, r) => s + r.valueLost, 0);
    const totalQuantity = productRows.reduce((s, r) => s + r.quantityLost, 0);
    return {
      totalValue: fixed2(totalValue),
      totalQuantity,
      movementsCount: filteredMovements.length,
      affectedProducts: productRows.length
    };
  }, [productRows, filteredMovements]);

  // ---------------------------------------------------------------------
  // HISTORIAL — lista de movimientos filtrados, lista para tabla/consulta.
  // ---------------------------------------------------------------------
  const history: LossHistoryEntry[] = useMemo(() => {
    return filteredMovements
      .map((m) => {
        const product = productById.get(m.productId);
        const { value, costUnreliable } = movementValue(m.productId, m.quantity);
        return {
          id: m.id,
          productId: m.productId,
          productName: product?.name ?? "Producto eliminado",
          quantity: m.quantity,
          value,
          costUnreliable,
          reason: m.reason,
          lossCategory: m.lossCategory as LossCategory,
          lossCategoryLabel: LOSS_CATEGORY_LABEL[m.lossCategory as LossCategory],
          performedBy: m.performedBy,
          date: new Date(m.date)
        };
      })
      .sort((a, b) => b.date.getTime() - a.date.getTime());
  }, [filteredMovements, productById, movementValue]);

  // ---------------------------------------------------------------------
  // ALERTAS — patrones reales sobre el alcance filtrado.
  // ---------------------------------------------------------------------
  const alerts: LossAlert[] = useMemo(() => {
    const list: LossAlert[] = [];

    // Producto con pérdida dominante por merma.
    const mermaRows = productRows.filter((r) => r.mainReason === "MERMA" && r.valueLost > 0);
    if (mermaRows[0]) {
      list.push({
        level: "ORANGE",
        icon: "⚠",
        message: `Estás perdiendo demasiado "${mermaRows[0].name}" por merma ($${Math.round(
          mermaRows[0].valueLost
        ).toLocaleString("es-CO")}).`
      });
    }

    // Vencimientos del periodo.
    const vencidoTotal = lossByCategory.find((b) => b.label === LOSS_CATEGORY_LABEL.VENCIDO)?.value ?? 0;
    if (vencidoTotal > 0) {
      list.push({
        level: "RED",
        icon: "⚠",
        message: `Se vencieron productos por $${Math.round(vencidoTotal).toLocaleString("es-CO")} en este periodo.`
      });
    }

    // Producto con diferencias frecuentes (errores repetidos).
    const errorProneRows = productRows.filter((r) => r.mainReason === "ERROR" && r.movementsCount >= 3);
    if (errorProneRows[0]) {
      list.push({
        level: "YELLOW",
        icon: "⚠",
        message: `Hay diferencias frecuentes en el inventario de "${errorProneRows[0].name}" (${errorProneRows[0].movementsCount} registros).`
      });
    }

    // Robo detectado.
    const roboTotal = lossByCategory.find((b) => b.label === LOSS_CATEGORY_LABEL.ROBO)?.value ?? 0;
    if (roboTotal > 0) {
      list.push({
        level: "RED",
        icon: "⚠",
        message: `Se registraron pérdidas por robo de $${Math.round(roboTotal).toLocaleString("es-CO")} en este periodo.`
      });
    }

    return list.slice(0, 10);
  }, [productRows, lossByCategory]);

  // ---------------------------------------------------------------------
  // RECOMENDACIONES — generadas solo a partir de los datos reales de arriba.
  // ---------------------------------------------------------------------
  const recommendations: LossRecommendation[] = useMemo(() => {
    const list: LossRecommendation[] = [];

    productRows.slice(0, 10).forEach((row) => {
      if (row.costUnreliable) {
        list.push({
          productId: row.productId,
          productName: row.name,
          action: "Registra el costo de este producto: falta el costo de algún ingrediente para calcular su pérdida real."
        });
        return;
      }
      if (row.mainReason === "MERMA") {
        list.push({ productId: row.productId, productName: row.name, action: "Reduce la producción de este producto o mejora su manejo: se está dañando antes de venderse." });
      } else if (row.mainReason === "VENCIDO") {
        list.push({ productId: row.productId, productName: row.name, action: "Compra menos cantidad de este producto: se está venciendo antes de venderse." });
      } else if (row.mainReason === "ROBO") {
        list.push({ productId: row.productId, productName: row.name, action: "Revisa los controles de acceso e inventario de este producto." });
      } else if (row.mainReason === "ERROR") {
        list.push({ productId: row.productId, productName: row.name, action: "Capacita al personal en el registro de este producto: hay diferencias frecuentes de inventario." });
      } else if (row.mainReason === "CONSUMO_INTERNO") {
        list.push({ productId: row.productId, productName: row.name, action: "Revisa y controla el consumo interno de este producto." });
      } else if (row.mainReason === "DAÑO") {
        list.push({ productId: row.productId, productName: row.name, action: "Mejora el almacenamiento o transporte de este producto: se está dañando." });
      }
    });

    return list.slice(0, 12);
  }, [productRows]);

  // ---------------------------------------------------------------------
  // GRÁFICAS
  // ---------------------------------------------------------------------
  const lossTimeSeries: LossBucket[] = useMemo(() => {
    const granularity: "day" | "week" | "month" =
      filters.range === "hoy" || filters.range === "semana" ? "day" : filters.range === "mes" ? "week" : "month";

    const buckets = new Map<string, { order: number; value: number }>();

    filteredMovements.forEach((m) => {
      const date = new Date(m.date);
      let key: string;
      let order: number;
      if (granularity === "day") {
        key = date.toLocaleDateString("es-CO", { day: "2-digit", month: "2-digit" });
        order = startOfDay(date).getTime();
      } else if (granularity === "week") {
        const weekStart = startOfWeek(date);
        key = `Sem. ${weekStart.toLocaleDateString("es-CO", { day: "2-digit", month: "2-digit" })}`;
        order = weekStart.getTime();
      } else {
        key = date.toLocaleDateString("es-CO", { month: "short", year: "2-digit" });
        order = new Date(date.getFullYear(), date.getMonth(), 1).getTime();
      }

      const { value, costUnreliable } = movementValue(m.productId, m.quantity);
      if (costUnreliable) return;
      const current = buckets.get(key) ?? { order, value: 0 };
      current.value += value;
      buckets.set(key, current);
    });

    return [...buckets.entries()]
      .sort((a, b) => a[1].order - b[1].order)
      .map(([label, { value }]) => ({ label, value: fixed2(value) }))
      .slice(-24);
  }, [filteredMovements, filters.range, movementValue]);

  /** Comparación entre meses: últimos 6 meses, siempre sobre TODO el histórico (no el filtro de rango). */
  const monthlyComparison: LossBucket[] = useMemo(() => {
    const buckets = new Map<string, { order: number; value: number }>();
    lossMovements.forEach((m) => {
      const date = new Date(m.date);
      const key = date.toLocaleDateString("es-CO", { month: "short", year: "2-digit" });
      const order = new Date(date.getFullYear(), date.getMonth(), 1).getTime();
      const { value, costUnreliable } = movementValue(m.productId, m.quantity);
      if (costUnreliable) return;
      const current = buckets.get(key) ?? { order, value: 0 };
      current.value += value;
      buckets.set(key, current);
    });
    return [...buckets.entries()]
      .sort((a, b) => a[1].order - b[1].order)
      .map(([label, { value }]) => ({ label, value: fixed2(value) }))
      .slice(-6);
  }, [lossMovements, movementValue]);

  const lossByProductChart: LossBucket[] = useMemo(
    () => topAffectedProducts.slice(0, 8).map((r) => ({ label: r.name, value: r.valueLost })),
    [topAffectedProducts]
  );

  const setRange = useCallback((range: LossRange) => setFilters((f) => ({ ...f, range })), []);
  const setCategory = useCallback((category: LossCategory | "all") => setFilters((f) => ({ ...f, category })), []);
  const setProductId = useCallback((productId: string) => setFilters((f) => ({ ...f, productId })), []);
  const setEmployeeId = useCallback((employeeId: string) => setFilters((f) => ({ ...f, employeeId })), []);

  const employeeNames = useMemo(() => {
    const names = new Set<string>();
    lossMovements.forEach((m) => names.add(m.performedBy ?? "Sistema"));
    return [...names];
  }, [lossMovements]);

  return {
    loading,
    error,

    filters,
    setRange,
    setCategory,
    setProductId,
    setEmployeeId,

    categories,
    products,
    employees,
    employeeNames,

    alwaysOnSummary,
    filteredSummary,

    lossByCategory,
    topAffectedProducts,
    productRows,

    alerts,
    recommendations,
    history,

    lossTimeSeries,
    monthlyComparison,
    lossByProductChart,

    hasAnyData: lossMovements.length > 0,
    hasFilteredData: productRows.length > 0
  };
}