/**
 * reportCloseSettingsRepository.ts
 * ---------------------------------------------------------------------------
 * Lectura y escritura de los ajustes del "Cierre inteligente por correo"
 * (`public.report_close_settings`), con alcance opcional por sucursal.
 *
 *   branchId ausente/null  -> configuración GLOBAL del negocio
 *   branchId con valor     -> override de esa sucursal (fila completa)
 *
 * Herencia al leer: override de la sucursal -> global del negocio -> defaults.
 *
 * Seguridad (la impone la base con RLS): esta tabla contiene correos, así que
 * SOLO el ADMIN la lee y la escribe (y solo con plan activo para escribir).
 * Un usuario que no es ADMIN recibe `source: "default"` al leer: la RLS le
 * oculta las filas, y eso NO significa que el negocio no tenga configuración.
 * Las pantallas solo deben mostrar esto al ADMIN.
 *
 * Esta tabla NO reemplaza todavía a `daily_report_settings` (que siguen
 * leyendo process-daily-report y whatsapp-webhook).
 */

import { supabase } from "./supabaseClient";
import {
  defaultReportCloseSettings,
  reportCloseSettingsFromRow,
  reportCloseSettingsToPayload,
  type ReportCloseSettings,
  type ReportCloseSettingsRow,
  type ResolvedSettings,
  type SettingsScope
} from "../../core/settings/ticketReportSettings";
import {
  normalizeBranchId,
  requireBranchId,
  requireBusinessId,
  toSettingsError
} from "./settingsRepositoryShared";

const TABLE = "report_close_settings";
const COLUMNS =
  "id,business_id,branch_id,enabled,send_on_shift_close,email_enabled,email_recipients," +
  "email_fallback_enabled,created_at,updated_at,updated_by";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseRow(value: unknown): ReportCloseSettingsRow {
  if (
    !isRecord(value) ||
    typeof value.business_id !== "string" ||
    typeof value.updated_at !== "string" ||
    !Array.isArray(value.email_recipients)
  ) {
    throw new Error("REPORT_SETTINGS_INVALID: la base devolvió una fila que no se puede leer.");
  }
  return value as unknown as ReportCloseSettingsRow;
}

function toScope(row: ReportCloseSettingsRow): SettingsScope<ReportCloseSettings> {
  return {
    businessId: row.business_id,
    branchId: row.branch_id ?? null,
    settings: reportCloseSettingsFromRow(row),
    updatedAt: row.updated_at
  };
}

/** Configuración efectiva del cierre para una sucursal. Sin filas visibles: defaults. */
export async function fetchEffectiveReportCloseSettings(
  businessId: string,
  branchId?: string | null
): Promise<ResolvedSettings<ReportCloseSettings>> {
  const { data, error } = await supabase.rpc("resolve_report_close_settings", {
    p_business_id: requireBusinessId(businessId),
    p_branch_id: normalizeBranchId(branchId)
  });
  if (error) throw toSettingsError(error, "No se pudo leer la configuración del cierre.");

  const rows: unknown[] = Array.isArray(data) ? data : data ? [data] : [];
  if (rows.length === 0) {
    return { settings: defaultReportCloseSettings(), source: "default", branchId: null, updatedAt: null };
  }

  const scope = toScope(parseRow(rows[0]));
  return {
    settings: scope.settings,
    source: scope.branchId ? "branch" : "business",
    branchId: scope.branchId,
    updatedAt: scope.updatedAt
  };
}

/** La fila EXACTA de un alcance (sin heredar), o `null` si no tiene configuración propia. */
export async function fetchReportCloseSettingsScope(
  businessId: string,
  branchId?: string | null
): Promise<SettingsScope<ReportCloseSettings> | null> {
  const branch = normalizeBranchId(branchId);
  let query = supabase.from(TABLE).select(COLUMNS).eq("business_id", requireBusinessId(businessId));
  query = branch ? query.eq("branch_id", branch) : query.is("branch_id", null);

  const { data, error } = await query.maybeSingle();
  if (error) throw toSettingsError(error, "No se pudo leer la configuración del cierre.");
  return data ? toScope(parseRow(data)) : null;
}

/** Todas las configuraciones del negocio: la global primero, luego los overrides. */
export async function listReportCloseSettingsScopes(
  businessId: string
): Promise<SettingsScope<ReportCloseSettings>[]> {
  const { data, error } = await supabase
    .from(TABLE)
    .select(COLUMNS)
    .eq("business_id", requireBusinessId(businessId))
    .order("branch_id", { ascending: true, nullsFirst: true });
  if (error) throw toSettingsError(error, "No se pudieron leer las configuraciones del cierre.");
  return (Array.isArray(data) ? data : []).map((row) => toScope(parseRow(row)));
}

export interface SaveReportCloseSettingsInput {
  readonly businessId: string;
  /** Ausente/null = global del negocio. */
  readonly branchId?: string | null;
  /** Configuración COMPLETA (el alcance se reemplaza entero, no se mezcla). */
  readonly settings: ReportCloseSettings;
}

/**
 * Guarda (crea o reemplaza) la configuración de un alcance. Normaliza los
 * correos (minúsculas, sin repetidos) y valida antes de ir al servidor.
 * Falla con `SETTINGS_FORBIDDEN` si el usuario no es ADMIN o el plan venció.
 */
export async function saveReportCloseSettings(
  input: SaveReportCloseSettingsInput
): Promise<SettingsScope<ReportCloseSettings>> {
  const payload = reportCloseSettingsToPayload(input.settings);
  const { data, error } = await supabase.rpc("upsert_report_close_settings", {
    p_business_id: requireBusinessId(input.businessId),
    p_branch_id: normalizeBranchId(input.branchId),
    p_settings: payload
  });
  if (error) throw toSettingsError(error, "No se pudo guardar la configuración del cierre.");

  const row = Array.isArray(data) ? data[0] : data;
  if (!row) throw new Error("SETTINGS_NOT_SAVED: la base no confirmó el guardado.");
  return toScope(parseRow(row));
}

/**
 * Quita el override de una sucursal para que vuelva a heredar la del negocio.
 * `true` si borró una fila; `false` si no había nada que borrar o la RLS no lo
 * permite (un usuario que no es ADMIN recibe `false`, nunca un éxito falso).
 */
export async function clearBranchReportCloseSettings(businessId: string, branchId: string): Promise<boolean> {
  const { data, error } = await supabase
    .from(TABLE)
    .delete()
    .eq("business_id", requireBusinessId(businessId))
    .eq("branch_id", requireBranchId(branchId))
    .select("id");
  if (error) throw toSettingsError(error, "No se pudo quitar la configuración de la sucursal.");
  return Array.isArray(data) && data.length > 0;
}