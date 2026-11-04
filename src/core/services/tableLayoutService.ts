import type { Table, TableLayout } from "../entities/Entities";
import { isOptimisticLockError } from "../errors/OptimisticLockError";

/**
 * Guardado del plano del salón.
 * ---------------------------------------------------------------------------
 * La posición de cada mesa vive en `tables.data.layout` (jsonb), así que se
 * guarda con el MISMO motor y el MISMO bloqueo optimista que cualquier otro
 * cambio de mesa: `updateTable` lee la fila fresca, mezcla el `layout` y
 * guarda con `version`. Si un mesero tocó esa mesa justo ahora (agregó un
 * producto, pidió la cuenta...) el guardado choca, se relee y se reintenta:
 * mover una mesa NUNCA pisa una cuenta que está cambiando.
 */

export interface TableLayoutUpdate {
  readonly tableId: string;
  /** `undefined` quita la posición guardada: la mesa vuelve a acomodarse sola. */
  readonly layout: TableLayout | undefined;
}

export interface TableLayoutEngine {
  updateTable(tableId: string, patch: Partial<Pick<Table, "layout">>): Promise<unknown>;
}

export interface SaveLayoutsResult {
  readonly saved: number;
  readonly failed: readonly { tableId: string; error: unknown }[];
}

const MAX_ATTEMPTS = 4;

async function saveOne(engine: TableLayoutEngine, update: TableLayoutUpdate): Promise<void> {
  for (let attempt = 1; ; attempt += 1) {
    try {
      await engine.updateTable(update.tableId, { layout: update.layout });
      return;
    } catch (error) {
      if (isOptimisticLockError(error) && attempt < MAX_ATTEMPTS) {
        await new Promise((resolve) => setTimeout(resolve, 40 * attempt));
        continue;
      }
      throw error;
    }
  }
}

export async function saveTableLayouts(
  engine: TableLayoutEngine,
  updates: readonly TableLayoutUpdate[]
): Promise<SaveLayoutsResult> {
  const results = await Promise.allSettled(updates.map((update) => saveOne(engine, update)));
  const failed: { tableId: string; error: unknown }[] = [];
  results.forEach((result, index) => {
    if (result.status === "rejected") failed.push({ tableId: updates[index].tableId, error: result.reason });
  });
  return { saved: updates.length - failed.length, failed };
}