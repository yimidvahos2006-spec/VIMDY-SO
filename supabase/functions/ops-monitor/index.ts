// ============================================================================
// ops-monitor (Supabase Edge Function)
// ----------------------------------------------------------------------------
// Sistema completo de monitoreo de VIMDY para Discord.
//
// Extiende ops-health-check con métricas comprehensivas:
//   - Negocios registrados y nuevos (últimas 24h)
//   - Usuarios registrados
//   - Suscripciones y pagos
//   - Tamaño real de base de datos
//   - Conexiones activas
//   - Errores del sistema
//   - Salud general de VIMDY
//   - Capacidad y umbrales de recursos
//
// MODOS DE OPERACIÓN:
//   - mode=check: Evalúa umbrales y envía alertas solo si hay problemas
//   - mode=daily: Envía resumen diario completo (sin problemas requeridos)
//
// SEGURIDAD: usa x-ops-secret propio, igual que ops-health-check.
//
// PROGRAMACIÓN: requiere cron externo (GitHub Actions) o pg_cron.
//   - Cada 15 min: mode=check
//   - Cada día 9am UTC-5: mode=daily
//
// CONFIGURACIÓN:
//   supabase secrets set OPS_SECRET=<cadena larga aleatoria>
//   supabase secrets set OPS_WEBHOOK_URL=<tu webhook de Discord>
//
// Despliegue:
//   supabase functions deploy ops-monitor --no-verify-jwt
// ============================================================================

import { createClient } from "npm:@supabase/supabase-js@2";

const VIMDY_APP_URL = Deno.env.get("VIMDY_APP_URL") ?? "*";

const corsHeaders = {
  "Access-Control-Allow-Origin": VIMDY_APP_URL,
  "Access-Control-Allow-Headers": "content-type, x-ops-secret"
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" }
  });
}

const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const OPS_SECRET = Deno.env.get("OPS_SECRET");
const OPS_WEBHOOK_URL = Deno.env.get("OPS_WEBHOOK_URL");

const DISCORD_CONTENT_LIMIT = 1900;

// ============================================================================
// Límites del plan Free de Supabase (configurables según plan real)
// ============================================================================
const LIMITS = {
  DB_SIZE_MB: 500,
  STORAGE_MB: 1024,
  BANDWIDTH_GB: 5 * 1024, // MB por mes
  EDGE_FUNCTIONS_MONTHLY: 500000,
  AUTH_USERS: 50000,
  CONNECTIONS: 200
};

// ============================================================================
// Umbrales de alerta (porcentaje del límite)
// ============================================================================
const THRESHOLDS = {
  GREEN: 0.50,   // 0-50%: OK
  YELLOW: 0.70,  // 50-70%: Advertencia
  ORANGE: 0.80,  // 80-90%: Crítico
  RED: 0.90      // 90%+: Emergencia
};

// ============================================================================
// Funciones auxiliares
// ============================================================================

async function notify(content: string, embeds?: unknown[]) {
  if (!OPS_WEBHOOK_URL) return;

  const payload: Record<string, unknown> = {};

  if (content.length <= DISCORD_CONTENT_LIMIT) {
    payload.content = content;
  } else {
    payload.content = `${content.slice(0, DISCORD_CONTENT_LIMIT)}\n… (recortado, revisa el dashboard para detalle completo)`;
  }

  if (embeds && embeds.length > 0) {
    payload.embeds = embeds;
  }

  try {
    await fetch(OPS_WEBHOOK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
  } catch (error) {
    console.error("OPS_MONITOR_NOTIFY_FAILED", String(error));
  }
}

function getStatusEmoji(percentage: number): string {
  if (percentage >= THRESHOLDS.RED) return "🔴";
  if (percentage >= THRESHOLDS.ORANGE) return "🟠";
  if (percentage >= THRESHOLDS.YELLOW) return "🟡";
  return "🟢";
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1073741824) return `${(bytes / 1048576).toFixed(1)} MB`;
  return `${(bytes / 1073741824).toFixed(2)} GB`;
}

function formatNumber(n: number): string {
  return n.toLocaleString("es-CO");
}

// ============================================================================
// Recolección de métricas
// ============================================================================

interface DbMetrics {
  db_size_bytes: number;
  db_size_mb: number;
  active_connections: number;
  max_connections: number;
  cache_hit_ratio: number;
  transactions_committed: number;
  transactions_rolled_back: number;
}

interface BusinessMetrics {
  total: number;
  new_last_24h: number;
  trial_count: number;
  monthly_count: number;
  yearly_count: number;
  suspended_count: number;
  active_subscriptions: number;
}

interface UserMetrics {
  total_users: number;
  total_memberships: number;
}

interface PaymentMetrics {
  pending_count: number;
  pending_old_6h: number;
  pending_old_24h: number;
  approved_today: number;
  declined_today: number;
  total_revenue_cents: number;
}

interface ErrorMetrics {
  errors_last_hour: number;
  errors_last_24h: number;
  errors_by_category: Record<string, number>;
}

interface SystemHealth {
  overall_status: "healthy" | "warning" | "critical" | "emergency";
  alerts: string[];
  recommendations: string[];
}

async function collectDbMetrics(admin: ReturnType<typeof createClient>): Promise<DbMetrics> {
  const dbSizeQuery = await admin.rpc("get_db_size_bytes").single();
  const dbSizeBytes = (dbSizeQuery.data as number) ?? 0;

  const connectionsQuery = await admin
    .from("pg_stat_activity")
    .select("id", { count: "exact", head: true });
  const activeConnections = connectionsQuery.count ?? 0;

  const cacheQuery = await admin.rpc("get_cache_hit_ratio").single();
  const cacheHitRatio = (cacheQuery.data as number) ?? 99;

  return {
    db_size_bytes: dbSizeBytes,
    db_size_mb: Math.round(dbSizeBytes / 1048576 * 100) / 100,
    active_connections: activeConnections,
    max_connections: LIMITS.CONNECTIONS,
    cache_hit_ratio: cacheHitRatio,
    transactions_committed: 0,
    transactions_rolled_back: 0
  };
}

async function collectBusinessMetrics(admin: ReturnType<typeof createClient>): Promise<BusinessMetrics> {
  const now = new Date();
  const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();

  const totalQuery = await admin
    .from("businesses")
    .select("id", { count: "exact", head: true });

  const newQuery = await admin
    .from("businesses")
    .select("id", { count: "exact", head: true })
    .gte("created_at", yesterday);

  const trialQuery = await admin
    .from("businesses")
    .select("id", { count: "exact", head: true })
    .eq("plan", "trial");

  const monthlyQuery = await admin
    .from("businesses")
    .select("id", { count: "exact", head: true })
    .eq("plan", "monthly");

  const yearlyQuery = await admin
    .from("businesses")
    .select("id", { count: "exact", head: true })
    .eq("plan", "yearly");

  const suspendedQuery = await admin
    .from("businesses")
    .select("id", { count: "exact", head: true })
    .eq("subscription_status", "suspended");

  const activeQuery = await admin
    .from("businesses")
    .select("id", { count: "exact", head: true })
    .eq("subscription_status", "active");

  return {
    total: totalQuery.count ?? 0,
    new_last_24h: newQuery.count ?? 0,
    trial_count: trialQuery.count ?? 0,
    monthly_count: monthlyQuery.count ?? 0,
    yearly_count: yearlyQuery.count ?? 0,
    suspended_count: suspendedQuery.count ?? 0,
    active_subscriptions: activeQuery.count ?? 0
  };
}

async function collectUserMetrics(admin: ReturnType<typeof createClient>): Promise<UserMetrics> {
  const usersQuery = await admin
    .from("auth.users")
    .select("id", { count: "exact", head: true });

  const membershipsQuery = await admin
    .from("business_members")
    .select("user_id", { count: "exact", head: true });

  return {
    total_users: usersQuery.count ?? 0,
    total_memberships: membershipsQuery.count ?? 0
  };
}

async function collectPaymentMetrics(admin: ReturnType<typeof createClient>): Promise<PaymentMetrics> {
  const now = new Date();
  const sixHoursAgo = new Date(now.getTime() - 6 * 60 * 60 * 1000).toISOString();
  const twentyFourHoursAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
  const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();

  const pendingQuery = await admin
    .from("subscription_payments")
    .select("id", { count: "exact", head: true })
    .eq("status", "pending");

  const pendingOld6hQuery = await admin
    .from("subscription_payments")
    .select("id", { count: "exact", head: true })
    .eq("status", "pending")
    .lt("created_at", sixHoursAgo);

  const pendingOld24hQuery = await admin
    .from("subscription_payments")
    .select("id", { count: "exact", head: true })
    .eq("status", "pending")
    .lt("created_at", twentyFourHoursAgo);

  const approvedTodayQuery = await admin
    .from("subscription_payments")
    .select("id", { count: "exact", head: true })
    .eq("status", "approved")
    .gte("created_at", startOfDay);

  const declinedTodayQuery = await admin
    .from("subscription_payments")
    .select("id", { count: "exact", head: true })
    .eq("status", "declined")
    .gte("created_at", startOfDay);

  return {
    pending_count: pendingQuery.count ?? 0,
    pending_old_6h: pendingOld6hQuery.count ?? 0,
    pending_old_24h: pendingOld24hQuery.count ?? 0,
    approved_today: approvedTodayQuery.count ?? 0,
    declined_today: declinedTodayQuery.count ?? 0,
    total_revenue_cents: 0
  };
}

async function collectErrorMetrics(admin: ReturnType<typeof createClient>): Promise<ErrorMetrics> {
  const now = new Date();
  const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000).toISOString();
  const twentyFourHoursAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();

  const errorsLastHourQuery = await admin
    .from("system_errors")
    .select("id", { count: "exact", head: true })
    .eq("severity", "error")
    .gte("created_at", oneHourAgo);

  const errorsLast24hQuery = await admin
    .from("system_errors")
    .select("id", { count: "exact", head: true })
    .eq("severity", "error")
    .gte("created_at", twentyFourHoursAgo);

  const errorsByCategoryQuery = await admin
    .from("system_errors")
    .select("category")
    .eq("severity", "error")
    .gte("created_at", twentyFourHoursAgo);

  const byCategory: Record<string, number> = {};
  if (errorsByCategoryQuery.data) {
    for (const row of errorsByCategoryQuery.data as { category: string }[]) {
      const cat = row.category ?? "unknown";
      byCategory[cat] = (byCategory[cat] ?? 0) + 1;
    }
  }

  return {
    errors_last_hour: errorsLastHourQuery.count ?? 0,
    errors_last_24h: errorsLast24hQuery.count ?? 0,
    errors_by_category: byCategory
  };
}

function evaluateHealth(
  db: DbMetrics,
  business: BusinessMetrics,
  payments: PaymentMetrics,
  errors: ErrorMetrics
): SystemHealth {
  const alerts: string[] = [];
  const recommendations: string[] = [];
  let worstStatus: SystemHealth["overall_status"] = "healthy";

  const updateStatus = (newStatus: SystemHealth["overall_status"]) => {
    const order: SystemHealth["overall_status"][] = ["healthy", "warning", "critical", "emergency"];
    if (order.indexOf(newStatus) > order.indexOf(worstStatus)) {
      worstStatus = newStatus;
    }
  };

  // Evaluar base de datos
  const dbPercentage = (db.db_size_mb / LIMITS.DB_SIZE_MB) * 100;
  if (dbPercentage >= 90) {
    alerts.push(`🔴 Base de datos al ${dbPercentage.toFixed(1)}% (${db.db_size_mb}/${LIMITS.DB_SIZE_MB} MB) — Upgrade a Pro Plan URGENTE`);
    recommendations.push("Upgrade a Supabase Pro Plan ($25/mes) para 8GB de base de datos");
    updateStatus("emergency");
  } else if (dbPercentage >= 80) {
    alerts.push(`🟠 Base de datos al ${dbPercentage.toFixed(1)}% (${db.db_size_mb}/${LIMITS.DB_SIZE_MB} MB) — Planificar upgrade pronto`);
    recommendations.push("Considera upgrade a Pro Plan en las próximas semanas");
    updateStatus("critical");
  } else if (dbPercentage >= 70) {
    alerts.push(`🟡 Base de datos al ${dbPercentage.toFixed(1)}% (${db.db_size_mb}/${LIMITS.DB_SIZE_MB} MB) — Monitorear crecimiento`);
    recommendations.push("Monitorear tasa de crecimiento de base de datos");
    updateStatus("warning");
  }

  // Evaluar conexiones
  const connPercentage = (db.active_connections / db.max_connections) * 100;
  if (connPercentage >= 90) {
    alerts.push(`🔴 Conexiones al ${connPercentage.toFixed(1)}% (${db.active_connections}/${db.max_connections}) — Riesgo de rechazos`);
    recommendations.push("Implementar connection pooling o upgrade a Pro Plan");
    updateStatus("emergency");
  } else if (connPercentage >= 80) {
    alerts.push(`🟠 Conexiones al ${connPercentage.toFixed(1)}% (${db.active_connections}/${db.max_connections})`);
    updateStatus("critical");
  } else if (connPercentage >= 70) {
    alerts.push(`🟡 Conexiones al ${connPercentage.toFixed(1)}% (${db.active_connections}/${db.max_connections})`);
    updateStatus("warning");
  }

  // Evaluar errores
  if (errors.errors_last_hour > 50) {
    alerts.push(`🔴 ${errors.errors_last_hour} errores en la última hora — Algo está roto`);
    recommendations.push("Revisar system_errors en el dashboard de Supabase");
    updateStatus("emergency");
  } else if (errors.errors_last_hour > 20) {
    alerts.push(`🟠 ${errors.errors_last_hour} errores en la última hora`);
    recommendations.push("Investigar causa de errores recientes");
    updateStatus("critical");
  } else if (errors.errors_last_hour > 5) {
    alerts.push(`🟡 ${errors.errors_last_hour} errores en la última hora`);
    updateStatus("warning");
  }

  // Evaluar pagos atascados
  if (payments.pending_old_24h > 0) {
    alerts.push(`🔴 ${payments.pending_old_24h} pago(s) atascados más de 24h — Requiere atención manual`);
    recommendations.push("Ejecutar payments-reconcile y revisar webhooks de pago");
    updateStatus("emergency");
  } else if (payments.pending_old_6h > 0) {
    alerts.push(`🟠 ${payments.pending_old_6h} pago(s) pendientes más de 6h`);
    recommendations.push("Verificar estado de webhooks de Wompi/MercadoPago/PayPal");
    updateStatus("critical");
  }

  // Evaluar suscripciones suspendidas
  if (business.suspended_count > 0) {
    alerts.push(`🟠 ${business.suspended_count} suscripción(es) suspendida(s)`);
    recommendations.push("Contactar a clientes con suscripciones suspendidas");
    updateStatus("warning");
  }

  return {
    overall_status: worstStatus,
    alerts,
    recommendations
  };
}

// ============================================================================
// Formateo de mensajes para Discord
// ============================================================================

function formatAlertMessage(
  health: SystemHealth,
  db: DbMetrics,
  business: BusinessMetrics,
  users: UserMetrics,
  payments: PaymentMetrics,
  errors: ErrorMetrics
): string {
  const lines: string[] = [];

  const statusEmoji = health.overall_status === "healthy" ? "🟢" :
    health.overall_status === "warning" ? "🟡" :
    health.overall_status === "critical" ? "🟠" : "🔴";

  lines.push(`${statusEmoji} **VIMDY — Alerta de Monitoreo**`);
  lines.push("");

  if (health.alerts.length > 0) {
    lines.push("**Problemas detectados:**");
    for (const alert of health.alerts) {
      lines.push(`• ${alert}`);
    }
    lines.push("");
  }

  if (health.recommendations.length > 0) {
    lines.push("**Acciones recomendadas:**");
    for (const rec of health.recommendations) {
      lines.push(`→ ${rec}`);
    }
    lines.push("");
  }

  lines.push("**Estado actual:**");
  lines.push(`📊 DB: ${db.db_size_mb} MB / ${LIMITS.DB_SIZE_MB} MB (${((db.db_size_mb / LIMITS.DB_SIZE_MB) * 100).toFixed(1)}%)`);
  lines.push(`🔌 Conexiones: ${db.active_connections}/${db.max_connections}`);
  lines.push(`🏢 Negocios: ${formatNumber(business.total)}`);
  lines.push(`👤 Usuarios: ${formatNumber(users.total_users)}`);
  lines.push(`⚠️ Errores última hora: ${errors.errors_last_hour}`);

  return lines.join("\n");
}

function formatDailySummary(
  db: DbMetrics,
  business: BusinessMetrics,
  users: UserMetrics,
  payments: PaymentMetrics,
  errors: ErrorMetrics
): string {
  const lines: string[] = [];

  lines.push("📋 **VIMDY — Resumen Diario**");
  lines.push("━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  lines.push("");

  lines.push("**🏢 NEGOCIOS**");
  lines.push(`• Total registrados: **${formatNumber(business.total)}**`);
  lines.push(`• Nuevas últimas 24h: **+${formatNumber(business.new_last_24h)}**`);
  lines.push(`• En trial: ${formatNumber(business.trial_count)}`);
  lines.push(`• Plan mensual: ${formatNumber(business.monthly_count)}`);
  lines.push(`• Plan anual: ${formatNumber(business.yearly_count)}`);
  lines.push(`• Suspendidas: ${business.suspended_count > 0 ? `🟠 ${business.suspended_count}` : "🟢 0"}`);
  lines.push("");

  lines.push("**👤 USUARIOS**");
  lines.push(`• Total registrados: **${formatNumber(users.total_users)}**`);
  lines.push(`• Membresías activas: ${formatNumber(users.total_memberships)}`);
  lines.push("");

  lines.push("**💳 PAGOS**");
  lines.push(`• Aprobados hoy: ${formatNumber(payments.approved_today)}`);
  lines.push(`• Rechazados hoy: ${formatNumber(payments.declined_today)}`);
  lines.push(`• Pendientes: ${payments.pending_count > 0 ? `🟡 ${payments.pending_count}` : "🟢 0"}`);
  if (payments.pending_old_6h > 0) {
    lines.push(`• ⚠️ Pendientes >6h: ${payments.pending_old_6h}`);
  }
  lines.push("");

  lines.push("**💾 INFRAESTRUCTURA**");
  const dbPct = (db.db_size_mb / LIMITS.DB_SIZE_MB) * 100;
  const dbEmoji = getStatusEmoji(dbPct / 100);
  lines.push(`• Base de datos: ${dbEmoji} ${db.db_size_mb} MB / ${LIMITS.DB_SIZE_MB} MB (${dbPct.toFixed(1)}%)`);

  const connPct = (db.active_connections / db.max_connections) * 100;
  const connEmoji = getStatusEmoji(connPct / 100);
  lines.push(`• Conexiones: ${connEmoji} ${db.active_connections}/${db.max_connections} (${connPct.toFixed(1)}%)`);
  lines.push(`• Cache hit ratio: ${db.cache_hit_ratio.toFixed(1)}%`);
  lines.push("");

  lines.push("**⚠️ ERRORES**");
  lines.push(`• Última hora: ${errors.errors_last_hour > 0 ? `🟡 ${errors.errors_last_hour}` : "🟢 0"}`);
  lines.push(`• Últimas 24h: ${errors.errors_last_24h > 0 ? `🟡 ${errors.errors_last_24h}` : "🟢 0"}`);

  if (Object.keys(errors.errors_by_category).length > 0) {
    lines.push("• Por categoría:");
    for (const [cat, count] of Object.entries(errors.errors_by_category)) {
      lines.push(`  - ${cat}: ${count}`);
    }
  }

  lines.push("");
  lines.push("━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  lines.push(`🕐 ${new Date().toISOString().replace("T", " ").slice(0, 19)} UTC`);

  return lines.join("\n");
}

// ============================================================================
// Handler principal
// ============================================================================

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (!SUPABASE_URL || !SERVICE_ROLE_KEY || !OPS_SECRET) {
    return json({ error: "SERVER_CONFIG_MISSING" }, 500);
  }

  const providedSecret = req.headers.get("x-ops-secret");
  if (providedSecret !== OPS_SECRET) {
    return json({ error: "UNAUTHORIZED" }, 401);
  }

  const url = new URL(req.url);
  const mode = url.searchParams.get("mode") ?? "check";

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  try {
    const [db, business, users, payments, errors] = await Promise.all([
      collectDbMetrics(admin),
      collectBusinessMetrics(admin),
      collectUserMetrics(admin),
      collectPaymentMetrics(admin),
      collectErrorMetrics(admin)
    ]);

    const health = evaluateHealth(db, business, payments, errors);

    if (mode === "daily") {
      const summary = formatDailySummary(db, business, users, payments, errors);
      await notify(summary);
      return json({
        ok: true,
        mode: "daily",
        health: health.overall_status,
        metrics: { db, business, users, payments, errors }
      });
    }

    // mode === "check"
    if (health.alerts.length > 0) {
      const alertMessage = formatAlertMessage(health, db, business, users, payments, errors);
      await notify(alertMessage);
    }

    return json({
      ok: true,
      mode: "check",
      health: health.overall_status,
      alertsFound: health.alerts.length,
      metrics: { db, business, users, payments, errors }
    });
  } catch (error) {
    console.error("OPS_MONITOR_FAILED", String(error));
    const errorMessage = `🔴 **VIMDY — Error en monitoreo**\n\nNo se pudieron recolectar métricas: ${error instanceof Error ? error.message : String(error)}`;
    await notify(errorMessage);
    return json({ error: "MONITOR_FAILED", detail: String(error) }, 500);
  }
});
