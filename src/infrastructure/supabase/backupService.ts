import { supabase, requireCurrentBusinessId } from "./supabaseClient";

/* ===========================================================================
   backupService
   ---------------------------------------------------------------------------
   El plan gratuito de Supabase NO incluye backups automáticos del lado del
   servidor (eso solo viene en el plan Pro en adelante, con "Point in Time
   Recovery"). Mientras tanto, esto da una red de seguridad real: descarga
   la información del negocio activo (las tablas de abajo, ya filtradas
   por Row Level Security) en un único archivo .json que el dueño puede
   guardar donde quiera (su computador, Google Drive, correo, etc).

   Reglas que este archivo garantiza (no romper):
   - Supabase corta cada consulta en 1000 filas, así que cada tabla se pide
     por páginas ordenadas por `id`. Un backup NUNCA sale truncado en silencio:
     si una página falla (tras un reintento) se lanza el error y no se
     descarga ningún archivo.
   - El archivo se arma por trozos cediendo el hilo a la interfaz entre uno
     y otro, para que un negocio grande no congele la pantalla.
   - Solo una descarga a la vez: un doble clic reutiliza la que está en curso.

   Recomendación a mediano plazo: cuando el negocio empiece a crecer,
   subir el proyecto de Supabase al plan Pro (backups diarios automáticos
   + Point in Time Recovery de 7 días) desde Project Settings -> Add-ons.
   Este archivo es un complemento a eso, no un reemplazo.
=========================================================================== */

/**
 * Tablas con la forma estándar (`business_id` + columna `data` jsonb) que
 * crea 20260821000000_initial_schema.sql y app_users. Se omiten a propósito
 * `notifications` (efímeras) y `business_snapshots` (interna).
 */
export const BACKUP_TABLES = [
  "products", "sales", "customers", "kitchen_orders", "alerts",
  "inventory_movements", "cash_movements", "tables", "orders",
  "shifts", "roles", "permissions", "audit_logs", "categories",
  "suppliers", "app_users", "receipts", "waiters", "purchase_orders"
] as const;

/**
 * `customers_v2` (20261113000000_customers_v2_loyalty_server_columns.sql) es la
 * sucesora de `customers`: columnas reales, sin `data`. Se exporta la fila
 * completa, con los puntos de fidelización (lifetime_*, loyalty_tier,
 * legacy_points). `authenticated` tiene SELECT sobre todas sus columnas.
 *
 * Es OPCIONAL: si la migración todavía no está aplicada en ese proyecto, la
 * tabla no existe y se omite (queda anotada en `skipped`) en vez de tumbar
 * todo el backup. Cualquier otro error (permisos, red) sí aborta.
 */
export const CUSTOMERS_V2_TABLE = "customers_v2";
export const CUSTOMERS_V2_COLUMNS = [
  "id", "business_id", "branch_id", "version",
  "name", "email", "phone_raw", "phone_e164",
  "document_type", "document_number", "document_key",
  "lifetime_spent", "lifetime_purchase_count", "lifetime_points",
  "first_purchase_at", "last_purchase_at", "metrics_updated_at",
  "legacy_points", "loyalty_tier", "created_at", "updated_at"
] as const;

/** Todas las tablas del backup, en el orden en que aparecen en el archivo. */
export const BACKUP_ALL_TABLES: readonly string[] = [...BACKUP_TABLES, CUSTOMERS_V2_TABLE];

const isRowTable = (tableName: string) => tableName === CUSTOMERS_V2_TABLE;

/** La tabla no existe en este proyecto (PGRST205 de PostgREST o 42P01 de Postgres). */
function isMissingTableError(error: { code?: string; message?: string }): boolean {
  return (
    error.code === "PGRST205" ||
    error.code === "42P01" ||
    /could not find the table|relation .* does not exist/i.test(error.message ?? "")
  );
}

export const BACKUP_PAGE_SIZE = 1000;
const MAX_PAGES = 200; // tope de seguridad: 200.000 filas por tabla
const SERIALIZE_CHUNK_ROWS = 2000;
const RETRY_DELAY_MS = 300;
const REVOKE_URL_AFTER_MS = 30_000;

export interface BackupSnapshot {
  version: 1;
  businessId: string;
  createdAt: string;
  /** Cantidad de filas exportadas por tabla (sirve para verificar el archivo). */
  counts: Record<string, number>;
  /** Tablas opcionales que no existen en este proyecto y por eso no se exportaron. */
  skipped: string[];
  tables: Record<string, unknown[]>;
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Cede el hilo para que el navegador pinte y atienda clics entre trozos pesados. */
const yieldToUi = () => sleep(0);

/** Devuelve las filas de la página, o `null` si es una tabla opcional que no existe. */
async function fetchPage(
  tableName: string,
  businessId: string,
  from: number
): Promise<Array<Record<string, unknown>> | null> {
  const columns = isRowTable(tableName) ? CUSTOMERS_V2_COLUMNS.join(",") : "data";
  let lastMessage = "";
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const { data, error } = await supabase
      .from(tableName)
      .select(columns)
      .eq("business_id", businessId)
      .order("id", { ascending: true })
      .range(from, from + BACKUP_PAGE_SIZE - 1);

    if (!error) return (data ?? []) as unknown as Array<Record<string, unknown>>;
    if (isRowTable(tableName) && isMissingTableError(error)) return null;

    lastMessage = error.message;
    if (attempt === 0) await sleep(RETRY_DELAY_MS);
  }
  throw new Error(`BACKUP_FAILED (${tableName}): ${lastMessage}`);
}

/** Todas las filas de una tabla, o `null` si es opcional y no existe. */
async function fetchTableRows(tableName: string, businessId: string): Promise<unknown[] | null> {
  const rows: unknown[] = [];
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const batch = await fetchPage(tableName, businessId, page * BACKUP_PAGE_SIZE);
    if (batch === null) return null;
    for (const row of batch) rows.push(isRowTable(tableName) ? row : row.data);
    if (batch.length < BACKUP_PAGE_SIZE) return rows;
  }
  throw new Error(
    `BACKUP_FAILED (${tableName}): más de ${BACKUP_PAGE_SIZE * MAX_PAGES} filas`
  );
}

/**
 * Lee todas las tablas del negocio activo y arma un snapshot completo.
 * No hace falta pasar el businessId a mano: RLS + getCurrentBusinessId()
 * garantizan que solo se lea lo que le pertenece al negocio logueado.
 */
export async function buildBackupSnapshot(): Promise<BackupSnapshot> {
  const businessId = requireCurrentBusinessId();
  const tables: Record<string, unknown[]> = {};
  const counts: Record<string, number> = {};
  const skipped: string[] = [];

  for (const tableName of BACKUP_ALL_TABLES) {
    const rows = await fetchTableRows(tableName, businessId);
    if (rows === null) {
      skipped.push(tableName);
      continue;
    }
    tables[tableName] = rows;
    counts[tableName] = rows.length;
  }

  return {
    version: 1,
    businessId,
    createdAt: new Date().toISOString(),
    counts,
    skipped,
    tables
  };
}

/**
 * Convierte el snapshot en un Blob JSON válido, serializando una fila por
 * línea y por trozos de 2000 filas, cediendo el hilo entre trozos.
 */
export async function serializeBackup(snapshot: BackupSnapshot): Promise<Blob> {
  const parts: string[] = [
    `{\n"version": ${snapshot.version},\n` +
      `"businessId": ${JSON.stringify(snapshot.businessId)},\n` +
      `"createdAt": ${JSON.stringify(snapshot.createdAt)},\n` +
      `"counts": ${JSON.stringify(snapshot.counts)},\n` +
      `"skipped": ${JSON.stringify(snapshot.skipped ?? [])},\n` +
      `"tables": {\n`
  ];

  const names = Object.keys(snapshot.tables);
  for (let i = 0; i < names.length; i += 1) {
    const name = names[i];
    const rows = snapshot.tables[name];
    parts.push(`${JSON.stringify(name)}: [`);

    for (let start = 0; start < rows.length; start += SERIALIZE_CHUNK_ROWS) {
      const chunk = rows
        .slice(start, start + SERIALIZE_CHUNK_ROWS)
        .map((row) => JSON.stringify(row) ?? "null")
        .join(",\n");
      parts.push((start > 0 ? ",\n" : "\n") + chunk);
      await yieldToUi();
    }

    parts.push(rows.length > 0 ? "\n]" : "]");
    parts.push(i < names.length - 1 ? ",\n" : "\n");
  }

  parts.push("}\n}\n");
  return new Blob(parts, { type: "application/json" });
}

/** vimdy-backup-2026-11-01-2330.json — con la hora LOCAL (no UTC) del dueño. */
export function backupFileName(now: Date = new Date()): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return (
    `vimdy-backup-${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}` +
    `-${p(now.getHours())}${p(now.getMinutes())}.json`
  );
}

function triggerDownload(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.rel = "noopener";
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);

  // Revocar al instante cancela la descarga en Safari/Firefox: se hace tarde.
  setTimeout(() => URL.revokeObjectURL(url), REVOKE_URL_AFTER_MS);
}

let inFlight: Promise<void> | null = null;

/**
 * Genera el snapshot y dispara la descarga del archivo .json en el
 * navegador. Listo para colgar de un botón "Descargar backup" en
 * Configuración. Si ya hay una descarga en curso, devuelve esa misma.
 */
export function downloadBackup(): Promise<void> {
  if (inFlight) return inFlight;
  inFlight = (async () => {
    const snapshot = await buildBackupSnapshot();
    const blob = await serializeBackup(snapshot);
    triggerDownload(blob, backupFileName());
  })().finally(() => {
    inFlight = null;
  });
  return inFlight;
}