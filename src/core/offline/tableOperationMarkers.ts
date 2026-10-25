// src/core/offline/tableOperationMarkers.ts
/* ===========================================================================
   Marcador de idempotencia de operaciones de mesa (offline, Paso 3).

   Problema: el sync reproduce una operación contra Supabase y la respuesta se
   pierde (la red cae justo después del UPDATE). La cola la reintenta. Sin
   marcador, un ADD_ITEM suma la cantidad dos veces y un UPDATE_NOTE parcial
   mueve unidades de más.

   Solución acordada: guardar el id de la operación dentro de `data` de la
   mesa (`appliedOperationIds`), en el MISMO UPDATE con bloqueo optimista
   (`eq("version", n)`) que aplica el cambio. Una sola escritura => o se
   guardan cambio + marcador, o ninguno. No hace falta RPC aparte.

   Este módulo es puro (sin red ni estado) para poder probarlo aislado.
   =========================================================================== */

import type { Table } from "../entities/Entities";

/**
 * Cuántos ids se recuerdan por mesa. Una cola offline real tiene decenas de
 * operaciones por mesa, no cientos; el tope solo evita que `data` crezca sin
 * límite en una mesa de uso intensivo. Se descartan los más antiguos.
 */
export const MAX_APPLIED_OPERATION_IDS = 200;

/** ¿Esta operación ya quedó aplicada en la mesa? */
export function hasAppliedOperation(
  table: Pick<Table, "appliedOperationIds">,
  operationId: string | undefined
): boolean {
  if (!operationId) return false;
  return table.appliedOperationIds?.includes(operationId) ?? false;
}

/**
 * Lista de ids con `operationId` añadido al final (sin duplicar) y recortada
 * a los últimos MAX_APPLIED_OPERATION_IDS. No muta la entrada.
 */
export function appendAppliedOperation(
  current: readonly string[] | undefined,
  operationId: string | undefined
): readonly string[] | undefined {
  if (!operationId) return current;
  const without = (current ?? []).filter((id) => id !== operationId);
  const next = [...without, operationId];
  return next.length > MAX_APPLIED_OPERATION_IDS
    ? next.slice(next.length - MAX_APPLIED_OPERATION_IDS)
    : next;
}