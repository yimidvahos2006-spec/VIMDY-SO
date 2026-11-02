/**
 * ticketPrintSettingsRepository.ts
 * ---------------------------------------------------------------------------
 * Lectura y escritura de la configuración de impresión del ticket
 * (`public.ticket_print_settings`), con alcance opcional por sucursal.
 *
 *   branchId ausente/null  -> configuración GLOBAL del negocio
 *   branchId con valor     -> override de esa sucursal (fila completa)
 *
 * Herencia al leer (`fetchEffective...`): override de la sucursal -> global
 * del negocio -> defaults de la app. Para que una sucursal vuelva a heredar
 * se borra su override (`clearBranchTicketPrintSettings`).
 *
 * Seguridad (la impone la base con RLS, no este archivo): cualquier miembro
 * puede LEER (el cajero la necesita para imprimir); solo ADMIN con plan
 * activo puede ESCRIBIR.
 *
 * Las lecturas lanzan si la base falla: quien imprime decide si cae a los
 * defaults. Aquí no se inventan valores ante un error.
 */

import { supabase } from "./supabaseClient";
import {
  defaultTicketPrintSettings,
  ticketPrintSettingsFromRow,
  ticketPrintSettingsToPayload,
  type ResolvedSettings,
  type SettingsScope,
  type TicketPrintSettings,
  type TicketPrintSettingsRow
} from "../../core/settings/ticketReportSettings";
import {
  normalizeBranchId,
  requireBranchId,
  requireBusinessId,
  toSettingsError
} from "./settingsRepositoryShared";

const TABLE = "ticket_print_settings";
const COLUMNS =
  "id,business_id,branch_id,template,paper_width,accent_color,show_logo,show_qr,show_address," +
  "show_phone,show_email,show_cashier,show_customer,show_tax,show_discount,show_table,show_footer,footer_message," +
  "created_at,updated_at,updated_by";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseRow(value: unknown): TicketPrintSettingsRow {
  if (!isRecord(value) || typeof value.business_id !== "string" || typeof value.updated_at !== "string") {
    throw new Error("TICKET_SETTINGS_INVALID: la base devolvió una fila que no se puede leer.");
  }
  return value as unknown as TicketPrintSettingsRow;
}

function toScope(row: TicketPrintSettingsRow): SettingsScope<TicketPrintSettings> {
  return {
    businessId: row.business_id,
    branchId: row.branch_id ?? null,
    settings: ticketPrintSettingsFromRow(row),
    updatedAt: row.updated_at
  };
}

/**
 * Configuración efectiva para imprimir en una sucursal.
 * Sin filas guardadas devuelve los defaults con `source: "default"`.
 */
export async function fetchEffectiveTicketPrintSettings(
  businessId: string,
  branchId?: string | null
): Promise<ResolvedSettings<TicketPrintSettings>> {
  const { data, error } = await supabase.rpc("resolve_ticket_print_settings", {
    p_business_id: requireBusinessId(businessId),
    p_branch_id: normalizeBranchId(branchId)
  });
  if (error) throw toSettingsError(error, "No se pudo leer la configuración del ticket.");

  const rows: unknown[] = Array.isArray(data) ? data : data ? [data] : [];
  if (rows.length === 0) {
    return { settings: defaultTicketPrintSettings(), source: "default", branchId: null, updatedAt: null };
  }

  const scope = toScope(parseRow(rows[0]));
  return {
    settings: scope.settings,
    source: scope.branchId ? "branch" : "business",
    branchId: scope.branchId,
    updatedAt: scope.updatedAt
  };
}

/**
 * La fila EXACTA de un alcance (sin heredar): `null` si ese alcance no tiene
 * configuración propia. Sirve para saber si una sucursal ya tiene override.
 */
export async function fetchTicketPrintSettingsScope(
  businessId: string,
  branchId?: string | null
): Promise<SettingsScope<TicketPrintSettings> | null> {
  const branch = normalizeBranchId(branchId);
  let query = supabase.from(TABLE).select(COLUMNS).eq("business_id", requireBusinessId(businessId));
  query = branch ? query.eq("branch_id", branch) : query.is("branch_id", null);

  const { data, error } = await query.maybeSingle();
  if (error) throw toSettingsError(error, "No se pudo leer la configuración del ticket.");
  return data ? toScope(parseRow(data)) : null;
}

/** Todas las configuraciones visibles del negocio: la global primero, luego los overrides. */
export async function listTicketPrintSettingsScopes(
  businessId: string
): Promise<SettingsScope<TicketPrintSettings>[]> {
  const { data, error } = await supabase
    .from(TABLE)
    .select(COLUMNS)
    .eq("business_id", requireBusinessId(businessId))
    .order("branch_id", { ascending: true, nullsFirst: true });
  if (error) throw toSettingsError(error, "No se pudieron leer las configuraciones del ticket.");
  return (Array.isArray(data) ? data : []).map((row) => toScope(parseRow(row)));
}

export interface SaveTicketPrintSettingsInput {
  readonly businessId: string;
  /** Ausente/null = global del negocio. */
  readonly branchId?: string | null;
  /** Configuración COMPLETA (el alcance se reemplaza entero, no se mezcla). */
  readonly settings: TicketPrintSettings;
}

/**
 * Guarda (crea o reemplaza) la configuración de un alcance. Valida antes de
 * ir al servidor y devuelve lo que quedó guardado. Falla con
 * `SETTINGS_FORBIDDEN` si el usuario no es ADMIN o el plan venció.
 */
export async function saveTicketPrintSettings(
  input: SaveTicketPrintSettingsInput
): Promise<SettingsScope<TicketPrintSettings>> {
  const payload = ticketPrintSettingsToPayload(input.settings);
  const { data, error } = await supabase.rpc("upsert_ticket_print_settings", {
    p_business_id: requireBusinessId(input.businessId),
    p_branch_id: normalizeBranchId(input.branchId),
    p_settings: payload
  });
  if (error) throw toSettingsError(error, "No se pudo guardar la configuración del ticket.");

  const row = Array.isArray(data) ? data[0] : data;
  if (!row) throw new Error("SETTINGS_NOT_SAVED: la base no confirmó el guardado.");
  return toScope(parseRow(row));
}

/**
 * Quita el override de una sucursal para que vuelva a heredar la del negocio.
 * Devuelve `true` si borró una fila. `false` significa "no hubo nada que
 * borrar" (no tenía override, o la RLS no te deja borrarlo: un usuario que no
 * es ADMIN recibe `false`, nunca un éxito falso).
 * No existe forma de borrar la configuración global desde aquí.
 */
export async function clearBranchTicketPrintSettings(businessId: string, branchId: string): Promise<boolean> {
  const { data, error } = await supabase
    .from(TABLE)
    .delete()
    .eq("business_id", requireBusinessId(businessId))
    .eq("branch_id", requireBranchId(branchId))
    .select("id");
  if (error) throw toSettingsError(error, "No se pudo quitar la configuración de la sucursal.");
  return Array.isArray(data) && data.length > 0;
}