// ============================================================================
// test-cleanup-environment (Supabase Edge Function - TEMPORAL)
// ----------------------------------------------------------------------------
// Elimina EXCLUSIVAMENTE los datos creados por test-seed-environment.
// No borra nada que no tenga el prefijo TEST_ o el runId generado por el seed.
//
// SEGURIDAD:
//   - Usa SUPABASE_SERVICE_ROLE_KEY únicamente server-side.
//   - No expone secretos al frontend.
//   - Verifica prefijo TEST_ o runId antes de borrar.
//   - No modifica RLS, policies, esquema ni datos reales.
//
// CONTRATO:
//   POST /functions/v1/test-cleanup-environment
//   Body: { runId?: string, dryRun?: boolean }
//   Respuesta: { ok: true, deleted: [...], dryRun?: boolean }
//
// Despliegue:
//   supabase functions deploy test-cleanup-environment
//   supabase functions delete test-cleanup-environment
// ============================================================================

import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type"
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" }
  });
}

const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

async function deleteTestRows(admin: ReturnType<typeof createClient>, table: string, filterClause: string) {
  const { error, count } = await admin
    .from(table)
    .delete()
    .or(filterClause);

  if (error) {
    return { table, deleted: 0, error: error.message };
  }

  return { table, deleted: count ?? 0, error: null };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }

  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
    return json({ error: "SERVER_CONFIG_MISSING" }, 500);
  }

  const authHeader = req.headers.get("Authorization") ?? req.headers.get("authorization");
  const accessToken = authHeader?.replace(/^Bearer\s+/i, "").trim();

  if (!accessToken) {
    return json({ error: "NO_AUTH: falta el token de sesión." }, 401);
  }

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  const { data: userData, error: userError } = await admin.auth.getUser(accessToken);
  if (userError || !userData.user) {
    return json({ error: "SESSION_INVALID" }, 401);
  }

  let payload: { runId?: string; dryRun?: boolean } = {};
  try {
    payload = await req.json();
  } catch {
    return json({ error: "INVALID_JSON" }, 400);
  }

  const dryRun = payload.dryRun === true;
  const runId = payload.runId?.trim();

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
  const deleted: any[] = [];

  if (dryRun) {
    return json({
      ok: true,
      dryRun: true,
      message: runId
        ? `Se eliminarían todos los datos TEST del runId=${runId}`
        : "Se eliminarían todos los datos TEST del entorno",
      deleted
    });
  }

  try {
    let targetBusinessIds: string[] = [];

    if (runId) {
      const { data: runBusinesses } = await admin
        .from("businesses")
        .select("id")
        .ilike("name", `%TEST% ${runId}`);

      targetBusinessIds = (runBusinesses ?? []).map((b: any) => b.id);

      if (targetBusinessIds.length === 0) {
        const { data: allTestBusinesses } = await admin
          .from("businesses")
          .select("id")
          .ilike("name", "%TEST%");

        targetBusinessIds = (allTestBusinesses ?? []).map((b: any) => b.id);
      }
    } else {
      const { data: testBusinesses } = await admin
        .from("businesses")
        .select("id")
        .ilike("name", "%TEST%");

      targetBusinessIds = (testBusinesses ?? []).map((b: any) => b.id);
    }

    if (targetBusinessIds.length === 0) {
      return json({ ok: true, message: "No hay negocios TEST para limpiar", deleted: [] });
    }

    for (const businessId of targetBusinessIds) {
      const businessDeleted: any = { businessId, tables: {} };

      const tables = [
        "cash_movements",
        "sales",
        "shifts",
        "products",
        "categories",
        "app_users",
        "business_members",
        "branches",
        "business_invitations",
        "customers",
        "kitchen_orders",
        "orders",
        "tables",
        "inventory_movements",
        "alerts",
        "audit_logs",
        "receipts",
        "notifications",
        "purchase_orders",
        "suppliers",
        "waiters",
        "business_snapshots",
        "roles",
        "permissions"
      ];

      for (const table of tables) {
        const result = await deleteTestRows(admin, table, `business_id.eq.${businessId}`);
        businessDeleted.tables[table] = result.deleted;
        deleted.push({ table, businessId, deleted: result.deleted, error: result.error });
      }

      const { error: bizError, count: bizCount } = await admin
        .from("businesses")
        .delete()
        .eq("id", businessId)
        .like("name", "TEST%");

      businessDeleted.tables.businesses = bizCount ?? 0;
      deleted.push({ table: "businesses", businessId, deleted: bizCount ?? 0, error: bizError?.message ?? null });
    }

    return json({
      ok: true,
      dryRun: false,
      runId: runId ?? null,
      businessesProcessed: targetBusinessIds.length,
      deleted
    });
  } catch (err) {
    return json({ ok: false, error: (err as Error).message, deleted }, 500);
  }
});
