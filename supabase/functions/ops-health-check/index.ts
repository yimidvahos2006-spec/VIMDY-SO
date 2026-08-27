// ============================================================================
// ops-health-check (Supabase Edge Function)
// ----------------------------------------------------------------------------
// FASE 3.5 #2: "que tú te enteres antes que el cliente".
//
// Qué hace, cada vez que corre (recomendado: cada 15 min vía cron —
// ver .github/workflows/ops-health-check.yml en este mismo repo):
//
//   1. Cuenta errores 'error' (no 'warning') insertados en `system_errors`
//      en los últimos OPS_ERROR_WINDOW_MINUTES. Si supera el umbral, alerta.
//   2. Revisa `subscription_payments` con status 'pending' que llevan más
//      de OPS_STUCK_PAYMENT_HOURS sin resolverse — señal de que ni el
//      webhook del proveedor NI payments-reconcile lograron resolverlos.
//      Un pago atascado es plata que no está entrando y el negocio no lo
//      sabe.
//   3. Reporta cuántos negocios activos hay (businesses con plan != 'trial'
//      o con trial vigente) — contexto rápido, no alerta por sí solo.
//
// Cada corrida manda UN resumen por webhook si hay algo que reportar
// (nunca manda "todo bien" para no generar ruido que termine ignorado).
//
// SEGURIDAD: igual que payments-reconcile, exige x-ops-secret propio — no
// hay usuario humano detrás de esta llamada, solo el cron.
//
// PROGRAMACIÓN — esta función NO se dispara sola. Hace falta el cron de
// supabase/ops_health_check_cron.sql (pg_cron, cada 15 min) o el mismo
// intervalo configurado desde "Cron Jobs" en el dashboard de Supabase.
// Sin uno de los dos, esta función solo corre si alguien la llama a mano.
//
// CONFIGURACIÓN REQUERIDA:
//   supabase secrets set OPS_SECRET=<cadena larga aleatoria>
//   supabase secrets set OPS_WEBHOOK_URL=<tu webhook de Slack/Discord>
//
// Despliegue:
//   supabase functions deploy ops-health-check --no-verify-jwt
// ============================================================================

import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type, x-ops-secret"
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" }
  });
}

const OPS_ERROR_WINDOW_MINUTES = 15;
const OPS_ERROR_THRESHOLD = 5; // más de 5 errores reales en 15 min = algo se está rompiendo de verdad
const OPS_STUCK_PAYMENT_HOURS = 6; // payments-reconcile ya corre cada 10 min; si sigue pending 6h, algo falló en serio

const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const OPS_SECRET = Deno.env.get("OPS_SECRET");
const OPS_WEBHOOK_URL = Deno.env.get("OPS_WEBHOOK_URL");

const DISCORD_CONTENT_LIMIT = 1900; // límite real de Discord es 2000; deja margen

async function notify(rawText: string) {
  if (!OPS_WEBHOOK_URL) return;
  const text =
    rawText.length > DISCORD_CONTENT_LIMIT
      ? `${rawText.slice(0, DISCORD_CONTENT_LIMIT)}\n… (recortado, revisa system_errors para el detalle completo)`
      : rawText;
  try {
    // Manda ambos campos a propósito: Discord solo lee "content" (ignora
    // "text" en silencio, sin error, así que un webhook de Discord con
    // solo "text" parece funcionar pero JAMÁS aparece nada en el canal).
    // Slack/Discord con formato "Slack-compatible" leen "text". Con los
    // dos, sirve para cualquiera de los dos sin tener que configurar nada
    // distinto según el proveedor que elijas.
    await fetch(OPS_WEBHOOK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: text, text })
    });
  } catch (error) {
    console.error("OPS_HEALTH_CHECK_NOTIFY_FAILED", String(error));
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (!SUPABASE_URL || !SERVICE_ROLE_KEY || !OPS_SECRET) {
    return json({ error: "SERVER_CONFIG_MISSING" }, 500);
  }

  if (req.headers.get("x-ops-secret") !== OPS_SECRET) {
    return json({ error: "UNAUTHORIZED" }, 401);
  }

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
  const problems: string[] = [];

  // ---- 1. Errores recientes -------------------------------------------
  const errorCutoff = new Date(Date.now() - OPS_ERROR_WINDOW_MINUTES * 60_000).toISOString();
  const { data: recentErrorRows, error: errorsFetchError } = await admin
    .from("system_errors")
    .select("id")
    .eq("severity", "error")
    .gte("created_at", errorCutoff)
    .limit(1000);
  const recentErrorCount = recentErrorRows?.length ?? 0;

  if (errorsFetchError) {
    // console.error a propósito, aparte de mandarlo a Discord — así queda
    // visible en Logs del Dashboard aunque el webhook falle o nadie esté
    // mirando el canal en ese momento. Loggeamos TODO el detalle posible
    // porque a veces error.message viene vacío y el resto de campos
    // (code/details/hint) son los que de verdad explican qué pasó.
    console.error(
      "OPS_HEALTH_CHECK_SYSTEM_ERRORS_READ_FAILED",
      JSON.stringify({
        message: errorsFetchError.message,
        code: (errorsFetchError as { code?: string }).code,
        details: (errorsFetchError as { details?: string }).details,
        hint: (errorsFetchError as { hint?: string }).hint,
        keys: Object.keys(errorsFetchError)
      })
    );
    problems.push(`⚠️ No se pudo leer system_errors: ${errorsFetchError.message || errorsFetchError.code || "error desconocido"}`);
  } else if ((recentErrorCount ?? 0) > OPS_ERROR_THRESHOLD) {
    // Agrupa por categoría para que la alerta diga QUÉ se está rompiendo,
    // no solo cuánto.
    const { data: recentErrors } = await admin
      .from("system_errors")
      .select("category")
      .eq("severity", "error")
      .gte("created_at", errorCutoff);

    const byCategory = (recentErrors ?? []).reduce<Record<string, number>>((acc, row) => {
      const cat = (row as { category: string }).category;
      acc[cat] = (acc[cat] ?? 0) + 1;
      return acc;
    }, {});
    const breakdown = Object.entries(byCategory)
      .map(([cat, n]) => `${cat}: ${n}`)
      .join(", ");

    problems.push(
      `🚨 ${recentErrorCount} errores en los últimos ${OPS_ERROR_WINDOW_MINUTES} min (umbral: ${OPS_ERROR_THRESHOLD}). Por categoría — ${breakdown}`
    );
  }

  // ---- 2. Pagos atascados ----------------------------------------------
  const paymentCutoff = new Date(Date.now() - OPS_STUCK_PAYMENT_HOURS * 60 * 60_000).toISOString();
  const { data: stuckPayments, error: paymentsFetchError } = await admin
    .from("subscription_payments")
    .select("id, business_id, plan, amount, currency, created_at")
    .eq("status", "pending")
    .lt("created_at", paymentCutoff);

  if (paymentsFetchError) {
    console.error("OPS_HEALTH_CHECK_SUBSCRIPTION_PAYMENTS_READ_FAILED", JSON.stringify(paymentsFetchError));
    problems.push(`⚠️ No se pudo leer subscription_payments: ${paymentsFetchError.message || paymentsFetchError.code || "error desconocido"}`);
  } else if (stuckPayments && stuckPayments.length > 0) {
    const ids = stuckPayments.map((p) => p.id).join(", ");
    problems.push(
      `🚨 ${stuckPayments.length} pago(s) llevan más de ${OPS_STUCK_PAYMENT_HOURS}h en 'pending' sin resolverse (ni webhook ni payments-reconcile los cerraron). IDs: ${ids}`
    );
  }

  // ---- 3. Contexto de negocio (informativo, no dispara alerta sola) ---
  const { count: activeBusinesses } = await admin
    .from("businesses")
    .select("id", { count: "exact", head: true });

  if (problems.length > 0) {
    const summary = [
      `📋 VIMDY — Reporte de salud (${new Date().toISOString()})`,
      ...problems,
      `Negocios totales registrados: ${activeBusinesses ?? "desconocido"}`
    ].join("\n");
    await notify(summary);
  }

  return json({
    ok: true,
    problemsFound: problems.length,
    recentErrorCount: recentErrorCount ?? 0,
    stuckPaymentsCount: stuckPayments?.length ?? 0,
    totalBusinesses: activeBusinesses ?? null
  });
});