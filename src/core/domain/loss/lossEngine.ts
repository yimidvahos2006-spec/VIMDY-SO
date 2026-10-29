/**
 * lossEngine — Centro de Pérdidas (motor lógico).
 * ---------------------------------------------------------------------------
 * Módulo de dominio PURO y autocontenido: sin imports, sin efectos
 * secundarios, sin acceso a stores/repositorios/reloj/azar. Recibe datos
 * planos y devuelve estructuras nuevas; nunca muta sus argumentos. Al no
 * importar nada del proyecto no puede formar dependencias circulares.
 *
 * Qué hace:
 *   1. Define las categorías de pérdida (vencimiento, desperdicio, merma de
 *      preparación, cortesía, faltante) y el registro de una pérdida.
 *   2. Costea cada pérdida (costo congelado al registrarla; si falta, el costo
 *      actual del inventario) y la agrupa por categoría y por producto/insumo.
 *   3. Cruza el resultado con el inventario (stock actual, productos por
 *      vencer) y con los ingresos del periodo, compara contra el periodo
 *      anterior y emite alertas legibles.
 *
 * Convenciones:
 *   - Periodo = [from, to): `from` inclusivo, `to` exclusivo. Cualquiera de
 *     los dos puede faltar (abierto por ese lado).
 *   - Fechas: Date, timestamp en ms o texto ISO. Una fecha inválida deja la
 *     pérdida FUERA de cualquier periodo con límites y se informa en
 *     `invalidRecords`.
 *   - Porcentajes en escala 0–100. Nunca se produce NaN/Infinity: si el
 *     divisor es 0, el resultado es 0 (o null cuando "no hay con qué comparar").
 *   - Un registro con cantidad no finita o <= 0 es inválido: no suma costo.
 *   - Un costo desconocido NO se inventa: la pérdida cuenta como unidades pero
 *     aporta 0 al costo y se marca (`unknownCostRecords`, `costKnown`).
 */

/* ========================================================================== */
/* Categorías                                                                 */
/* ========================================================================== */

export type LossCategory = "VENCIMIENTO" | "DESPERDICIO" | "MERMA_PREPARACION" | "CORTESIA" | "FALTANTE";

/** Orden sugerido para selects, leyendas y tablas. */
export const LOSS_CATEGORIES: readonly LossCategory[] = [
  "VENCIMIENTO",
  "DESPERDICIO",
  "MERMA_PREPARACION",
  "CORTESIA",
  "FALTANTE"
];

export const LOSS_CATEGORY_LABELS: Readonly<Record<LossCategory, string>> = {
  VENCIMIENTO: "Vencimiento",
  DESPERDICIO: "Desperdicio",
  MERMA_PREPARACION: "Merma de preparación",
  CORTESIA: "Cortesía",
  FALTANTE: "Faltante"
};

/** Qué significa cada categoría (texto corto para formularios y tooltips). */
export const LOSS_CATEGORY_HINTS: Readonly<Record<LossCategory, string>> = {
  VENCIMIENTO: "Producto que se venció o se dañó por falta de rotación.",
  DESPERDICIO: "Producto preparado o servido que se botó (error, devolución, sobrante).",
  MERMA_PREPARACION: "Pérdida normal al procesar: cáscaras, grasa, desecho, evaporación.",
  CORTESIA: "Producto regalado o consumo interno autorizado: se entregó, no se cobró.",
  FALTANTE: "Diferencia sin explicación entre el stock del sistema y el conteo real."
};

/** Categorías que normalmente se pueden evitar con mejor gestión (no la merma normal ni la cortesía). */
export const AVOIDABLE_LOSS_CATEGORIES: readonly LossCategory[] = ["VENCIMIENTO", "DESPERDICIO", "FALTANTE"];

/**
 * Puente con códigos antiguos o externos (MERMA, VENCIDO, CONSUMO_INTERNO,
 * ROBO, ERROR, DAÑO…). Devuelve null si el texto no se reconoce: el llamador
 * decide qué hacer en vez de que el motor adivine.
 */
export function normalizeLossCategory(raw: string | null | undefined): LossCategory | null {
  const key = (raw ?? "")
    .trim()
    .toUpperCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[\s-]+/g, "_");

  switch (key) {
    case "VENCIMIENTO":
    case "VENCIDO":
    case "EXPIRADO":
    case "CADUCADO":
      return "VENCIMIENTO";
    case "DESPERDICIO":
    case "DANO":
    case "DAMAGE":
    case "WASTE":
      return "DESPERDICIO";
    case "MERMA_PREPARACION":
    case "MERMA":
    case "PREPARACION":
      return "MERMA_PREPARACION";
    case "CORTESIA":
    case "CONSUMO_INTERNO":
    case "REGALO":
      return "CORTESIA";
    case "FALTANTE":
    case "ROBO":
    case "ERROR":
    case "AJUSTE_ADMINISTRATIVO":
    case "SHRINKAGE":
      return "FALTANTE";
    default:
      return null;
  }
}

/* ========================================================================== */
/* Tipos de entrada                                                           */
/* ========================================================================== */

/** Fecha aceptada por el motor. */
export type LossTimestamp = Date | number | string;

/** Una pérdida registrada. */
export interface LossRecord {
  readonly id: string;
  /** Producto o insumo afectado (id del inventario). */
  readonly itemId: string;
  /** Nombre al momento del registro; si falta se usa el del inventario. */
  readonly itemName?: string | undefined;
  readonly category: LossCategory;
  /** Cantidad perdida, en la unidad del ítem. Debe ser > 0. */
  readonly quantity: number;
  /** Costo unitario congelado al registrar la pérdida (el que valía ese día). */
  readonly unitCost?: number | null | undefined;
  readonly occurredAt: LossTimestamp;
  readonly note?: string | undefined;
  readonly reportedBy?: string | undefined;
}

/** Foto del inventario actual, para cruzar con las pérdidas. */
export interface LossInventoryItem {
  readonly id: string;
  readonly name: string;
  readonly unit?: string | undefined;
  /** Existencias actuales. */
  readonly stock: number;
  /** Costo unitario actual (promedio ponderado o último precio). */
  readonly unitCost?: number | null | undefined;
  /** Fecha de vencimiento del lote más próximo, si se controla. */
  readonly expiresAt?: LossTimestamp | null | undefined;
}

/** Periodo [from, to). */
export interface LossPeriod {
  readonly from?: LossTimestamp | undefined;
  readonly to?: LossTimestamp | undefined;
}

export interface LossAnalysisOptions {
  /** Días hacia adelante para considerar un producto "por vencer". Por defecto 3. */
  readonly expiryWarningDays?: number | undefined;
  /** Pérdidas / ingresos (%) desde el que se alerta. Por defecto 5. */
  readonly revenueLossAlertPercent?: number | undefined;
  /** Una categoría con más de este % del costo total dispara alerta de concentración. Por defecto 50. */
  readonly concentrationAlertPercent?: number | undefined;
  /** Aumento (%) del costo frente al periodo anterior que dispara alerta. Por defecto 20. */
  readonly increaseAlertPercent?: number | undefined;
  /** Registros de un mismo ítem desde los que se considera "reincidente". Por defecto 3. */
  readonly repeatOffenderCount?: number | undefined;
  /** Cuántos ítems máximo devolver en `byItem`. Por defecto sin límite. */
  readonly topItems?: number | undefined;
  /** "Ahora" para calcular vencimientos. Obligatorio para que el motor sea determinista. */
  readonly now: LossTimestamp;
}

export interface LossAnalysisInput {
  readonly records: readonly LossRecord[];
  readonly inventory?: readonly LossInventoryItem[] | undefined;
  readonly period?: LossPeriod | undefined;
  /** Ingresos del mismo periodo, para medir pérdidas como % de las ventas. */
  readonly revenue?: number | null | undefined;
  readonly options: LossAnalysisOptions;
}

/* ========================================================================== */
/* Tipos de salida                                                            */
/* ========================================================================== */

export interface LossCategoryTotal {
  readonly category: LossCategory;
  readonly label: string;
  readonly recordCount: number;
  readonly cost: number;
  /** Parte del costo total (0–100). */
  readonly sharePercent: number;
}

export interface LossItemTotal {
  readonly itemId: string;
  readonly itemName: string;
  readonly unit: string | null;
  readonly recordCount: number;
  /** Total perdido, en la unidad del ítem. */
  readonly quantity: number;
  readonly cost: number;
  readonly sharePercent: number;
  /** Categoría que más costo aporta a este ítem. */
  readonly topCategory: LossCategory | null;
  readonly costByCategory: Readonly<Record<LossCategory, number>>;
  /** Existencias actuales; null si el ítem no está en el inventario recibido. */
  readonly stockNow: number | null;
  /**
   * Qué parte (0–100) de lo disponible se perdió: perdido / (perdido + stock
   * actual). Aproximación útil para comparar ítems; null sin inventario.
   */
  readonly lossRatePercent: number | null;
  /** true si algún registro de este ítem no tenía costo conocido. */
  readonly hasUnknownCost: boolean;
  readonly isRepeatOffender: boolean;
}

export interface ExpiryRiskItem {
  readonly itemId: string;
  readonly itemName: string;
  readonly unit: string | null;
  readonly stock: number;
  /** Días enteros hasta vencer; 0 = vence hoy, negativo = ya vencido con stock. */
  readonly daysLeft: number;
  /** Stock × costo unitario actual (0 si no hay costo). */
  readonly valueAtRisk: number;
}

export type LossAlertSeverity = "ALTA" | "MEDIA" | "BAJA";

export type LossAlertCode =
  | "PERDIDA_ALTA_VS_VENTAS"
  | "CATEGORIA_CONCENTRADA"
  | "AUMENTO_VS_PERIODO_ANTERIOR"
  | "PRODUCTOS_POR_VENCER"
  | "COSTO_DESCONOCIDO"
  | "REINCIDENTES";

export interface LossAlert {
  readonly code: LossAlertCode;
  readonly severity: LossAlertSeverity;
  readonly message: string;
}

export interface LossSummary {
  /** Costo total de las pérdidas del periodo. */
  readonly totalCost: number;
  /** Registros válidos dentro del periodo. */
  readonly recordCount: number;
  /** Costo de las categorías evitables (vencimiento, desperdicio, faltante). */
  readonly avoidableCost: number;
  readonly byCategory: readonly LossCategoryTotal[];
  readonly byItem: readonly LossItemTotal[];
  readonly topCategory: LossCategory | null;
  readonly topItemId: string | null;
  /** Pérdidas / ingresos × 100; null si no se pasaron ingresos > 0. */
  readonly lossPercentOfRevenue: number | null;
  /** Costo del periodo anterior de igual duración; null si el periodo es abierto. */
  readonly previousTotalCost: number | null;
  /** Cambio % del costo frente al periodo anterior; null si no hay base (0 o sin periodo). */
  readonly changePercent: number | null;
  /** Registros sin costo conocido (cantidad válida pero costo 0 por falta de dato). */
  readonly unknownCostRecords: number;
  /** Registros descartados por cantidad o fecha inválida (con periodo, la fecha inválida se descarta). */
  readonly invalidRecords: number;
  /** ids de ítems con pérdidas que no están en el inventario recibido. */
  readonly itemsMissingFromInventory: readonly string[];
  readonly expiryRisk: readonly ExpiryRiskItem[];
  readonly expiryRiskValue: number;
  readonly alerts: readonly LossAlert[];
}

/* ========================================================================== */
/* Utilidades internas                                                        */
/* ========================================================================== */

const MS_PER_DAY = 24 * 60 * 60 * 1000;

const DEFAULTS = {
  expiryWarningDays: 3,
  revenueLossAlertPercent: 5,
  concentrationAlertPercent: 50,
  increaseAlertPercent: 20,
  repeatOffenderCount: 3
} as const;

/** Convierte a ms epoch; null si no es una fecha válida. */
export function toLossTimestamp(value: LossTimestamp | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  const ms = value instanceof Date ? value.getTime() : typeof value === "number" ? value : Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}

function validQuantity(value: number): number {
  return Number.isFinite(value) && value > 0 ? value : 0;
}

/** Costo unitario válido (>= 0 y finito) o null. */
function validCost(value: number | null | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
}

function percentOf(part: number, whole: number): number {
  return whole > 0 && Number.isFinite(part) ? (part / whole) * 100 : 0;
}

function emptyCostByCategory(): Record<LossCategory, number> {
  return { VENCIMIENTO: 0, DESPERDICIO: 0, MERMA_PREPARACION: 0, CORTESIA: 0, FALTANTE: 0 };
}

function optionOrDefault(value: number | undefined, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : fallback;
}

/* ========================================================================== */
/* 1. Periodos                                                                */
/* ========================================================================== */

/** ¿La fecha cae dentro de [from, to)? Sin límites, toda fecha válida entra. */
export function isInLossPeriod(occurredAt: LossTimestamp, period: LossPeriod | undefined): boolean {
  const at = toLossTimestamp(occurredAt);
  const from = toLossTimestamp(period?.from);
  const to = toLossTimestamp(period?.to);
  if (at === null) return from === null && to === null;
  if (from !== null && at < from) return false;
  if (to !== null && at >= to) return false;
  return true;
}

/**
 * Periodo inmediatamente anterior y de igual duración. Solo existe si el
 * periodo tiene los dos límites y `to > from`; si no, devuelve null.
 */
export function previousLossPeriod(period: LossPeriod | undefined): { readonly from: number; readonly to: number } | null {
  const from = toLossTimestamp(period?.from);
  const to = toLossTimestamp(period?.to);
  if (from === null || to === null || to <= from) return null;
  return { from: from - (to - from), to: from };
}

/** Filtra las pérdidas del periodo (nuevo arreglo; no muta). */
export function filterLossesByPeriod(records: readonly LossRecord[], period: LossPeriod | undefined): LossRecord[] {
  return records.filter((record) => isInLossPeriod(record.occurredAt, period));
}

/* ========================================================================== */
/* 2. Costeo de una pérdida                                                   */
/* ========================================================================== */

export interface LossCostResult {
  /** quantity × costo unitario. 0 si la cantidad es inválida o no hay costo. */
  readonly cost: number;
  readonly quantity: number;
  /** false si no se pudo determinar un costo unitario (cost = 0 por falta de dato). */
  readonly costKnown: boolean;
  readonly source: "REGISTRO" | "INVENTARIO" | "NINGUNO";
}

/**
 * Costo de UNA pérdida. Prioridad: costo congelado en el registro (lo que
 * valía ese día) → costo actual del inventario → desconocido.
 */
export function computeLossCost(record: LossRecord, inventoryItem?: LossInventoryItem): LossCostResult {
  const quantity = validQuantity(record.quantity);
  const frozen = validCost(record.unitCost);
  if (frozen !== null) return { cost: quantity * frozen, quantity, costKnown: true, source: "REGISTRO" };

  const current = validCost(inventoryItem?.unitCost);
  if (current !== null) return { cost: quantity * current, quantity, costKnown: true, source: "INVENTARIO" };

  return { cost: 0, quantity, costKnown: false, source: "NINGUNO" };
}

/* ========================================================================== */
/* 3. Agrupación                                                              */
/* ========================================================================== */

interface ItemAccumulator {
  itemName: string;
  recordCount: number;
  quantity: number;
  cost: number;
  hasUnknownCost: boolean;
  costByCategory: Record<LossCategory, number>;
}

interface Aggregation {
  readonly totalCost: number;
  readonly recordCount: number;
  readonly unknownCostRecords: number;
  readonly invalidRecords: number;
  readonly categoryCost: Readonly<Record<LossCategory, number>>;
  readonly categoryCount: Readonly<Record<LossCategory, number>>;
  readonly items: ReadonlyMap<string, ItemAccumulator>;
}

function aggregate(
  records: readonly LossRecord[],
  inventoryById: ReadonlyMap<string, LossInventoryItem>
): Aggregation {
  const categoryCost = emptyCostByCategory();
  const categoryCount = emptyCostByCategory();
  const items = new Map<string, ItemAccumulator>();
  let totalCost = 0;
  let recordCount = 0;
  let unknownCostRecords = 0;
  let invalidRecords = 0;

  for (const record of records) {
    const inventoryItem = inventoryById.get(record.itemId);
    const result = computeLossCost(record, inventoryItem);
    if (result.quantity <= 0) {
      invalidRecords += 1;
      continue;
    }

    recordCount += 1;
    totalCost += result.cost;
    if (!result.costKnown) unknownCostRecords += 1;
    categoryCost[record.category] += result.cost;
    categoryCount[record.category] += 1;

    const acc: ItemAccumulator = items.get(record.itemId) ?? {
      itemName: record.itemName ?? inventoryItem?.name ?? record.itemId,
      recordCount: 0,
      quantity: 0,
      cost: 0,
      hasUnknownCost: false,
      costByCategory: emptyCostByCategory()
    };
    acc.recordCount += 1;
    acc.quantity += result.quantity;
    acc.cost += result.cost;
    acc.costByCategory[record.category] += result.cost;
    if (!result.costKnown) acc.hasUnknownCost = true;
    items.set(record.itemId, acc);
  }

  return { totalCost, recordCount, unknownCostRecords, invalidRecords, categoryCost, categoryCount, items };
}

/** Costo total de las pérdidas de un periodo (atajo para tarjetas y comparaciones). */
export function computeTotalLossCost(
  records: readonly LossRecord[],
  period?: LossPeriod,
  inventory: readonly LossInventoryItem[] = []
): number {
  const inventoryById = new Map(inventory.map((item) => [item.id, item]));
  return aggregate(filterLossesByPeriod(records, period), inventoryById).totalCost;
}

/** Agrupa las pérdidas por categoría (siempre las 5, aunque estén en 0). */
export function groupLossesByCategory(
  records: readonly LossRecord[],
  inventory: readonly LossInventoryItem[] = []
): LossCategoryTotal[] {
  const inventoryById = new Map(inventory.map((item) => [item.id, item]));
  const agg = aggregate(records, inventoryById);
  return LOSS_CATEGORIES.map((category) => ({
    category,
    label: LOSS_CATEGORY_LABELS[category],
    recordCount: agg.categoryCount[category],
    cost: agg.categoryCost[category],
    sharePercent: percentOf(agg.categoryCost[category], agg.totalCost)
  }));
}

function topCategoryOf(costs: Readonly<Record<LossCategory, number>>): LossCategory | null {
  let best: LossCategory | null = null;
  let bestCost = 0;
  for (const category of LOSS_CATEGORIES) {
    if (costs[category] > bestCost) {
      best = category;
      bestCost = costs[category];
    }
  }
  return best;
}

/** Agrupa por producto/insumo, de mayor a menor costo. Cruza con el inventario si se pasa. */
export function groupLossesByItem(
  records: readonly LossRecord[],
  inventory: readonly LossInventoryItem[] = [],
  repeatOffenderCount: number = DEFAULTS.repeatOffenderCount
): LossItemTotal[] {
  const inventoryById = new Map(inventory.map((item) => [item.id, item]));
  const agg = aggregate(records, inventoryById);
  const rows: LossItemTotal[] = [];

  for (const [itemId, acc] of agg.items) {
    const inventoryItem = inventoryById.get(itemId);
    const stockNow = inventoryItem ? Math.max(Number.isFinite(inventoryItem.stock) ? inventoryItem.stock : 0, 0) : null;
    rows.push({
      itemId,
      itemName: acc.itemName,
      unit: inventoryItem?.unit ?? null,
      recordCount: acc.recordCount,
      quantity: acc.quantity,
      cost: acc.cost,
      sharePercent: percentOf(acc.cost, agg.totalCost),
      topCategory: topCategoryOf(acc.costByCategory),
      costByCategory: acc.costByCategory,
      stockNow,
      lossRatePercent: stockNow === null ? null : percentOf(acc.quantity, acc.quantity + stockNow),
      hasUnknownCost: acc.hasUnknownCost,
      isRepeatOffender: acc.recordCount >= repeatOffenderCount
    });
  }

  rows.sort((a, b) => b.cost - a.cost || b.quantity - a.quantity || a.itemName.localeCompare(b.itemName));
  return rows;
}

/* ========================================================================== */
/* 4. Cruce con inventario: productos por vencer                              */
/* ========================================================================== */

/**
 * Productos con stock cuyo vencimiento cae dentro de `warningDays` (o ya
 * pasó). Es pérdida POTENCIAL: aún se puede vender, regalar con criterio o
 * producir con ellos antes de que se pierdan. Ordenado de más urgente a menos.
 */
export function findExpiryRisk(
  inventory: readonly LossInventoryItem[],
  now: LossTimestamp,
  warningDays: number = DEFAULTS.expiryWarningDays
): ExpiryRiskItem[] {
  const nowMs = toLossTimestamp(now);
  if (nowMs === null) return [];

  const limit = nowMs + optionOrDefault(warningDays, DEFAULTS.expiryWarningDays) * MS_PER_DAY;
  const risks: ExpiryRiskItem[] = [];

  for (const item of inventory) {
    const expires = toLossTimestamp(item.expiresAt);
    const stock = Number.isFinite(item.stock) ? item.stock : 0;
    if (expires === null || stock <= 0 || expires > limit) continue;

    const unitCost = validCost(item.unitCost) ?? 0;
    risks.push({
      itemId: item.id,
      itemName: item.name,
      unit: item.unit ?? null,
      stock,
      daysLeft: Math.floor((expires - nowMs) / MS_PER_DAY),
      valueAtRisk: stock * unitCost
    });
  }

  risks.sort((a, b) => a.daysLeft - b.daysLeft || b.valueAtRisk - a.valueAtRisk || a.itemName.localeCompare(b.itemName));
  return risks;
}

/* ========================================================================== */
/* 5. Resumen analítico                                                       */
/* ========================================================================== */

function buildAlerts(input: {
  readonly totalCost: number;
  readonly byCategory: readonly LossCategoryTotal[];
  readonly lossPercentOfRevenue: number | null;
  readonly changePercent: number | null;
  readonly unknownCostRecords: number;
  readonly expiryRisk: readonly ExpiryRiskItem[];
  readonly expiryRiskValue: number;
  readonly repeatOffenders: readonly LossItemTotal[];
  readonly revenueLossAlertPercent: number;
  readonly concentrationAlertPercent: number;
  readonly increaseAlertPercent: number;
  readonly expiryWarningDays: number;
}): LossAlert[] {
  const alerts: LossAlert[] = [];
  const pct = (value: number): string => `${Math.round(value * 10) / 10} %`;

  if (input.lossPercentOfRevenue !== null && input.lossPercentOfRevenue >= input.revenueLossAlertPercent) {
    alerts.push({
      code: "PERDIDA_ALTA_VS_VENTAS",
      severity: input.lossPercentOfRevenue >= input.revenueLossAlertPercent * 2 ? "ALTA" : "MEDIA",
      message: `Las pérdidas equivalen al ${pct(input.lossPercentOfRevenue)} de las ventas del periodo.`
    });
  }

  const dominant = input.byCategory.find(
    (entry) => entry.sharePercent > input.concentrationAlertPercent && input.totalCost > 0
  );
  if (dominant) {
    alerts.push({
      code: "CATEGORIA_CONCENTRADA",
      severity: dominant.category === "FALTANTE" || dominant.category === "VENCIMIENTO" ? "ALTA" : "MEDIA",
      message: `${dominant.label} concentra el ${pct(dominant.sharePercent)} del costo de las pérdidas.`
    });
  }

  if (input.changePercent !== null && input.changePercent >= input.increaseAlertPercent) {
    alerts.push({
      code: "AUMENTO_VS_PERIODO_ANTERIOR",
      severity: input.changePercent >= input.increaseAlertPercent * 2 ? "ALTA" : "MEDIA",
      message: `Las pérdidas subieron ${pct(input.changePercent)} frente al periodo anterior.`
    });
  }

  if (input.expiryRisk.length > 0) {
    const expired = input.expiryRisk.filter((risk) => risk.daysLeft < 0).length;
    alerts.push({
      code: "PRODUCTOS_POR_VENCER",
      severity: expired > 0 ? "ALTA" : "MEDIA",
      message:
        `${input.expiryRisk.length} producto(s) vencen en ${input.expiryWarningDays} día(s) o menos` +
        (expired > 0 ? ` (${expired} ya vencido(s))` : "") +
        ` (valor en riesgo: ${Math.round(input.expiryRiskValue)}).`
    });
  }

  if (input.repeatOffenders.length > 0) {
    alerts.push({
      code: "REINCIDENTES",
      severity: "BAJA",
      message: `${input.repeatOffenders.length} producto(s) tienen pérdidas repetidas en el periodo: ${input.repeatOffenders
        .slice(0, 3)
        .map((item) => item.itemName)
        .join(", ")}.`
    });
  }

  if (input.unknownCostRecords > 0) {
    alerts.push({
      code: "COSTO_DESCONOCIDO",
      severity: "BAJA",
      message: `${input.unknownCostRecords} pérdida(s) no tienen costo conocido: el total está subestimado.`
    });
  }

  const order: Readonly<Record<LossAlertSeverity, number>> = { ALTA: 0, MEDIA: 1, BAJA: 2 };
  return alerts.sort((a, b) => order[a.severity] - order[b.severity]);
}

/**
 * Resumen analítico del Centro de Pérdidas.
 *
 *   - Filtra al periodo [from, to) y costea cada pérdida.
 *   - Agrupa por categoría (siempre las 5) y por ítem.
 *   - Cruza con el inventario: stock actual, % de lo disponible que se perdió,
 *     productos por vencer y valor en riesgo.
 *   - Compara contra el periodo anterior de igual duración (si el periodo
 *     tiene ambos límites) y contra los ingresos (si se pasan).
 *   - Emite alertas ordenadas por severidad.
 */
export function summarizeLosses(input: LossAnalysisInput): LossSummary {
  const { options } = input;
  const inventory = input.inventory ?? [];
  const inventoryById = new Map(inventory.map((item) => [item.id, item]));

  const expiryWarningDays = optionOrDefault(options.expiryWarningDays, DEFAULTS.expiryWarningDays);
  const repeatCount = Math.max(optionOrDefault(options.repeatOffenderCount, DEFAULTS.repeatOffenderCount), 1);

  // Registros con fecha inválida no se pueden ubicar en un periodo con límites.
  const hasBounds = toLossTimestamp(input.period?.from) !== null || toLossTimestamp(input.period?.to) !== null;
  const undated = hasBounds ? input.records.filter((r) => toLossTimestamp(r.occurredAt) === null).length : 0;

  const inPeriod = filterLossesByPeriod(input.records, input.period);
  const agg = aggregate(inPeriod, inventoryById);

  const byCategory: LossCategoryTotal[] = LOSS_CATEGORIES.map((category) => ({
    category,
    label: LOSS_CATEGORY_LABELS[category],
    recordCount: agg.categoryCount[category],
    cost: agg.categoryCost[category],
    sharePercent: percentOf(agg.categoryCost[category], agg.totalCost)
  }));

  const allItems = groupLossesByItem(inPeriod, inventory, repeatCount);
  const byItem =
    typeof options.topItems === "number" && Number.isFinite(options.topItems) && options.topItems >= 0
      ? allItems.slice(0, Math.floor(options.topItems))
      : allItems;

  const previous = previousLossPeriod(input.period);
  const previousTotalCost =
    previous === null
      ? null
      : aggregate(filterLossesByPeriod(input.records, previous), inventoryById).totalCost;
  const changePercent =
    previousTotalCost !== null && previousTotalCost > 0
      ? ((agg.totalCost - previousTotalCost) / previousTotalCost) * 100
      : null;

  const revenue = typeof input.revenue === "number" && Number.isFinite(input.revenue) ? input.revenue : 0;
  const lossPercentOfRevenue = revenue > 0 ? (agg.totalCost / revenue) * 100 : null;

  const expiryRisk = findExpiryRisk(inventory, options.now, expiryWarningDays);
  const expiryRiskValue = expiryRisk.reduce((sum, risk) => sum + risk.valueAtRisk, 0);

  const avoidableCost = AVOIDABLE_LOSS_CATEGORIES.reduce((sum, category) => sum + agg.categoryCost[category], 0);
  const itemsMissingFromInventory = [...agg.items.keys()].filter((id) => !inventoryById.has(id));

  const alerts = buildAlerts({
    totalCost: agg.totalCost,
    byCategory,
    lossPercentOfRevenue,
    changePercent,
    unknownCostRecords: agg.unknownCostRecords,
    expiryRisk,
    expiryRiskValue,
    repeatOffenders: allItems.filter((item) => item.isRepeatOffender),
    revenueLossAlertPercent: optionOrDefault(options.revenueLossAlertPercent, DEFAULTS.revenueLossAlertPercent),
    concentrationAlertPercent: optionOrDefault(options.concentrationAlertPercent, DEFAULTS.concentrationAlertPercent),
    increaseAlertPercent: optionOrDefault(options.increaseAlertPercent, DEFAULTS.increaseAlertPercent),
    expiryWarningDays
  });

  return {
    totalCost: agg.totalCost,
    recordCount: agg.recordCount,
    avoidableCost,
    byCategory,
    byItem,
    topCategory: topCategoryOf(agg.categoryCost),
    topItemId: allItems[0]?.itemId ?? null,
    lossPercentOfRevenue,
    previousTotalCost,
    changePercent,
    unknownCostRecords: agg.unknownCostRecords,
    invalidRecords: agg.invalidRecords + undated,
    itemsMissingFromInventory,
    expiryRisk,
    expiryRiskValue,
    alerts
  };
}