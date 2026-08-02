import { Table } from "../entities/Entities";
import { OpenTableInput, CloseTableInput } from "../engines/TableEngine";
import { TableLocalRepository } from "../../infrastructure/di/repositories/TableLocalRepository";
import { pendingTableOperationsStore } from "../offline/pendingTableOperationsStore";
import { toast } from "../store/toastStore";
import { vimdyCore } from "../VimdyCore";

/**
 * offlineTable.ts
 * ---------------------------------------------------------------------------
 * PASO 1.8 del plan offline: equivalente de offlineInventory.ts para
 * apertura/cierre de mesa. `isNetworkFailure` para estas dos operaciones se
 * reutiliza tal cual desde offlineSale.ts (ver OpenTableDialog.tsx /
 * CloseTableDialog.tsx) — la distinción entre error de red y error de
 * negocio (ej. 'TABLE_NOT_AVAILABLE', 'EMPTY_TABLE') no depende de qué
 * operación se esté haciendo.
 *
 * Encola la operación en pendingTableOperationsStore Y aplica de inmediato
 * el mismo cambio de estado sobre el caché local de Mesas
 * (TableLocalRepository, el mismo que ya usa TableRepository.findAll() —
 * ver Paso 1.4), para que el grid de Mesas y el resto de la app vean la
 * mesa "abierta"/"libre" sin esperar a que vuelva la conexión. La fila
 * REAL en Supabase recién se actualiza cuando la operación se sincroniza
 * (ver syncPendingTableOperations.ts).
 */

const local = new TableLocalRepository();

const OFFLINE_OPEN_MESSAGE =
  "Sin conexión: la apertura de la mesa quedó guardada en este dispositivo y se sincronizará sola cuando vuelva internet.";

const OFFLINE_CLOSE_MESSAGE =
  "Sin conexión: el cierre de la mesa quedó guardado en este dispositivo. El recibo se generará cuando vuelva internet.";

/**
 * Encola la apertura de una mesa hecha sin conexión. `table` debe ser la
 * última versión conocida de la mesa (la misma que ya se estaba mostrando
 * en pantalla) — no hace falta releerla del servidor, que es justo lo que
 * no hay forma de hacer en este momento.
 */
export async function queueOpenTableOffline(params: {
  table: Table;
  input: OpenTableInput;
}): Promise<Table> {
  const { table, input } = params;

  await pendingTableOperationsStore.enqueue({
    id: crypto.randomUUID(),
    tableId: table.id,
    tableName: table.name,
    type: "OPEN",
    openInput: input
  });

  const optimistic: Table = {
    ...table,
    status: "BUSY",
    peopleCount: input.peopleCount,
    waiterId: input.waiterId,
    customerId: input.customerId,
    notes: input.notes,
    openedAt: new Date(),
    updatedAt: new Date()
  };

  await local.save(optimistic);
  vimdyCore.emit("table", { action: "table.opened", table: optimistic });

  toast.warning(OFFLINE_OPEN_MESSAGE);

  return optimistic;
}

/**
 * Encola el cierre (cobro) de una mesa hecho sin conexión. `input.saleId`
 * debe venir ya generado por el llamador (checklist crítico #4) — es la
 * misma clave de idempotencia que evita duplicar la venta cuando esta
 * operación se sincronice de verdad (ver CloseTableDialog.tsx).
 *
 * A diferencia del cobro de mostrador offline (chargeSaleOffline en
 * processSale.ts), aquí NO se imprime un recibo provisional: todavía no
 * existe una Sale real ni siquiera armada en memoria para esta mesa (el
 * pedido vive únicamente en la fila de Supabase, ver cabecera de
 * TableEngine.ts, así que reconstruirla aquí duplicaría esa lógica). El
 * recibo real se imprime cuando la operación se sincroniza (closeTable()
 * ya lo hace internamente, ver TableEngine.ts).
 */
export async function queueCloseTableOffline(params: {
  table: Table;
  input: CloseTableInput;
}): Promise<Table> {
  const { table, input } = params;

  await pendingTableOperationsStore.enqueue({
    id: crypto.randomUUID(),
    tableId: table.id,
    tableName: table.name,
    type: "CLOSE",
    closeInput: input
  });

  const freed: Table = {
    ...table,
    status: "FREE",
    peopleCount: 0,
    waiterId: undefined,
    customerId: undefined,
    items: [],
    subtotal: 0,
    tax: 0,
    discount: 0,
    total: 0,
    notes: undefined,
    openedAt: undefined,
    updatedAt: new Date()
  };

  await local.save(freed);
  vimdyCore.emit("table", { action: "table.closed", table: freed });

  toast.warning(OFFLINE_CLOSE_MESSAGE);

  return freed;
}