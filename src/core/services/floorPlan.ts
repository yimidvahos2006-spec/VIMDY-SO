import type { Table, TableLayout, TableShape, Waiter } from "../entities/Entities";
import { sortTables, tableDisplayName } from "./tableOrdering";

/* ===========================================================================
   floorPlan — reglas puras del Mapa de Mesas Visual (sin React ni Supabase)
   ---------------------------------------------------------------------------
   Todo lo que decide "de qué color va cada mesa", "cuánto lleva abierta" y
   "dónde se dibuja" vive aquí para poder probarlo a fondo (ver
   tests/unit/floor-plan.test.ts). La pantalla solo pinta lo que sale de aquí.

   Los 3 colores que pide el negocio:
     - VERDE  (free)     → mesa libre.
     - ROJO   (occupied) → cuenta abierta: BUSY, WAITING_FOOD, EATING.
     - ÁMBAR  (alert)    → pidiendo cuenta (CUENTA_SOLICITADA, WAITING_BILL),
                           cobrando (PAYING) o con tiempo excedido.
   Aparte, sin color de "semáforo": reservada (índigo) y unida (gris).
=========================================================================== */

export type FloorState = "free" | "occupied" | "alert" | "reserved" | "merged";

/** Por qué una mesa está en ámbar. */
export type AlertReason = "bill" | "paying" | "overstay";

/** Ancho del lienzo en px de diseño. La pantalla lo escala para que quepa. */
export const CANVAS_W = 1000;
/** Alto mínimo del lienzo de una zona. */
export const MIN_CANVAS_H = 560;
/** Todo se ajusta a esta cuadrícula al mover mesas. */
export const GRID = 8;
const PAD = 32;
const GAP = 24;

export const NO_ZONE = "Sin zona";

/** Mesa ocupada más de (promedio × este factor) pasa a ámbar "Tiempo excedido". */
export const DEFAULT_OVERSTAY_FACTOR = 1.5;
/** Cuenta pedida hace más de esto = alerta crítica (la tarjeta late). */
export const CRITICAL_BILL_WAIT_MS = 5 * 60 * 1000;

export const SHAPE_SIZE: Readonly<Record<TableShape, { w: number; h: number }>> = {
  round: { w: 112, h: 112 },
  square: { w: 136, h: 120 },
  rect: { w: 216, h: 120 }
};

const OCCUPIED_STATUSES = new Set<Table["status"]>(["BUSY", "WAITING_FOOD", "EATING"]);
const BILL_STATUSES = new Set<Table["status"]>(["CUENTA_SOLICITADA", "WAITING_BILL"]);

export const STATUS_DETAIL_LABEL: Readonly<Record<Table["status"], string>> = {
  FREE: "Libre",
  RESERVED: "Reservada",
  BUSY: "Ocupada",
  WAITING_FOOD: "Esperando comida",
  EATING: "Comiendo",
  CUENTA_SOLICITADA: "Pidiendo cuenta",
  WAITING_BILL: "Pidiendo cuenta",
  PAYING: "Cobrando",
  CLOSED: "Unida"
};

export const ALERT_LABEL: Readonly<Record<AlertReason, string>> = {
  bill: "Pidiendo cuenta",
  paying: "Cobrando",
  overstay: "Tiempo excedido"
};

/* ---------------------------------------------------------------- Vista -- */

export interface FloorTableView {
  readonly table: Table;
  readonly id: string;
  readonly name: string;
  readonly zone: string;
  readonly state: FloorState;
  readonly alertReason?: AlertReason;
  /** Texto del estado, siempre visible (el color solo lo refuerza). */
  readonly label: string;
  /** Milisegundos desde que se abrió; null si no hay cuenta abierta. */
  readonly elapsedMs: number | null;
  /** Consumo acumulado de la cuenta (0 si la mesa no está abierta). */
  readonly total: number;
  readonly people: number;
  readonly capacity: number;
  readonly waiterName?: string;
  /** Nombre de la mesa principal si ésta está unida a otra. */
  readonly mergedIntoName?: string;
  /** Alerta crítica: la tarjeta late. */
  readonly critical: boolean;
}

export interface BuildViewOptions {
  readonly now: number;
  readonly avgDurationMs: number;
  readonly waiters?: readonly Pick<Waiter, "id" | "name">[];
  /** null desactiva la alerta por tiempo excedido. */
  readonly overstayFactor?: number | null;
}

function toMillis(value: unknown): number | null {
  if (value instanceof Date) {
    const ms = value.getTime();
    return Number.isFinite(ms) ? ms : null;
  }
  if (typeof value === "string" || typeof value === "number") {
    const ms = new Date(value).getTime();
    return Number.isFinite(ms) ? ms : null;
  }
  return null;
}

/** Consumo de la cuenta: `total` guardado y, si aún no se calculó, la suma de las líneas. */
export function tableConsumption(table: Pick<Table, "total" | "items">): number {
  if (Number.isFinite(table.total) && table.total > 0) return table.total;
  const items = Array.isArray(table.items) ? table.items : [];
  const sum = items.reduce((acc, item) => acc + (Number(item.price) || 0) * (Number(item.quantity) || 0), 0);
  return Number.isFinite(sum) && sum > 0 ? Number(sum.toFixed(2)) : 0;
}

export function zoneOf(table: Pick<Table, "zone">): string {
  return table.zone?.trim() || NO_ZONE;
}

export function buildFloorView(table: Table, byId: ReadonlyMap<string, Table>, options: BuildViewOptions): FloorTableView {
  const { now, avgDurationMs, waiters } = options;
  const overstayFactor = options.overstayFactor === undefined ? DEFAULT_OVERSTAY_FACTOR : options.overstayFactor;
  const openedMs = toMillis(table.openedAt);
  const status = table.status;

  const base = {
    table,
    id: table.id,
    name: tableDisplayName(table),
    zone: zoneOf(table),
    people: Math.max(0, Number(table.peopleCount) || 0),
    capacity: Math.max(0, Number(table.capacity) || 0),
    waiterName: table.waiterId ? waiters?.find((w) => w.id === table.waiterId)?.name : undefined
  };

  if (status === "FREE") {
    return { ...base, state: "free", label: STATUS_DETAIL_LABEL.FREE, elapsedMs: null, total: 0, critical: false };
  }
  if (status === "RESERVED") {
    return { ...base, state: "reserved", label: STATUS_DETAIL_LABEL.RESERVED, elapsedMs: null, total: 0, critical: false };
  }
  if (status === "CLOSED") {
    const target = table.mergedInto ? byId.get(table.mergedInto) : undefined;
    return {
      ...base,
      state: "merged",
      label: STATUS_DETAIL_LABEL.CLOSED,
      elapsedMs: null,
      total: 0,
      mergedIntoName: target ? tableDisplayName(target) : undefined,
      critical: false
    };
  }

  // De aquí en adelante la mesa tiene una cuenta abierta.
  const elapsedMs = openedMs === null ? null : Math.max(0, now - openedMs);
  const total = tableConsumption(table);

  if (BILL_STATUSES.has(status) || status === "PAYING") {
    const reason: AlertReason = status === "PAYING" ? "paying" : "bill";
    return {
      ...base,
      state: "alert",
      alertReason: reason,
      label: ALERT_LABEL[reason],
      elapsedMs,
      total,
      critical: reason === "bill" && elapsedMs !== null && elapsedMs >= CRITICAL_BILL_WAIT_MS
    };
  }

  const overstay =
    overstayFactor !== null &&
    OCCUPIED_STATUSES.has(status) &&
    elapsedMs !== null &&
    avgDurationMs > 0 &&
    elapsedMs >= avgDurationMs * overstayFactor;

  if (overstay) {
    return {
      ...base,
      state: "alert",
      alertReason: "overstay",
      label: ALERT_LABEL.overstay,
      elapsedMs,
      total,
      critical: false
    };
  }

  return {
    ...base,
    state: "occupied",
    label: STATUS_DETAIL_LABEL[status] ?? STATUS_DETAIL_LABEL.BUSY,
    elapsedMs,
    total,
    critical: false
  };
}

export function buildFloorViews(tables: readonly Table[], options: BuildViewOptions): FloorTableView[] {
  const byId = new Map(tables.map((t) => [t.id, t]));
  return tables.map((t) => buildFloorView(t, byId, options));
}

/** "<1 min" · "47 min" · "1 h 05 min". */
export function formatElapsed(ms: number | null): string {
  if (ms === null || !Number.isFinite(ms)) return "—";
  const minutes = Math.floor(Math.max(0, ms) / 60000);
  if (minutes < 1) return "<1 min";
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${h} h ${String(m).padStart(2, "0")} min`;
}

/* -------------------------------------------------------------- Resumen -- */

export interface FloorSummary {
  readonly free: number;
  readonly occupied: number;
  readonly alert: number;
  readonly reserved: number;
  /** Mesas que cuentan para la ocupación (todas menos las unidas). */
  readonly active: number;
  /** Consumo en vivo de todas las cuentas abiertas. */
  readonly liveTotal: number;
  /** 0–100: mesas con cuenta abierta sobre mesas útiles. */
  readonly occupancyPct: number;
}

export function summarizeFloor(views: readonly FloorTableView[]): FloorSummary {
  let free = 0;
  let occupied = 0;
  let alert = 0;
  let reserved = 0;
  let liveTotal = 0;

  for (const v of views) {
    if (v.state === "free") free += 1;
    else if (v.state === "occupied") occupied += 1;
    else if (v.state === "alert") alert += 1;
    else if (v.state === "reserved") reserved += 1;
    if (v.state === "occupied" || v.state === "alert") liveTotal += v.total;
  }

  const active = free + occupied + alert + reserved;
  const occupancyPct = active === 0 ? 0 : Math.round(((occupied + alert) / active) * 100);
  return { free, occupied, alert, reserved, active, liveTotal: Number(liveTotal.toFixed(2)), occupancyPct };
}

/** Zonas en orden alfabético natural, con "Sin zona" siempre al final. */
export function groupByZone(views: readonly FloorTableView[]): { zone: string; views: FloorTableView[] }[] {
  const map = new Map<string, FloorTableView[]>();
  for (const v of views) {
    const list = map.get(v.zone);
    if (list) list.push(v);
    else map.set(v.zone, [v]);
  }
  return [...map.entries()]
    .sort(([a], [b]) => {
      if (a === NO_ZONE) return 1;
      if (b === NO_ZONE) return -1;
      return a.localeCompare(b, "es", { numeric: true, sensitivity: "base" });
    })
    .map(([zone, list]) => ({ zone, views: list }));
}

/* ------------------------------------------------------------- Posición -- */

export interface PlacedTable {
  readonly id: string;
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
  readonly shape: TableShape;
  /** true si la posición la calculó el plano (la mesa no tiene `layout` guardado). */
  readonly auto: boolean;
}

export interface Rect {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

/** Forma por defecto según la capacidad: 1–2 redonda, 3–5 cuadrada, 6+ alargada. */
export function defaultShape(capacity: number): TableShape {
  if (capacity <= 2) return "round";
  if (capacity <= 5) return "square";
  return "rect";
}

export function shapeOf(table: Pick<Table, "layout" | "capacity">): TableShape {
  const saved = table.layout?.shape;
  return saved === "round" || saved === "square" || saved === "rect" ? saved : defaultShape(table.capacity);
}

export function snap(value: number): number {
  return Math.round(value / GRID) * GRID;
}

/** Ajusta a la cuadrícula y mantiene la mesa dentro del lienzo. */
export function clampPosition(x: number, y: number, shape: TableShape): { x: number; y: number } {
  const { w } = SHAPE_SIZE[shape];
  const maxX = Math.floor((CANVAS_W - w) / GRID) * GRID;
  return {
    x: Math.min(Math.max(snap(x), 0), Math.max(0, maxX)),
    y: Math.max(snap(y), 0)
  };
}

function validLayout(layout: TableLayout | undefined): layout is TableLayout {
  return !!layout && Number.isFinite(layout.x) && Number.isFinite(layout.y);
}

export function rectsOverlap(a: Rect, b: Rect, margin = GRID): boolean {
  return a.x < b.x + b.w + margin && a.x + a.w + margin > b.x && a.y < b.y + b.h + margin && a.y + a.h + margin > b.y;
}

export function overlapsAny(rect: Rect, others: readonly Rect[]): boolean {
  return others.some((other) => rectsOverlap(rect, other));
}

/**
 * Coloca las mesas de UNA zona. Las que ya tienen posición (guardada o en
 * borrador) la conservan; las demás se acomodan en filas debajo de las
 * colocadas, así que nunca se encimen sin que nadie haya movido nada.
 */
export function placeZone(
  tables: readonly Table[],
  draft?: ReadonlyMap<string, TableLayout | null>
): { placed: PlacedTable[]; height: number } {
  const placed: PlacedTable[] = [];
  const unplaced: Table[] = [];

  for (const table of tables) {
    const override = draft?.get(table.id);
    // `null` en el borrador = "volver a acomodar automáticamente".
    const layout = override === null ? undefined : override ?? table.layout;
    if (validLayout(layout)) {
      const shape = layout.shape ?? shapeOf(table);
      const { w, h } = SHAPE_SIZE[shape];
      const pos = clampPosition(layout.x, layout.y, shape);
      placed.push({ id: table.id, ...pos, w, h, shape, auto: false });
    } else {
      unplaced.push(table);
    }
  }

  let y = placed.length > 0 ? Math.max(...placed.map((p) => p.y + p.h)) + GAP : PAD;
  let x = PAD;
  let rowH = 0;

  for (const table of sortTables(unplaced)) {
    const shape = shapeOf(table);
    const { w, h } = SHAPE_SIZE[shape];
    if (x + w > CANVAS_W - PAD && x > PAD) {
      x = PAD;
      y += rowH + GAP;
      rowH = 0;
    }
    placed.push({ id: table.id, x, y, w, h, shape, auto: true });
    x += w + GAP;
    rowH = Math.max(rowH, h);
  }

  const bottom = placed.length === 0 ? 0 : Math.max(...placed.map((p) => p.y + p.h));
  return { placed, height: Math.max(MIN_CANVAS_H, bottom + PAD) };
}