// src/core/offline/tableConflictRules.ts
/* ===========================================================================
   Conflictos de SIGNIFICADO de la cola offline de mesas (Paso 4).

   Un conflicto de versión (OptimisticLockError) es técnico: se reintenta
   releyendo la mesa. Un conflicto de significado es distinto: la operación
   que el mesero hizo sin internet ya no tiene sentido con lo que pasó
   mientras tanto (la mesa se cobró, se cerró en caja, se reabrió para otro
   cliente...). Reintentar no lo arregla y aplicarla a ciegas ensuciaría la
   cuenta de otro cliente.

   Reglas:
     - Se bloquean SOLO las operaciones de esa mesa; las demás siguen.
     - Nada se borra ni se aplica "a medias": la cola conserva todo para que
       Caja/Admin lo audite.
     - El mesero NUNCA resuelve el conflicto; solo ve un aviso.

   Módulo puro (sin red ni estado) para probarlo aislado.
   =========================================================================== */

import type { Table } from "../entities/Entities";
import type {
  PendingTableConflict,
  PendingTableOperation,
  TableConflictCode
} from "./PendingTableOperation";

/**
 * Prefijos de error del engine que significan "conflicto de significado".
 * El orden no importa: ningún prefijo contiene a otro.
 */
const CONFLICT_PREFIXES: readonly TableConflictCode[] = [
  "TABLE_NOT_OPEN",
  "TABLE_ALREADY_CLOSED",
  "TABLE_NOT_AVAILABLE",
  "TABLE_SESSION_CHANGED",
  "TABLE_SALE_STALE",
  "TABLE_NOTE_ALREADY_SENT",
  "TABLE_NOT_FOUND"
];

/**
 * Si el error es un conflicto de significado devuelve su código; si no
 * (red caída, error técnico, validación...) devuelve `null` y el sync sigue
 * con su manejo de siempre.
 */
export function classifyTableConflict(error: unknown): PendingTableConflict | null {
  const message = error instanceof Error ? error.message : String(error);
  const code = CONFLICT_PREFIXES.find((prefix) => message.startsWith(prefix));
  if (!code) return null;
  return { code, detail: message, detectedAt: new Date() };
}

/**
 * Guardia de sesión de mesa: la operación se hizo sobre una cuenta concreta
 * (`expectedSessionId` = openOperationId de la mesa cuando se encoló). Si hoy
 * la mesa tiene OTRA cuenta abierta, la mesa se cobró y se volvió a abrir y la
 * operación pertenece a la cuenta anterior.
 *
 * Solo actúa cuando ambos ids existen; si falta alguno no hay base para
 * afirmar un cambio (mesas anteriores a openOperationId) y se deja pasar.
 */
export function assertSameTableSession(
  table: Pick<Table, "name" | "openOperationId">,
  expectedSessionId: string | undefined
): void {
  if (!expectedSessionId || !table.openOperationId) return;
  if (table.openOperationId !== expectedSessionId) {
    throw new Error(
      `TABLE_SESSION_CHANGED: la mesa "${table.name}" ya tiene otra cuenta abierta distinta a la de esta operación`
    );
  }
}

/** Una mesa con operaciones detenidas por conflicto. */
export interface BlockedTable {
  readonly tableId: string;
  readonly tableName: string;
  readonly code: TableConflictCode;
  readonly detail: string;
  readonly detectedAt: Date;
  /** Operación que detectó el conflicto (la primera, en orden de cola). */
  readonly conflictOperationId: string;
  /** Cuántas operaciones de la mesa quedaron retenidas (la del conflicto + las que esperaban detrás). */
  readonly heldOperations: number;
}

/**
 * Mesas bloqueadas según el estado actual de la cola. Es DERIVADO: no hay
 * lista aparte que pueda quedar desincronizada, y sobrevive a reinicios
 * porque `CONFLICT` está guardado en IndexedDB con cada operación.
 */
export function blockedTablesFrom(
  operations: readonly PendingTableOperation[]
): BlockedTable[] {
  const ordered = [...operations].sort(
    (a, b) => a.queuedAt.getTime() - b.queuedAt.getTime() || a.id.localeCompare(b.id)
  );

  const byTable = new Map<string, BlockedTable>();

  for (const op of ordered) {
    if (op.status === "CONFLICT" && op.conflict && !byTable.has(op.tableId)) {
      byTable.set(op.tableId, {
        tableId: op.tableId,
        tableName: op.tableName,
        code: op.conflict.code,
        detail: op.conflict.detail,
        detectedAt: op.conflict.detectedAt,
        conflictOperationId: op.id,
        heldOperations: 0
      });
    }
  }

  if (byTable.size === 0) return [];

  const held = new Map<string, number>();
  for (const op of ordered) {
    if (byTable.has(op.tableId)) {
      held.set(op.tableId, (held.get(op.tableId) ?? 0) + 1);
    }
  }

  return [...byTable.values()].map((blocked) => ({
    ...blocked,
    heldOperations: held.get(blocked.tableId) ?? 0
  }));
}

/** Ids de las mesas bloqueadas. */
export function blockedTableIds(
  operations: readonly PendingTableOperation[]
): Set<string> {
  return new Set(blockedTablesFrom(operations).map((blocked) => blocked.tableId));
}