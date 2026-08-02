import { OpenTableInput, CloseTableInput } from "../engines/TableEngine";

/**
 * PendingTableOperation
 * ---------------------------------------------------------------------------
 * PASO 1.8 del plan offline: lo que se guarda en el navegador (ver
 * PendingTableOperationRepository.ts) cuando una apertura o un cierre de
 * mesa se hace sin internet. Mismo patrón exacto que PendingSale.ts /
 * PendingInventoryAdjustment.ts, adaptado a
 * TableEngine.openTable()/closeTable().
 *
 * DECISIÓN DE DISEÑO (igual que en los otros dos): se guarda la "receta"
 * para rehacer la operación (el input tal cual se lo habría pasado a
 * TableEngine), no una Table ya armada. Al reconectar, se vuelve a llamar
 * literalmente a TableEngine.openTable()/closeTable() con ese mismo input
 * — la ÚNICA fuente de verdad real de la mesa sigue siendo la fila en
 * Supabase (ver cabecera de TableEngine.ts), así que reproducir la
 * operación contra ella es siempre más seguro que tratar de reconstruir
 * el estado final a mano.
 *
 * IDEMPOTENCIA:
 *   - OPEN: abrir una mesa que ya está "BUSY" en el servidor (porque el
 *     mismo intento ya se sincronizó antes, o porque otro dispositivo la
 *     abrió mientras tanto) es un error de NEGOCIO real
 *     (TABLE_NOT_AVAILABLE, ver offlineSale.ts) — no hay un id de
 *     idempotencia especial para "abrir", así que ese caso se marca
 *     FAILED para revisión manual, igual que cualquier otro choque real.
 *   - CLOSE: `closeInput.saleId` es la misma clave de idempotencia que ya
 *     usa el cobro de mostrador (ver checklist crítico #4, y
 *     CloseTableDialog.tsx, que lo genera una sola vez por intento de
 *     cobro). Si el cierre offline se reintenta en la sincronización,
 *     SalesEngine.createSale() reconoce que la venta con ese id ya existe
 *     y no la duplica.
 *
 * LÍMITE CONOCIDO (documentado, no resuelto aquí): el recibo real y el
 * envío de la venta a Cocina/Caja/Dashboard solo ocurren cuando esta
 * operación se sincroniza de verdad (ver syncPendingTableOperations.ts),
 * no en el momento exacto en que el mesero/cajero cerró la mesa sin
 * señal. Mientras tanto, la mesa se ve "libre" en este dispositivo por
 * una actualización optimista local (ver offlineTable.ts), pero la
 * impresión del recibo se demora hasta que vuelva la conexión.
 */

export type PendingTableOperationStatus =
  /** Recién guardada offline, esperando que vuelva la conexión. */
  | "PENDING_SYNC"
  /** El proceso de sincronización la está enviando ahora mismo. */
  | "SYNCING"
  /**
   * Se intentó sincronizar y falló por algo que NO es falta de red (ej.
   * la mesa ya no está disponible para abrir, o ya no tiene productos
   * para cobrar). Se saca de la cola automática y espera revisión
   * manual — no se reintenta sola para no repetir el mismo error para
   * siempre.
   */
  | "FAILED";

export type PendingTableOperationType = "OPEN" | "CLOSE";

export interface PendingTableOperation {
  /** Clave de idempotencia de la operación en la cola local (no del cobro). */
  readonly id: string;
  readonly tableId: string;
  /** Nombre de la mesa al momento de encolar, solo para mostrarlo en la UI (banner/lista). */
  readonly tableName: string;
  readonly type: PendingTableOperationType;
  /** Presente solo si type === "OPEN". */
  readonly openInput?: OpenTableInput;
  /** Presente solo si type === "CLOSE". Su `saleId` es la idempotencia real del cobro. */
  readonly closeInput?: CloseTableInput;
  readonly status: PendingTableOperationStatus;
  /** Cuándo se guardó localmente (el momento real de la apertura/cierre offline). */
  readonly queuedAt: Date;
  readonly attempts: number;
  readonly lastAttemptAt?: Date;
  readonly lastError?: string;
}