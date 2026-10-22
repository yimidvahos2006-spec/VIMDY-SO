import type { AuditLog, InventoryMovement } from "../entities/Entities";
import { describeMovement } from "./movementDisplay";

/**
 * Línea de tiempo de Inventario ("Últimos movimientos").
 *
 * Junta DOS fuentes en una sola lista, más reciente primero:
 *  1. Movimientos de stock del Kardex (entradas, salidas, ventas, mermas,
 *     producción, traslados, conteos). Los escribe el servidor.
 *  2. Eventos del catálogo guardados en la auditoría (módulo "inventario"):
 *     crear, editar precio/nombre, desactivar, eliminar, importar... Eso NO
 *     mueve stock, por eso no vive en el Kardex.
 *
 * Es lógica pura: no toca la base de datos ni la pantalla.
 */

export const INVENTORY_AUDIT_MODULE = "inventario";

export const INVENTORY_AUDIT_ACTIONS = {
  created: "INVENTORY_PRODUCT_CREATED",
  updated: "INVENTORY_PRODUCT_UPDATED",
  deactivated: "INVENTORY_PRODUCT_DEACTIVATED",
  reactivated: "INVENTORY_PRODUCT_REACTIVATED",
  deleted: "INVENTORY_PRODUCT_DELETED",
  deletedAll: "INVENTORY_PRODUCTS_DELETED_ALL",
  imported: "INVENTORY_PRODUCTS_IMPORTED",
  importUpdated: "INVENTORY_PRODUCTS_IMPORT_UPDATED"
} as const;

export type FeedTone = "up" | "down" | "neutral";

export interface FeedItem {
  readonly id: string;
  readonly date: Date;
  readonly title: string;
  /** Cantidad con signo para movimientos de stock ("+48", "-3"). Vacío en eventos del catálogo. */
  readonly amount?: string;
  readonly detail?: string;
  readonly tone: FeedTone;
  readonly kind: "stock" | "event";
}

/** Cuántos eventos iguales seguidos se resumen en una sola línea. */
export const GROUP_MIN_ITEMS = 5;
/** Máxima pausa entre un evento y el siguiente para seguir contándolos como la misma tanda. */
export const GROUP_MAX_GAP_MS = 10 * 60_000;

const EVENT_TONE: Record<string, FeedTone> = {
  [INVENTORY_AUDIT_ACTIONS.created]: "up",
  [INVENTORY_AUDIT_ACTIONS.reactivated]: "up",
  [INVENTORY_AUDIT_ACTIONS.imported]: "up",
  [INVENTORY_AUDIT_ACTIONS.deactivated]: "down",
  [INVENTORY_AUDIT_ACTIONS.deleted]: "down",
  [INVENTORY_AUDIT_ACTIONS.deletedAll]: "down",
  [INVENTORY_AUDIT_ACTIONS.updated]: "neutral",
  [INVENTORY_AUDIT_ACTIONS.importUpdated]: "neutral"
};

/** Convierte códigos internos ("AJUSTE_ADMINISTRATIVO") en texto legible. */
export function reasonLabel(reason: string | undefined): string {
  const raw = (reason ?? "").trim();
  if (!raw) return "";
  if (/^[A-Z0-9_]+$/.test(raw) && raw.includes("_")) {
    const text = raw.toLowerCase().replace(/_/g, " ");
    return text.charAt(0).toUpperCase() + text.slice(1);
  }
  if (raw.toLowerCase() === "sale") return "Venta";
  return raw;
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}

type Group = { key: string; items: FeedItem[]; units: number };

function groupKeyOf(item: FeedItem, movementReason?: string): string | null {
  if (item.kind === "stock" && movementReason?.trim().toLowerCase() === "stock inicial") return "stock-inicial";
  return null;
}

/**
 * Une la lista y resume las tandas (una importación de 2.000 productos no debe
 * llenar el panel con 2.000 líneas): 5 o más "Stock inicial" / "Creaste" /
 * "Eliminaste" seguidos y con menos de 10 min entre sí quedan en una línea.
 */
export function buildInventoryFeed(
  movements: ReadonlyArray<InventoryMovement>,
  audits: ReadonlyArray<AuditLog>,
  nameOf: (m: InventoryMovement) => string
): FeedItem[] {
  type Entry = { item: FeedItem; key: string | null; units: number };
  const entries: Entry[] = [];

  for (const m of movements) {
    const info = describeMovement(m, nameOf(m));
    const item: FeedItem = {
      id: `m:${m.id}`,
      date: m.date,
      title: info.title,
      amount: `${info.sign}${m.quantity}`,
      detail: reasonLabel(m.reason) || undefined,
      tone: info.tone,
      kind: "stock"
    };
    entries.push({ item, key: groupKeyOf(item, m.reason), units: m.type === "INCREASE" ? m.quantity : 0 });
  }

  for (const a of audits) {
    if (a.module !== INVENTORY_AUDIT_MODULE) continue;
    const tone = EVENT_TONE[a.action];
    if (!tone) continue;
    const key =
      a.action === INVENTORY_AUDIT_ACTIONS.created
        ? "created"
        : a.action === INVENTORY_AUDIT_ACTIONS.deleted
          ? "deleted"
          : null;
    entries.push({
      item: { id: `a:${a.id}`, date: a.date, title: a.description, tone, kind: "event" },
      key,
      units: 0
    });
  }

  entries.sort((x, y) => y.item.date.getTime() - x.item.date.getTime());

  // Tandas por tipo: se recorren de la más nueva a la más vieja.
  const collapsed = new Set<Entry>();
  const summaries: FeedItem[] = [];
  for (const key of ["stock-inicial", "created", "deleted"]) {
    const ofKey = entries.filter((e) => e.key === key);
    let run: Entry[] = [];
    const flush = () => {
      if (run.length >= GROUP_MIN_ITEMS) {
        run.forEach((e) => collapsed.add(e));
        const group: Group = { key, items: run.map((e) => e.item), units: run.reduce((s, e) => s + e.units, 0) };
        summaries.push(summarize(group));
      }
      run = [];
    };
    for (const e of ofKey) {
      const last = run[run.length - 1];
      if (last && last.item.date.getTime() - e.item.date.getTime() > GROUP_MAX_GAP_MS) flush();
      run.push(e);
    }
    flush();
  }

  return [...entries.filter((e) => !collapsed.has(e)).map((e) => e.item), ...summaries].sort(
    (x, y) => y.date.getTime() - x.date.getTime()
  );
}

function summarize(group: Group): FeedItem {
  const n = group.items.length;
  const newest = group.items[0];
  const count = n.toLocaleString("es-CO");
  if (group.key === "stock-inicial") {
    return {
      id: `g:${newest.id}`,
      date: newest.date,
      title: `Stock inicial de ${count} productos`,
      amount: `+${round(group.units).toLocaleString("es-CO")}`,
      detail: "Stock inicial",
      tone: "up",
      kind: "stock"
    };
  }
  if (group.key === "created") {
    return { id: `g:${newest.id}`, date: newest.date, title: `Creaste ${count} productos`, tone: "up", kind: "event" };
  }
  return { id: `g:${newest.id}`, date: newest.date, title: `Eliminaste ${count} productos`, tone: "down", kind: "event" };
}