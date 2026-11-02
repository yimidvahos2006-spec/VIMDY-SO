/**
 * settingsRepositoryShared.ts
 * ---------------------------------------------------------------------------
 * Piezas comunes de los repositorios de Configuración > Tickets y Reportes
 * (ticketPrintSettingsRepository / reportCloseSettingsRepository): validación
 * de ids y traducción de errores de la base a mensajes claros.
 *
 * Nunca se falla en silencio: un error de la base siempre se lanza.
 */

export interface DbErrorLike {
  readonly message?: string | null;
  readonly code?: string | null;
}

export function requireBusinessId(value: string): string {
  const id = typeof value === "string" ? value.trim() : "";
  if (!id) {
    throw new Error("BUSINESS_CONTEXT_REQUIRED: se requiere un businessId válido.");
  }
  return id;
}

/** `undefined`, `null` o vacío = configuración global del negocio (sin sucursal). */
export function normalizeBranchId(value: string | null | undefined): string | null {
  if (value === undefined || value === null) return null;
  const id = value.trim();
  return id === "" ? null : id;
}

/** Para operaciones que solo existen por sucursal (p. ej. quitar un override). */
export function requireBranchId(value: string | null | undefined): string {
  const id = normalizeBranchId(value);
  if (!id) {
    throw new Error("BRANCH_CONTEXT_REQUIRED: se requiere una sucursal válida.");
  }
  return id;
}

/**
 * Traduce un error de PostgREST/Postgres a un Error con código estable
 * (`SETTINGS_*`) y mensaje en español para mostrar al usuario.
 */
export function toSettingsError(error: DbErrorLike, fallback: string): Error {
  const message = (error.message ?? "").trim();
  const code = error.code ?? "";

  // RLS: no es ADMIN, o el plan venció.
  if (code === "42501" || /row-level security|permission denied/i.test(message)) {
    return new Error(
      "SETTINGS_FORBIDDEN: no se guardó. Solo el administrador puede cambiar esta configuración y el plan debe estar activo."
    );
  }
  // FK compuesto: la sucursal no es de este negocio (o ya no existe).
  if (code === "23503") {
    return new Error("SETTINGS_BRANCH_INVALID: la sucursal no existe o no pertenece a este negocio.");
  }
  // CHECK de la base (valor fuera de catálogo, correos inválidos...).
  if (code === "23514") {
    return new Error(`SETTINGS_INVALID: la base rechazó un valor de la configuración. ${message}`.trim());
  }
  // Un id que no es UUID.
  if (code === "22P02") {
    return new Error("SETTINGS_INVALID_ID: el negocio o la sucursal no tienen un formato válido.");
  }
  // Payload incompleto (lo lanza la propia RPC).
  if (/SETTINGS_INCOMPLETE|SETTINGS_BUSINESS_REQUIRED/.test(message)) {
    return new Error(message);
  }
  // Migración sin aplicar: tabla o función inexistente.
  if (code === "PGRST202" || code === "PGRST205" || code === "42883" || code === "42P01") {
    return new Error(
      "SETTINGS_SCHEMA_MISSING: falta actualizar la base de datos (configuración de tickets y reportes). Avísale a soporte."
    );
  }
  return new Error(message || fallback);
}