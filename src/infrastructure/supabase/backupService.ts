import { supabase, getCurrentBusinessId } from "./supabaseClient";

/* ===========================================================================
   backupService
   ---------------------------------------------------------------------------
   El plan gratuito de Supabase NO incluye backups automáticos del lado del
   servidor (eso solo viene en el plan Pro en adelante, con "Point in Time
   Recovery"). Mientras tanto, esto da una red de seguridad real: descarga
   TODA la información del negocio activo (todas las tablas, ya filtradas
   por Row Level Security) en un único archivo .json que el dueño puede
   guardar donde quiera (su computador, Google Drive, correo, etc).

   Recomendación a mediano plazo: cuando el negocio empiece a crecer,
   subir el proyecto de Supabase al plan Pro (backups diarios automáticos
   + Point in Time Recovery de 7 días) desde Project Settings -> Add-ons.
   Este archivo es un complemento a eso, no un reemplazo.
=========================================================================== */

const BACKUP_TABLES = [
  "products", "sales", "customers", "kitchen_orders", "alerts",
  "inventory_movements", "cash_movements", "tables", "orders",
  "shifts", "roles", "permissions", "audit_logs", "categories",
  "suppliers", "app_users", "receipts"
] as const;

export interface BackupSnapshot {
  version: 1;
  businessId: string;
  createdAt: string;
  tables: Record<string, unknown[]>;
}

/**
 * Lee todas las tablas del negocio activo y arma un snapshot completo.
 * No hace falta pasar el businessId a mano: RLS + getCurrentBusinessId()
 * garantizan que solo se lea lo que le pertenece al negocio logueado.
 */
export async function buildBackupSnapshot(): Promise<BackupSnapshot> {
  const businessId = getCurrentBusinessId();
  const tables: Record<string, unknown[]> = {};

  for (const tableName of BACKUP_TABLES) {
    const { data, error } = await supabase
      .from(tableName)
      .select("data")
      .eq("business_id", businessId);

    if (error) {
      throw new Error(`BACKUP_FAILED (${tableName}): ${error.message}`);
    }

    tables[tableName] = (data ?? []).map((row) => row.data);
  }

  return {
    version: 1,
    businessId,
    createdAt: new Date().toISOString(),
    tables
  };
}

/**
 * Genera el snapshot y dispara la descarga del archivo .json en el
 * navegador. Listo para colgar de un botón "Descargar backup" en
 * Configuración.
 */
export async function downloadBackup(): Promise<void> {
  const snapshot = await buildBackupSnapshot();
  const blob = new Blob([JSON.stringify(snapshot, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);

  const fecha = new Date().toISOString().slice(0, 10);
  const link = document.createElement("a");
  link.href = url;
  link.download = `vimdy-backup-${fecha}.json`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);

  URL.revokeObjectURL(url);
}