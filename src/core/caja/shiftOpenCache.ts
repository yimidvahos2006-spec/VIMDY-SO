/**
 * shiftOpenCache.ts
 * ---------------------------------------------------------------------------
 * Memoria corta de "el turno de caja está abierto".
 *
 * Antes, CADA cobro hacía una consulta a Supabase solo para confirmar que
 * había turno abierto, justo en el momento en que el cajero está esperando.
 * Ahora, si hace menos de 15 segundos ya se confirmó que el turno está
 * abierto (por el cobro anterior o por el chequeo de la pantalla de Caja),
 * se reutiliza ese resultado y el cobro arranca sin esa espera.
 *
 * Es seguro porque:
 *  - Solo se guarda el resultado "abierto" (si está cerrado, siempre se
 *    vuelve a consultar).
 *  - Se borra al instante cuando este dispositivo abre o cierra un turno.
 *  - El servidor SIEMPRE vuelve a exigir turno abierto al cobrar
 *    (SHIFT_NOT_OPEN), así que nunca se puede cobrar sin turno.
 */
import { vimdyCore } from "../VimdyCore";
import { getCurrentBusinessId, getCurrentBranchId } from "../../infrastructure/supabase/supabaseClient";
import { cashRegisterStore } from "../store/cashRegisterStore";

export const SHIFT_OPEN_TTL_MS = 15000;

let confirmedKey = "";
let confirmedAt = 0;

/** Identifica negocio + sucursal + caja física, para no mezclar turnos. */
export function shiftOpenKey(): string {
  return [
    getCurrentBusinessId() ?? "",
    getCurrentBranchId() ?? "",
    cashRegisterStore.getSelectedId() ?? ""
  ].join("|");
}

export const shiftOpenCache = {
  isFresh(key: string, now: number = Date.now()): boolean {
    return confirmedKey === key && key !== "||" && now - confirmedAt < SHIFT_OPEN_TTL_MS;
  },

  markOpen(key: string, now: number = Date.now()): void {
    confirmedKey = key;
    confirmedAt = now;
  },

  invalidate(): void {
    confirmedKey = "";
    confirmedAt = 0;
  }
};

// Abrir o cerrar un turno en este dispositivo borra la memoria al instante.
vimdyCore.on("shift", () => shiftOpenCache.invalidate());