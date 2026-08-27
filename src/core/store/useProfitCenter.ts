import { useCallback, useEffect, useMemo, useState } from "react";
import { container, productsReady, categoriesReady } from "../../infrastructure/di/CompositionRoot";
import { Category, Product, Sale, User } from "../entities/Entities";
import { Profitability, ProductionCapacity } from "../engines/RecipeEngine";
import { useVimdyEvent } from "../../hooks/useVimdyCore";
import { getSaleNetItems } from "../utils/saleRefunds";

/**
 * useProfitCenter — VIMDY FASE 5, PASO 2.4 (Centro de Ganancias)
 * ---------------------------------------------------------------------------
 * Convierte ventas en decisiones: no cuánto se vendió, sino DÓNDE se gana
 * dinero de verdad. Sigue el mismo patrón de useReports.ts (carga, eventos,
 * filtros derivados con useMemo) pero en vez de agregar por `total` de venta,
 * agrega por UTILIDAD real de cada línea vendida, usando siempre
 * RecipeEngine.getAllProfitability() como única fuente de verdad para costo
 * y margen — la misma que ya usan BusinessAnalyzer e Inventario. Nunca
 * inventa cifras: si el costo de un producto no es confiable (falta el
 * costo de algún ingrediente de su receta), lo marca con `costUnreliable`
 * en vez de mostrarlo como si fuera exacto.
 */

export type ProfitRange = "hoy" | "semana" | "mes" | "año" | "todo";

export const PROFIT_RANGE_LABEL: Record<ProfitRange, string> = {
  hoy: "Hoy",
  semana: "Esta semana",
  mes: "Este mes",
  año: "Este año",
  todo: "Todo"
};

export interface ProfitFilters {
  range: ProfitRange;
  categoryId: string; // "all" = sin filtro
  productId: string; // "all" = sin filtro
  employeeId: string; // "all" = sin filtro
}

export interface ProfitProductRow {
  productId: string;
  name: string;
  categoryId: string;
  categoryName: string;
  unitsSold: number;
  revenue: number;
  cost: number;
  profit: number;
  marginPercent: number;
  costUnreliable: boolean;
}

export interface ProfitAlert {
  level: "RED" | "ORANGE" | "GREEN";
  icon: string;
  message: string;
}

export interface ProfitRecommendation {
  productId: string;
  productName: string;
  action: string;
}

export interface TimeBucket {
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
  const day = copy.getDay(); // 0 = domingo
  copy.setDate(copy.getDate() - day);
  return copy;
}

function rangeStart(range: ProfitRange): Date | null {
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

export function useProfitCenter() {
  const [sales, setSales] = useState<Sale[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [employees, setEmployees] = useState<User[]>([]);
  const [profitability, setProfitability] = useState<Map<string, Profitability>>(new Map());
  const [capacities, setCapacities] = useState<Map<string, ProductionCapacity>>(new Map());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [filters, setFilters] = useState<ProfitFilters>({
    range: "mes",
    categoryId: "all",
    productId: "all",
    employeeId: "all"
  });

  const load = useCallback(async () => {
    await Promise.all([productsReady, categoriesReady]);
    const [allSales, allProducts, allCategories, allUsers, allProfitability, allCapacities] = await Promise.all([
      container.salesEngine.get().getAllSales(),
      container.inventoryEngine.get().listAll(),
      container.categoryEngine.get().listAll(),
      container.userEngine.get().listUsers(),
      container.recipeEngine.get().getAllProfitability(),
      container.recipeEngine.get().getAllProductionCapacities()
    ]);
    setSales(allSales);
    setProducts(allProducts);
    setCategories(allCategories);
    setEmployees(allUsers);
    setProfitability(allProfitability);
    setCapacities(allCapacities);
  }, []);

  useEffect(() => {
    setLoading(true);
    setError(null);
    load()
      .catch((e: any) => setError(e?.message ?? "No se pudo cargar el Centro de Ganancias."))
      .finally(() => setLoading(false));
  }, [load]);

  // Igual que useReports: se refresca solo, sin recargar la página, cuando
  // hay una venta nueva, cambia una receta/costo/precio (evento "inventory")
  // o hay un movimiento de caja relacionado (evento "payment").
  useVimdyEvent("sale", () => {
    load().catch((e: any) => setError(e?.message ?? "No se pudo cargar el Centro de Ganancias."));
  });
  useVimdyEvent("inventory", () => {
    load().catch((e: any) => setError(e?.message ?? "No se pudo cargar el Centro de Ganancias."));
  });
  useVimdyEvent("payment", () => {
    load().catch((e: any) => setError(e?.message ?? "No se pudo cargar el Centro de Ganancias."));
  });

  const paidSales = useMemo(
    () => sales.filter((s) => s.status === "PAID" || s.status === "CLOSED" || !s.status),
    [sales]
  );

  const productById = useMemo(() => new Map(products.map((p) => [p.id, p])), [products]);
  const categoryById = useMemo(() => new Map(categories.map((c) => [c.id, c])), [categories]);
  const employeeById = useMemo(() => new Map(employees.map((u) => [u.id, u])), [employees]);

  /** Utilidad de UNA línea vendida, según el costo/margen real ya calculado por RecipeEngine. */
  const lineProfit = useCallback(
    (productId: string, quantity: number, priceAtSale: number) => {
      const p = profitability.get(productId);
      if (!p) return { cost: 0, profit: priceAtSale * quantity, costUnreliable: true };
      return { cost: p.cost * quantity, profit: (priceAtSale - p.cost) * quantity, costUnreliable: p.costUnreliable };
    },
    [profitability]
  );

  // ---------------------------------------------------------------------
  // RESUMEN GENERAL — "Mostrar siempre", independiente de los filtros de
  // abajo: ganancia de hoy/semana/mes/año, calculadas sobre TODO el
  // historial de ventas pagadas, nunca sobre el subconjunto filtrado.
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

    paidSales.forEach((sale) => {
      const created = new Date(sale.createdAt);
      getSaleNetItems(sale).forEach((item) => {
        const { profit } = lineProfit(item.productId, item.quantity, item.price);
        if (created.getTime() >= boundaries.hoy.getTime()) totals.hoy += profit;
        if (created.getTime() >= boundaries.semana.getTime()) totals.semana += profit;
        if (created.getTime() >= boundaries.mes.getTime()) totals.mes += profit;
        if (created.getTime() >= boundaries.año.getTime()) totals.año += profit;
      });
    });

    return {
      day: fixed2(totals.hoy),
      week: fixed2(totals.semana),
      month: fixed2(totals.mes),
      year: fixed2(totals.año)
    };
  }, [paidSales, lineProfit]);

  // ---------------------------------------------------------------------
  // Ventas filtradas por rango + empleado (nivel venta), listas para que
  // los filtros de categoría/producto recorten a nivel de línea.
  // ---------------------------------------------------------------------
  const rangeFilteredSales = useMemo(() => {
    const from = rangeStart(filters.range);
    return paidSales.filter((sale) => {
      if (from && new Date(sale.createdAt).getTime() < from.getTime()) return false;
      if (filters.employeeId !== "all") {
        const belongsToEmployee = sale.waiterId === filters.employeeId || sale.cashierId === filters.employeeId;
        if (!belongsToEmployee) return false;
      }
      return true;
    });
  }, [paidSales, filters.range, filters.employeeId]);

  /** Agregado por producto (unidades, ingresos, costo, ganancia) sobre el alcance ya filtrado. */
  const productRows: ProfitProductRow[] = useMemo(() => {
    const agg = new Map<string, { unitsSold: number; revenue: number; cost: number; profit: number }>();

    rangeFilteredSales.forEach((sale) => {
      getSaleNetItems(sale).forEach((item) => {
        const product = productById.get(item.productId);
        if (!product) return;
        if (filters.categoryId !== "all" && product.categoryId !== filters.categoryId) return;
        if (filters.productId !== "all" && product.id !== filters.productId) return;

        const { cost, profit } = lineProfit(item.productId, item.quantity, item.price);
        const current = agg.get(item.productId) ?? { unitsSold: 0, revenue: 0, cost: 0, profit: 0 };
        current.unitsSold += item.quantity;
        current.revenue += item.quantity * item.price;
        current.cost += cost;
        current.profit += profit;
        agg.set(item.productId, current);
      });
    });

    const rows: ProfitProductRow[] = [];
    agg.forEach((value, productId) => {
      const product = productById.get(productId);
      if (!product) return;
      const p = profitability.get(productId);
      const category = categoryById.get(product.categoryId);
      rows.push({
        productId,
        name: product.name,
        categoryId: product.categoryId,
        categoryName: category?.name ?? "Sin categoría",
        unitsSold: value.unitsSold,
        revenue: fixed2(value.revenue),
        cost: fixed2(value.cost),
        profit: fixed2(value.profit),
        marginPercent: p ? Math.round(p.marginPercent) : 0,
        costUnreliable: p?.costUnreliable ?? true
      });
    });

    return rows;
  }, [rangeFilteredSales, productById, categoryById, profitability, filters.categoryId, filters.productId]);

  // ---------------------------------------------------------------------
  // Resumen del alcance filtrado: margen promedio, unidades, costo, utilidad.
  // ---------------------------------------------------------------------
  const filteredSummary = useMemo(() => {
    const totalRevenue = productRows.reduce((s, r) => s + r.revenue, 0);
    const totalCost = productRows.reduce((s, r) => s + r.cost, 0);
    const totalProfit = productRows.reduce((s, r) => s + r.profit, 0);
    const totalUnits = productRows.reduce((s, r) => s + r.unitsSold, 0);
    const averageMargin = totalRevenue > 0 ? (totalProfit / totalRevenue) * 100 : 0;

    return {
      averageMarginPercent: Math.round(averageMargin),
      unitsSold: totalUnits,
      productionCost: fixed2(totalCost),
      netProfit: fixed2(totalProfit),
      revenue: fixed2(totalRevenue)
    };
  }, [productRows]);

  // ---------------------------------------------------------------------
  // Producto estrella / menos rentable
  // ---------------------------------------------------------------------
  const averageUnitsSold = useMemo(() => {
    if (productRows.length === 0) return 0;
    return productRows.reduce((s, r) => s + r.unitsSold, 0) / productRows.length;
  }, [productRows]);

  const starProduct = useMemo(() => {
    if (productRows.length === 0) return null;
    return [...productRows].sort((a, b) => b.profit - a.profit)[0];
  }, [productRows]);

  const worstProduct = useMemo(() => {
    if (productRows.length === 0) return null;
    const sorted = [...productRows].sort((a, b) => a.profit - b.profit);
    const worst = sorted[0];

    let reason: string;
    if (worst.marginPercent <= 0) {
      reason = "Costo muy alto: el costo de producción iguala o supera el precio de venta.";
    } else if (averageUnitsSold > 0 && worst.unitsSold < averageUnitsSold * 0.3) {
      reason = "Muy pocas ventas: casi no rota frente al resto del catálogo en este periodo.";
    } else if (worst.marginPercent < 15) {
      reason = "Precio bajo: el margen que deja frente al costo es muy ajustado.";
    } else {
      reason = "Es el de menor utilidad del periodo, aunque dentro de rangos normales.";
    }

    return { ...worst, reason };
  }, [productRows, averageUnitsSold]);

  // ---------------------------------------------------------------------
  // Rankings top 10
  // ---------------------------------------------------------------------
  const rankings = useMemo(() => {
    const byProfit = [...productRows].sort((a, b) => b.profit - a.profit);
    const byMargin = [...productRows].sort((a, b) => b.marginPercent - a.marginPercent);
    const byUnits = [...productRows].sort((a, b) => b.unitsSold - a.unitsSold);
    const byLowestProfit = [...productRows].sort((a, b) => a.profit - b.profit);

    return {
      topProfit: byProfit.slice(0, 10),
      topMargin: byMargin.slice(0, 10),
      topUnits: byUnits.slice(0, 10),
      lowestProfit: byLowestProfit.slice(0, 10)
    };
  }, [productRows]);

  // ---------------------------------------------------------------------
  // Recomendaciones — siempre a partir de cifras reales ya calculadas
  // arriba (marginPercent, unitsSold, capacidad de producción real).
  // ---------------------------------------------------------------------
  const recommendations: ProfitRecommendation[] = useMemo(() => {
    const list: ProfitRecommendation[] = [];

    productRows.forEach((row) => {
      if (row.costUnreliable) {
        list.push({
          productId: row.productId,
          productName: row.name,
          action: "Registra el costo de este producto: falta el costo de algún ingrediente para calcular su ganancia real."
        });
        return;
      }

      if (row.marginPercent <= 0) {
        list.push({
          productId: row.productId,
          productName: row.name,
          action: "Revisa el costo de este producto: hoy no deja ganancia o genera pérdida."
        });
        return;
      }

      if (row.marginPercent >= 50 && averageUnitsSold > 0 && row.unitsSold < averageUnitsSold * 0.5) {
        list.push({
          productId: row.productId,
          productName: row.name,
          action: "Promociona este producto: deja un margen alto pero se vende poco."
        });
        return;
      }

      if (row.marginPercent < 15) {
        list.push({
          productId: row.productId,
          productName: row.name,
          action: "Sube el precio de este producto: el margen actual es muy ajustado."
        });
        return;
      }

      const capacity = capacities.get(row.productId);
      if (capacity && capacity.maxUnits <= 0 && row.unitsSold > averageUnitsSold) {
        list.push({
          productId: row.productId,
          productName: row.name,
          action: "Compra más ingredientes para este producto: se está agotando y es de los más vendidos."
        });
      }
    });

    return list.slice(0, 12);
  }, [productRows, averageUnitsSold, capacities]);

  // ---------------------------------------------------------------------
  // Alertas — comparación real contra el periodo anterior equivalente,
  // igual que hace BusinessAnalyzer con las ventas del Dashboard.
  // ---------------------------------------------------------------------
  const previousPeriodProfit = useMemo(() => {
    const from = rangeStart(filters.range);
    if (!from) return null;
    const spanMs = Date.now() - from.getTime();
    const previousFrom = new Date(from.getTime() - spanMs);

    let total = 0;
    paidSales.forEach((sale) => {
      const t = new Date(sale.createdAt).getTime();
      if (t < previousFrom.getTime() || t >= from.getTime()) return;
      getSaleNetItems(sale).forEach((item) => {
        const { profit } = lineProfit(item.productId, item.quantity, item.price);
        total += profit;
      });
    });
    return fixed2(total);
  }, [paidSales, filters.range, lineProfit]);

  const alerts: ProfitAlert[] = useMemo(() => {
    const list: ProfitAlert[] = [];

    productRows.forEach((row) => {
      if (row.profit < 0) {
        list.push({
          level: "RED",
          icon: "⚠",
          message: `${row.name} está perdiendo dinero: su costo supera lo que genera en ventas.`
        });
      } else if (row.marginPercent > 0 && row.marginPercent < 10 && averageUnitsSold > 0 && row.unitsSold >= averageUnitsSold) {
        list.push({
          level: "ORANGE",
          icon: "⚠",
          message: `${row.name} vende mucho pero deja poca utilidad (margen de ${row.marginPercent}%).`
        });
      }
    });

    if (previousPeriodProfit !== null && previousPeriodProfit > 0) {
      const change = ((filteredSummary.netProfit - previousPeriodProfit) / previousPeriodProfit) * 100;
      if (change <= -15) {
        list.push({
          level: "RED",
          icon: "⚠",
          message: `La utilidad bajó ${Math.abs(Math.round(change))}% frente al periodo anterior equivalente.`
        });
      } else if (change >= 15) {
        list.push({
          level: "GREEN",
          icon: "✓",
          message: `La utilidad subió ${Math.round(change)}% frente al periodo anterior equivalente.`
        });
      }
    }

    return list.slice(0, 10);
  }, [productRows, averageUnitsSold, previousPeriodProfit, filteredSummary.netProfit]);

  // ---------------------------------------------------------------------
  // Gráficas
  // ---------------------------------------------------------------------
  const profitTimeSeries: TimeBucket[] = useMemo(() => {
    // Granularidad adaptativa: día a día si el rango es corto (hoy/semana),
    // por semana si es un mes, por mes si es un año o todo el histórico.
    // Así una sola gráfica cubre "utilidad diaria/semanal/mensual" del PASO 2.4
    // sin duplicar tres componentes casi idénticos.
    const granularity: "day" | "week" | "month" =
      filters.range === "hoy" || filters.range === "semana" ? "day" : filters.range === "mes" ? "week" : "month";

    const buckets = new Map<string, { order: number; value: number }>();

    rangeFilteredSales.forEach((sale) => {
      const date = new Date(sale.createdAt);
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

      getSaleNetItems(sale).forEach((item) => {
        const product = productById.get(item.productId);
        if (filters.categoryId !== "all" && product?.categoryId !== filters.categoryId) return;
        if (filters.productId !== "all" && item.productId !== filters.productId) return;
        const { profit } = lineProfit(item.productId, item.quantity, item.price);
        const current = buckets.get(key) ?? { order, value: 0 };
        current.value += profit;
        buckets.set(key, current);
      });
    });

    return [...buckets.entries()]
      .sort((a, b) => a[1].order - b[1].order)
      .map(([label, { value }]) => ({ label, value: fixed2(value) }))
      .slice(-24);
  }, [rangeFilteredSales, filters.range, filters.categoryId, filters.productId, productById, lineProfit]);

  const profitByCategory: TimeBucket[] = useMemo(() => {
    const agg = new Map<string, number>();
    productRows.forEach((row) => {
      agg.set(row.categoryName, (agg.get(row.categoryName) ?? 0) + row.profit);
    });
    return [...agg.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([label, value]) => ({ label, value: fixed2(value) }));
  }, [productRows]);

  const profitByProduct: TimeBucket[] = useMemo(
    () => rankings.topProfit.slice(0, 8).map((r) => ({ label: r.name, value: r.profit })),
    [rankings.topProfit]
  );

  const setRange = useCallback((range: ProfitRange) => setFilters((f) => ({ ...f, range })), []);
  const setCategoryId = useCallback((categoryId: string) => setFilters((f) => ({ ...f, categoryId })), []);
  const setProductId = useCallback((productId: string) => setFilters((f) => ({ ...f, productId })), []);
  const setEmployeeId = useCallback((employeeId: string) => setFilters((f) => ({ ...f, employeeId })), []);

  return {
    loading,
    error,

    filters,
    setRange,
    setCategoryId,
    setProductId,
    setEmployeeId,

    categories,
    products,
    employees,

    alwaysOnSummary,
    filteredSummary,

    starProduct,
    worstProduct,

    rankings,
    recommendations,
    alerts,

    profitTimeSeries,
    profitByCategory,
    profitByProduct,

    hasAnyData: paidSales.length > 0,
    hasFilteredData: productRows.length > 0
  };
}