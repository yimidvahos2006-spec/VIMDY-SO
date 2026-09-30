import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type, x-daily-report-secret",
};

const MAX_ATTEMPTS = 8;
const RETRY_DELAYS_SECONDS = [30, 120, 600, 1800, 3600, 21600, 43200, 86400];
const PAGE_SIZE = 1000;

const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const WORKER_SECRET = Deno.env.get("DAILY_REPORT_WORKER_SECRET");
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
const RESEND_FROM = Deno.env.get("RESEND_FROM");
const WHATSAPP_ACCESS_TOKEN = Deno.env.get("WHATSAPP_ACCESS_TOKEN");
const WHATSAPP_PHONE_NUMBER_ID = Deno.env.get("WHATSAPP_PHONE_NUMBER_ID");
const WHATSAPP_GRAPH_VERSION = Deno.env.get("WHATSAPP_GRAPH_VERSION");
const WHATSAPP_TEMPLATE_NAME = Deno.env.get("WHATSAPP_DAILY_REPORT_TEMPLATE");
const WHATSAPP_TEMPLATE_MODE = (Deno.env.get("WHATSAPP_DAILY_REPORT_TEMPLATE_MODE") ?? "FULL_REPORT").toUpperCase();
const WHATSAPP_TEMPLATE_LANGUAGE = Deno.env.get("WHATSAPP_DAILY_REPORT_LANGUAGE") ?? "es_CO";
const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY");
const ANTHROPIC_MODEL = Deno.env.get("DAILY_REPORT_AI_MODEL") ?? "claude-sonnet-5";

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) throw new Error("SERVER_CONFIG_MISSING");
const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

type JobRow = {
  id: string;
  business_id: string;
  branch_id: string;
  shift_id: string;
  status: string;
  business_date: string;
  opened_at: string;
  closed_at: string;
  data_cutoff_at: string;
  cash_expected: number;
  cash_counted: number;
  cash_difference: number;
  attempts: number;
  report_text: string | null;
  snapshot: Record<string, unknown> | null;
};

type SettingsRow = {
  enabled: boolean;
  send_on_shift_close: boolean;
  whatsapp_enabled: boolean;
  whatsapp_recipients: string[];
  email_enabled: boolean;
  email_recipients: string[];
  email_fallback_enabled: boolean;
};

type DeliveryRow = {
  id: string;
  job_id: string;
  business_id: string;
  channel: "WHATSAPP" | "EMAIL";
  recipient: string;
  status: string;
  attempts: number;
};

type SaleRow = { id: string; data: Record<string, unknown>; created_at: string; updated_at: string };
type ProductRow = { id: string; data: Record<string, unknown> };

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function num(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function parseDate(value: unknown): Date | null {
  const parsed = new Date(String(value ?? ""));
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function isValidSaleStatus(status: unknown): boolean {
  return status === "PAID" || status === "CLOSED" || status === "COMPLETED" || status === "PARTIALLY_REFUNDED";
}

function netSale(data: Record<string, unknown>) {
  if (!isValidSaleStatus(data.status)) return { gross: 0, refunded: 0, net: 0 };
  const gross = Math.max(num(data.total), 0);
  const refunds = Array.isArray(data.refunds) ? data.refunds : [];
  const refunded = Math.max(refunds.reduce((sum, item) => sum + num((item as Record<string, unknown>).amount), 0), 0);
  return { gross, refunded, net: Math.max(gross - refunded, 0) };
}

function formatMoney(value: number, currency: string, locale = "es-CO") {
  try {
    return new Intl.NumberFormat(locale, { style: "currency", currency, maximumFractionDigits: 0 }).format(value);
  } catch {
    return `${currency} ${Math.round(value).toLocaleString(locale)}`;
  }
}

function retryAt(attempts: number): string {
  const index = Math.min(Math.max(attempts - 1, 0), RETRY_DELAYS_SECONDS.length - 1);
  return new Date(Date.now() + RETRY_DELAYS_SECONDS[index] * 1000).toISOString();
}

function localDateParts(date: Date, timeZone: string) {
  const values = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" })
      .formatToParts(date)
      .map((part) => [part.type, part.value]),
  );
  return { year: Number(values.year), month: Number(values.month), day: Number(values.day) };
}

function offsetMillis(date: Date, timeZone: string): number {
  const zone = new Intl.DateTimeFormat("en-US", {
    timeZone,
    timeZoneName: "longOffset",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(date).find((part) => part.type === "timeZoneName")?.value ?? "GMT";
  if (zone === "GMT" || zone === "UTC") return 0;
  const match = /^GMT([+-])(\d{2}):(\d{2})$/.exec(zone);
  if (!match) return 0;
  const sign = match[1] === "-" ? -1 : 1;
  return sign * ((Number(match[2]) * 60 + Number(match[3])) * 60_000);
}

function nextCalendarDay(year: number, month: number, day: number) {
  const d = new Date(Date.UTC(year, month - 1, day) + 86_400_000);
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() };
}

function zonedMidnightUtc(year: number, month: number, day: number, timeZone: string): Date {
  const base = Date.UTC(year, month - 1, day);
  let candidate = new Date(base);
  for (let i = 0; i < 3; i += 1) candidate = new Date(base - offsetMillis(candidate, timeZone));
  return candidate;
}

function businessDayRange(closedAt: Date, timeZone: string) {
  const local = localDateParts(closedAt, timeZone);
  const next = nextCalendarDay(local.year, local.month, local.day);
  return {
    start: zonedMidnightUtc(local.year, local.month, local.day, timeZone),
    end: zonedMidnightUtc(next.year, next.month, next.day, timeZone),
  };
}

async function readSales(
  businessId: string,
  branchId: string | null,
  startIso: string,
  endIso: string,
  updatedWindow = false,
  shiftId?: string,
): Promise<SaleRow[]> {
  const result: SaleRow[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    let query = admin
      .from("sales")
      .select("id,data,created_at,updated_at")
      .eq("business_id", businessId);

    if (branchId) query = query.eq("branch_id", branchId);

    // Un reporte nacido del cierre de una caja debe incluir SOLO las ventas
    // cobradas en ese turno. Las ventas pagadas por VIMDY llevan shiftId y
    // cashRegisterId en `data` desde register_sale_payment_atomic().
    if (shiftId) {
      query = query.eq("data->>shiftId", shiftId);
    }

    query = query.order(updatedWindow ? "updated_at" : "created_at", { ascending: true });
    query = updatedWindow
      ? query.gte("updated_at", startIso).lt("updated_at", endIso)
      : query.gte("created_at", startIso).lt("created_at", endIso);

    const { data, error } = await query.range(from, from + PAGE_SIZE - 1);
    if (error) throw new Error(`SALES_READ_FAILED: ${error.message}`);
    const page = (data ?? []) as SaleRow[];
    result.push(...page);
    if (page.length < PAGE_SIZE) return result;
  }
}

async function getSettings(businessId: string): Promise<SettingsRow> {
  const { data, error } = await admin
    .from("daily_report_settings")
    .select("enabled,send_on_shift_close,whatsapp_enabled,whatsapp_recipients,email_enabled,email_recipients,email_fallback_enabled")
    .eq("business_id", businessId)
    .maybeSingle();
  if (error) throw new Error(`REPORT_SETTINGS_READ_FAILED: ${error.message}`);
  return {
    enabled: true,
    send_on_shift_close: true,
    whatsapp_enabled: false,
    whatsapp_recipients: [],
    email_enabled: true,
    email_recipients: [],
    email_fallback_enabled: true,
    ...(data ?? {}),
  } as SettingsRow;
}

async function getAdminEmails(businessId: string): Promise<string[]> {
  const { data, error } = await admin.from("business_members").select("user_id,role").eq("business_id", businessId).in("role", ["ADMIN", "GERENTE"]);
  if (error) throw new Error(`MEMBERS_READ_FAILED: ${error.message}`);
  const emails = new Set<string>();
  for (const member of data ?? []) {
    const user = await admin.auth.admin.getUserById(String(member.user_id));
    const email = user.data.user?.email?.trim().toLowerCase();
    if (email) emails.add(email);
  }
  return [...emails];
}

function netItems(data: Record<string, unknown>) {
  const rawItems = Array.isArray(data.items) ? data.items : [];
  const refundedByProduct = new Map<string, number>();
  for (const rawRefund of Array.isArray(data.refunds) ? data.refunds : []) {
    const refund = rawRefund as Record<string, unknown>;
    for (const rawItem of Array.isArray(refund.items) ? refund.items : []) {
      const item = rawItem as Record<string, unknown>;
      const productId = String(item.productId ?? "");
      if (!productId) continue;
      refundedByProduct.set(productId, (refundedByProduct.get(productId) ?? 0) + Math.max(num(item.quantity), 0));
    }
  }

  return rawItems
    .map((rawItem) => rawItem as Record<string, unknown>)
    .map((item) => {
      const productId = String(item.productId ?? "");
      const quantity = Math.max(num(item.quantity), 0);
      const refunded = refundedByProduct.get(productId) ?? 0;
      const netQuantity = Math.max(quantity - refunded, 0);
      return {
        productId,
        quantity: netQuantity,
        price: Math.max(num(item.price), 0),
        unitCostAtSale: item.unitCostAtSale == null ? null : num(item.unitCostAtSale),
        costReliable: item.costUnreliableAtSale !== true && item.unitCostAtSale != null,
      };
    })
    .filter((item) => item.productId && item.quantity > 0);
}

function normalizeProductName(value: unknown, fallback: string) {
  const name = String(value ?? "").trim();
  return name || fallback;
}

function deterministicAiSummary(snapshot: Record<string, unknown>): string {
  const sales = num(snapshot.salesNetToday ?? snapshot.salesNet);
  const lowStock = num(snapshot.lowStockCount);
  const cashDiff = num(snapshot.cashDifference);
  const waste = num(snapshot.wasteToday);
  const top = Array.isArray(snapshot.topProducts) ? snapshot.topProducts[0] as Record<string, unknown> | undefined : undefined;
  const lines: string[] = [];

  if (cashDiff < 0) lines.push(`La caja quedó ${formatMoney(Math.abs(cashDiff), String(snapshot.currency ?? "COP"))} por debajo de lo esperado.`);
  else if (cashDiff > 0) lines.push(`La caja quedó ${formatMoney(cashDiff, String(snapshot.currency ?? "COP"))} por encima de lo esperado.`);

  if (waste > 0) lines.push(`La merma registrada fue ${formatMoney(waste, String(snapshot.currency ?? "COP"))}.`);
  else if (lowStock > 0) lines.push(`Hay ${lowStock} producto${lowStock === 1 ? "" : "s"} con stock bajo.`);
  else if (top?.name) lines.push(`${String(top.name)} fue el producto más vendido con ${num(top.quantity)} unidades.`);
  else lines.push(`El negocio cerró con ${formatMoney(sales, String(snapshot.currency ?? "COP"))} en ventas.`);

  return lines.join(" ").slice(0, 420);
}

async function generateAiSummary(snapshot: Record<string, unknown>): Promise<string> {
  if (!ANTHROPIC_API_KEY) return deterministicAiSummary(snapshot);

  const facts = {
    negocio: snapshot.businessName,
    sucursal: snapshot.branchName,
    fecha: snapshot.businessDate,
    ventas_hoy: snapshot.salesNetToday,
    ganancia_estimada_hoy: snapshot.profitToday,
    pedidos_hoy: snapshot.transactionCountToday,
    caja_contada: snapshot.cashCounted,
    caja_esperada: snapshot.cashExpected,
    diferencia_caja: snapshot.cashDifference,
    merma_hoy: snapshot.wasteToday,
    productos_vendidos_distintos: snapshot.distinctProductsSold,
    mas_vendidos: snapshot.topProducts,
    stock_bajo: snapshot.lowStockCount,
    reembolsos_hoy: snapshot.refundsProcessedToday,
  };

  const prompt = [
    "Escribe un mensaje muy corto para el dueño de un restaurante que acaba de cerrar el turno.",
    "Usa SOLO los datos entregados. No inventes causas, porcentajes ni cifras.",
    "Máximo 2 frases, máximo 320 caracteres. Tono profesional, claro y útil.",
    "Menciona primero el hecho más importante del día. Si hay diferencia negativa de caja, merma o stock bajo, priorízalo; si no, destaca ventas/ganancia y el producto más vendido.",
    "No uses encabezados ni listas. No digas que eres una IA.",
    `DATOS: ${JSON.stringify(facts)}`,
  ].join("\n");

  try {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: ANTHROPIC_MODEL,
        max_tokens: 180,
        system: "Eres VIMDY, un analista operativo de restaurantes. Sé preciso y breve.",
        messages: [{ role: "user", content: prompt }],
      }),
    });

    if (!response.ok) return deterministicAiSummary(snapshot);
    const data = await response.json();
    const reply = (data.content ?? [])
      .filter((block: { type?: string }) => block.type === "text")
      .map((block: { text?: string }) => String(block.text ?? ""))
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();

    return (reply || deterministicAiSummary(snapshot)).slice(0, 420);
  } catch {
    return deterministicAiSummary(snapshot);
  }
}

async function buildSnapshot(job: JobRow): Promise<Record<string, unknown>> {
  const { data: business, error: businessError } = await admin.from("businesses").select("name,timezone,currency").eq("id", job.business_id).single();
  if (businessError || !business) throw new Error(`BUSINESS_READ_FAILED: ${businessError?.message ?? "not found"}`);
  const { data: branch, error: branchError } = await admin.from("branches").select("name").eq("id", job.branch_id).eq("business_id", job.business_id).maybeSingle();
  if (branchError) throw new Error(`BRANCH_READ_FAILED: ${branchError.message}`);

  const timezone = String((business as { timezone?: string }).timezone ?? "UTC");
  const currency = String((business as { currency?: string }).currency ?? "COP");
  const closedAt = parseDate(job.closed_at);
  const openedAt = parseDate(job.opened_at);
  if (!closedAt || !openedAt) throw new Error("INVALID_SHIFT_DATES");

  const range = businessDayRange(closedAt, timezone);
  const shiftStartIso = openedAt.toISOString();
  const shiftEndIso = closedAt.toISOString();
  const dayStartIso = range.start.toISOString();
  const dayEndIso = range.end.toISOString();

  const shiftSales = await readSales(job.business_id, job.branch_id, shiftStartIso, shiftEndIso, false, job.shift_id);
  let salesGross = 0;
  let salesNet = 0;
  let transactionCount = 0;
  const paymentTotals: Record<string, number> = {};
  for (const sale of shiftSales) {
    const net = netSale(sale.data ?? {});
    salesGross += net.gross;
    salesNet += net.net;
    if (net.net > 0) transactionCount += 1;
    const method = String(sale.data?.paymentMethod ?? "CASH");
    paymentTotals[method] = (paymentTotals[method] ?? 0) + net.net;
  }

  // Reembolsos procesados durante el día pueden pertenecer a una venta de
  // una fecha anterior; por eso se consulta por updated_at además del turno.
  const updatedSales = await readSales(job.business_id, null, dayStartIso, dayEndIso, true);
  let refundsProcessedToday = 0;
  for (const sale of updatedSales) {
    for (const item of Array.isArray(sale.data?.refunds) ? sale.data.refunds : []) {
      const refund = item as Record<string, unknown>;
      const createdAt = parseDate(refund.createdAt);
      if (createdAt && createdAt >= range.start && createdAt < range.end) refundsProcessedToday += Math.max(num(refund.amount), 0);
    }
  }

  const { data: products, error: productError } = await admin.from("products").select("id,data").eq("business_id", job.business_id).limit(10000);
  if (productError) throw new Error(`PRODUCTS_READ_FAILED: ${productError.message}`);
  const productMap = new Map<string, Record<string, unknown>>();
  for (const row of (products ?? []) as ProductRow[]) productMap.set(row.id, row.data ?? {});

  let lowStockCount = 0;
  let inventoryCostValue = 0;
  let valuationComplete = true;
  for (const [, product] of productMap) {
    if (product.isActive === false) continue;
    const stock = num(product.stock);
    const minimum = num(product.minStock);
    if (product.trackStock === true && stock <= minimum) lowStockCount += 1;
    if (product.trackStock === true && stock > 0) {
      if (Number.isFinite(Number(product.purchasePrice))) inventoryCostValue += stock * num(product.purchasePrice);
      else valuationComplete = false;
    }
  }

  const dailySales = await readSales(job.business_id, null, dayStartIso, dayEndIso, false);
  let salesNetToday = 0;
  let transactionCountToday = 0;
  let knownProfitToday = 0;
  let profitCostCoverageComplete = true;
  const topProductMap = new Map<string, { quantity: number; revenue: number }>();
  const dailyPaymentTotals: Record<string, number> = {};
  let wasteToday = 0;

  for (const sale of dailySales) {
    const net = netSale(sale.data ?? {});
    salesNetToday += net.net;
    if (net.net > 0) transactionCountToday += 1;
    const method = String(sale.data?.paymentMethod ?? "CASH");
    dailyPaymentTotals[method] = (dailyPaymentTotals[method] ?? 0) + net.net;

    for (const item of netItems(sale.data ?? {})) {
      const current = topProductMap.get(item.productId) ?? { quantity: 0, revenue: 0 };
      current.quantity += item.quantity;
      current.revenue += item.price * item.quantity;
      topProductMap.set(item.productId, current);
      if (item.costReliable) knownProfitToday += (item.price - num(item.unitCostAtSale)) * item.quantity;
      else profitCostCoverageComplete = false;
    }
  }

  const { data: wasteRows, error: wasteError } = await admin
    .from("inventory_movements")
    .select("data")
    .eq("business_id", job.business_id)
    .eq("branch_id", job.branch_id)
    .eq("movement_type", "DECREASE")
    .gte("movement_date", dayStartIso)
    .lt("movement_date", dayEndIso)
    .limit(10000);
  if (!wasteError) {
    for (const row of wasteRows ?? []) {
      const movement = (row as { data?: Record<string, unknown> }).data ?? {};
      const lossCategory = String(movement.lossCategory ?? "").toUpperCase();
      if (lossCategory === "MERMA") {
        const product = productMap.get(String(movement.productId ?? ""));
        const quantity = Math.max(num(movement.quantity), 0);
        const unitCost = Number.isFinite(Number(product?.purchasePrice)) ? num(product?.purchasePrice) : 0;
        wasteToday += Math.max(num(movement.totalCost ?? movement.cost ?? movement.value ?? movement.amount), quantity * unitCost);
      }
    }
  }

  const topProducts = [...topProductMap.entries()]
    .sort((a, b) => b[1].quantity - a[1].quantity)
    .slice(0, 5)
    .map(([productId, stats]) => ({
      productId,
      name: normalizeProductName(productMap.get(productId)?.name, `Producto ${productId.slice(0, 6)}`),
      quantity: Math.round(stats.quantity * 100) / 100,
      revenue: Math.round(stats.revenue),
    }));

  const { count: pendingSyncCount } = await admin
    .from("pending_sales")
    .select("id", { count: "exact", head: true })
    .eq("business_id", job.business_id)
    .eq("branch_id", job.branch_id)
    .eq("synced", false);

  const profitToday = profitCostCoverageComplete ? knownProfitToday : null;
  const snapshot = {
    businessId: job.business_id,
    branchId: job.branch_id,
    businessName: String((business as { name?: string }).name ?? "VIMDY"),
    branchName: String((branch as { name?: string } | null)?.name ?? "Sucursal"),
    businessDate: job.business_date,
    timezone,
    currency,
    openedAt: job.opened_at,
    closedAt: job.closed_at,
    reportScope: "BUSINESS_DAY_PLUS_SHIFT_CASH",
    salesScopeShiftId: job.shift_id,
    salesGross,
    refundsProcessedToday,
    salesNet,
    transactionCount,
    averageSale: transactionCount > 0 ? salesNet / transactionCount : null,
    cashExpected: num(job.cash_expected),
    cashCounted: num(job.cash_counted),
    cashDifference: num(job.cash_difference),
    paymentTotals,
    salesNetToday,
    transactionCountToday,
    averageSaleToday: transactionCountToday > 0 ? salesNetToday / transactionCountToday : null,
    dailyPaymentTotals,
    profitToday,
    profitCostCoverageComplete,
    topProducts,
    distinctProductsSold: topProductMap.size,
    wasteToday,
    lowStockCount,
    inventoryCostValue: valuationComplete ? inventoryCostValue : null,
    inventoryValuationComplete: valuationComplete,
    pendingSyncCount: pendingSyncCount ?? 0,
    inventoryObservedAt: new Date().toISOString(),
    aiSummary: "",
  };

  snapshot.aiSummary = await generateAiSummary(snapshot);
  return snapshot;
}

function reportText(snapshot: Record<string, unknown>): string {
  const currency = String(snapshot.currency ?? "COP");
  const money = (value: unknown) => formatMoney(num(value), currency);
  const topProducts = Array.isArray(snapshot.topProducts) ? snapshot.topProducts as Array<Record<string, unknown>> : [];
  const topLines = topProducts.length
    ? topProducts.map((product, index) => `${index + 1}. ${String(product.name)} — ${num(product.quantity)} uds.`).join("\n")
    : "Sin productos vendidos";
  const profitLine = snapshot.profitToday == null
    ? "📈 Ganancia estimada: no disponible (faltan costos históricos completos)"
    : `📈 Ganancia estimada: ${money(snapshot.profitToday)}`;
  const cashDiff = num(snapshot.cashDifference);
  const cashLine = cashDiff === 0
    ? "✅ Caja cuadrada"
    : `${cashDiff < 0 ? "🔴" : "🟢"} Diferencia de caja: ${money(cashDiff)}`;
  const syncLine = num(snapshot.pendingSyncCount) > 0 ? `⚠️ Pendientes offline: ${num(snapshot.pendingSyncCount)}` : "✅ Sin ventas offline pendientes";

  return [
    "📊 VIMDY — Cierre del turno",
    `${snapshot.businessName} · ${snapshot.branchName}`,
    `📅 ${snapshot.businessDate}`,
    "",
    `💰 Ventas del negocio hoy: ${money(snapshot.salesNetToday)}`,
    profitLine,
    `🧾 Pedidos: ${num(snapshot.transactionCountToday)}`,
    `💵 Caja de esta sucursal: ${money(snapshot.cashCounted)}`,
    `Esperado: ${money(snapshot.cashExpected)}`,
    cashLine,
    "",
    "🏆 Productos más vendidos",
    topLines,
    `📦 Productos distintos vendidos: ${num(snapshot.distinctProductsSold)}`,
    `🗑️ Merma registrada: ${money(snapshot.wasteToday)}`,
    `↩️ Reembolsos del día: ${money(snapshot.refundsProcessedToday)}`,
    `📉 Stock bajo: ${num(snapshot.lowStockCount)}`,
    syncLine,
    "",
    `🤖 VIMDY IA: ${String(snapshot.aiSummary ?? "").trim()}`,
  ].join("\n");
}

async function ensureDeliveries(job: JobRow, settings: SettingsRow): Promise<void> {
  const { data: existing, error } = await admin.from("daily_report_deliveries").select("id,channel,recipient,status").eq("job_id", job.id);
  if (error) throw new Error(`DELIVERIES_READ_FAILED: ${error.message}`);
  const existingKeys = new Set((existing ?? []).map((row) => `${row.channel}:${row.recipient}`));
  const inserts: Record<string, unknown>[] = [];

  if (settings.whatsapp_enabled) {
    for (const raw of settings.whatsapp_recipients ?? []) {
      const recipient = raw.replace(/\D/g, "");
      if (/^\d{10,15}$/.test(recipient) && !existingKeys.has(`WHATSAPP:${recipient}`)) {
        inserts.push({ job_id: job.id, business_id: job.business_id, channel: "WHATSAPP", recipient, status: "PENDING" });
      }
    }
  }

  if (settings.email_enabled) {
    const recipients = settings.email_recipients?.length ? settings.email_recipients : await getAdminEmails(job.business_id);
    for (const raw of recipients) {
      const recipient = raw.trim().toLowerCase();
      if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipient) && !existingKeys.has(`EMAIL:${recipient}`)) {
        inserts.push({ job_id: job.id, business_id: job.business_id, channel: "EMAIL", recipient, status: "PENDING" });
      }
    }
  }

  // Si un canal estaba esperando configuración y ahora sí existe, se reactiva.
  if (settings.whatsapp_enabled && WHATSAPP_ACCESS_TOKEN && WHATSAPP_PHONE_NUMBER_ID && WHATSAPP_GRAPH_VERSION && WHATSAPP_TEMPLATE_NAME) {
    await admin.from("daily_report_deliveries").update({ status: "PENDING", last_error: null, next_attempt_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq("job_id", job.id).eq("channel", "WHATSAPP").eq("status", "WAITING_CONFIGURATION");
  }
  if (settings.email_enabled && RESEND_API_KEY) {
    await admin.from("daily_report_deliveries").update({ status: "PENDING", last_error: null, next_attempt_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq("job_id", job.id).eq("channel", "EMAIL").eq("status", "WAITING_CONFIGURATION");
  }

  if (inserts.length) {
    const { error: insertError } = await admin.from("daily_report_deliveries").insert(inserts);
    if (insertError && !insertError.message.toLowerCase().includes("duplicate")) throw new Error(`DELIVERIES_CREATE_FAILED: ${insertError.message}`);
  }
}

async function sendEmail(recipient: string, subject: string, text: string): Promise<string | null> {
  if (!RESEND_API_KEY || !RESEND_FROM) {
    throw Object.assign(new Error("RESEND_NOT_CONFIGURED"), { code: "CONFIG" });
  }
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: RESEND_FROM, to: [recipient], subject, text }),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw Object.assign(new Error(`RESEND_HTTP_${response.status}: ${String((body as Record<string, unknown>).message ?? "send failed")}`), { code: response.status === 429 || response.status >= 500 ? "RETRY" : "FAILED" });
  }
  return String((body as Record<string, unknown>).id ?? "") || null;
}

async function sendWhatsApp(recipient: string, snapshot: Record<string, unknown>, reportTextValue: string): Promise<string> {
  if (!WHATSAPP_ACCESS_TOKEN || !WHATSAPP_PHONE_NUMBER_ID || !WHATSAPP_GRAPH_VERSION || !WHATSAPP_TEMPLATE_NAME) {
    throw Object.assign(new Error("WHATSAPP_NOT_CONFIGURED"), { code: "CONFIG" });
  }
  const currency = String(snapshot.currency ?? "COP");
  const legacyParameters = [
    String(snapshot.businessName),
    String(snapshot.businessDate),
    formatMoney(num(snapshot.salesNetToday), currency),
    String(num(snapshot.transactionCountToday)),
    snapshot.averageSaleToday == null ? "—" : formatMoney(num(snapshot.averageSaleToday), currency),
    formatMoney(num(snapshot.cashDifference), currency),
    String(num(snapshot.lowStockCount)),
  ];
  const parameters = WHATSAPP_TEMPLATE_MODE === "FULL_REPORT"
    ? [reportTextValue.slice(0, 900)]
    : legacyParameters;
  const response = await fetch(`https://graph.facebook.com/${WHATSAPP_GRAPH_VERSION}/${WHATSAPP_PHONE_NUMBER_ID}/messages`, {
    method: "POST",
    headers: { Authorization: `Bearer ${WHATSAPP_ACCESS_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: recipient,
      type: "template",
      template: {
        name: WHATSAPP_TEMPLATE_NAME,
        language: { code: WHATSAPP_TEMPLATE_LANGUAGE },
        components: [{ type: "body", parameters: parameters.map((text) => ({ type: "text", text })) }],
      },
    }),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw Object.assign(new Error(`WHATSAPP_HTTP_${response.status}: ${String(((body as { error?: { message?: unknown } }).error?.message) ?? "send failed")}`), { code: response.status === 429 || response.status >= 500 ? "RETRY" : "FAILED" });
  }
  const messageId = String((body as { messages?: Array<{ id?: string }> }).messages?.[0]?.id ?? "");
  if (!messageId) throw new Error("WHATSAPP_NO_MESSAGE_ID");
  return messageId;
}

async function ensureEmailFallback(jobId: string, businessId: string, settings: SettingsRow): Promise<void> {
  if (!settings.email_fallback_enabled || !settings.email_enabled) return;
  const emails = settings.email_recipients?.length ? settings.email_recipients : await getAdminEmails(businessId);
  for (const raw of emails) {
    const recipient = raw.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipient)) continue;
    const { error } = await admin.from("daily_report_deliveries").upsert(
      { job_id: jobId, business_id: businessId, channel: "EMAIL", recipient, status: "PENDING", next_attempt_at: new Date().toISOString() },
      { onConflict: "job_id,channel,recipient", ignoreDuplicates: true },
    );
    if (error) throw new Error(`EMAIL_FALLBACK_CREATE_FAILED: ${error.message}`);
  }
}

async function processDelivery(delivery: DeliveryRow, snapshot: Record<string, unknown>, subject: string, text: string, settings: SettingsRow) {
  try {
    const providerId = delivery.channel === "EMAIL" ? await sendEmail(delivery.recipient, subject, text) : await sendWhatsApp(delivery.recipient, snapshot, text);
    await admin.from("daily_report_deliveries").update({ status: "SENT", provider_message_id: providerId, sent_at: new Date().toISOString(), locked_until: null, last_error: null, updated_at: new Date().toISOString() }).eq("id", delivery.id);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const code = String((error as { code?: string }).code ?? "");
    if (code === "CONFIG") {
      await admin.from("daily_report_deliveries").update({ status: "WAITING_CONFIGURATION", locked_until: null, last_error: message, updated_at: new Date().toISOString() }).eq("id", delivery.id);
      if (delivery.channel === "WHATSAPP") await ensureEmailFallback(delivery.job_id, String(snapshot.businessId), settings);
      return;
    }
    const failedPermanently = delivery.attempts >= MAX_ATTEMPTS || code === "FAILED";
    await admin.from("daily_report_deliveries").update({ status: failedPermanently ? "FAILED" : "RETRY", next_attempt_at: failedPermanently ? new Date().toISOString() : retryAt(delivery.attempts), locked_until: null, last_error: message.slice(0, 1000), updated_at: new Date().toISOString() }).eq("id", delivery.id);
    if (delivery.channel === "WHATSAPP" && failedPermanently) await ensureEmailFallback(delivery.job_id, String(snapshot.businessId), settings);
  }
}

async function finalizeJob(jobId: string) {
  const { data, error } = await admin.from("daily_report_deliveries").select("status").eq("job_id", jobId);
  if (error) throw new Error(`DELIVERY_STATUS_READ_FAILED: ${error.message}`);
  const statuses = (data ?? []).map((row) => String(row.status));
  if (!statuses.length) {
    await admin.from("daily_report_jobs").update({ status: "WAITING_CONFIGURATION", locked_until: null, last_error: "No hay canales de entrega configurados.", updated_at: new Date().toISOString() }).eq("id", jobId);
    return;
  }
  const completed = statuses.every((status) => ["SENT", "DELIVERED", "READ"].includes(status));
  const anyCompleted = statuses.some((status) => ["SENT", "DELIVERED", "READ"].includes(status));
  const anyWaiting = statuses.some((status) => status === "WAITING_CONFIGURATION");
  const allFailed = statuses.every((status) => status === "FAILED");
  const jobStatus = completed ? "COMPLETED" : anyCompleted ? "PARTIAL" : anyWaiting ? "WAITING_CONFIGURATION" : allFailed ? "FAILED" : "PROCESSING";
  const nextAttemptAt = jobStatus === "WAITING_CONFIGURATION"
    ? new Date(Date.now() + 10 * 60_000).toISOString()
    : jobStatus === "PARTIAL"
      ? new Date(Date.now() + 60_000).toISOString()
      : new Date().toISOString();
  await admin.from("daily_report_jobs").update({
    status: jobStatus,
    locked_until: null,
    next_attempt_at: nextAttemptAt,
    completed_at: jobStatus === "COMPLETED" ? new Date().toISOString() : null,
    updated_at: new Date().toISOString(),
  }).eq("id", jobId);
}

async function authorize(req: Request, body: Record<string, unknown>, shiftId: string | null) {
  if (WORKER_SECRET && req.headers.get("x-daily-report-secret") === WORKER_SECRET) return { worker: true, userId: null };
  const businessId = body.businessId ? String(body.businessId) : null;
  if (!businessId) throw new Response(JSON.stringify({ error: "BUSINESS_ID_REQUIRED" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  const authorization = req.headers.get("Authorization");
  const token = authorization?.startsWith("Bearer ") ? authorization.slice(7) : null;
  if (!token) throw new Response(JSON.stringify({ error: "UNAUTHORIZED" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  const { data: userData, error } = await admin.auth.getUser(token);
  if (error || !userData.user) throw new Response(JSON.stringify({ error: "UNAUTHORIZED" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  const { data: membership, error: membershipError } = await admin
    .from("business_members")
    .select("user_id,role")
    .eq("business_id", businessId)
    .eq("user_id", userData.user.id)
    .maybeSingle();
  if (membershipError || !membership) {
    throw new Response(JSON.stringify({ error: "FORBIDDEN" }), { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }

  const role = String((membership as { role?: unknown }).role ?? "");
  if (shiftId) {
    const { data: shift, error: shiftError } = await admin
      .from("shifts")
      .select("id,business_id,branch_id,data")
      .eq("id", shiftId)
      .eq("business_id", businessId)
      .maybeSingle();
    if (shiftError || !shift) {
      throw new Response(JSON.stringify({ error: "SHIFT_NOT_FOUND" }), { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    const shiftData = (shift as { data?: Record<string, unknown> }).data ?? {};
    const shiftStatus = String(shiftData.status ?? "");
    const closedBy = String(shiftData.closedBy ?? "");
    const allowedForShift = role === "ADMIN" || role === "GERENTE" || (role === "CAJERO" && closedBy === userData.user.id);
    if (shiftStatus !== "CLOSED" || !allowedForShift) {
      throw new Response(JSON.stringify({ error: "FORBIDDEN" }), { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
  } else if (!["ADMIN", "GERENTE"].includes(role)) {
    throw new Response(JSON.stringify({ error: "FORBIDDEN" }), { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }

  return { worker: false, userId: userData.user.id };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const body = req.method === "POST" ? await req.json().catch(() => ({})) as Record<string, unknown> : {};
    const shiftId = body.shiftId ? String(body.shiftId) : null;
    const auth = await authorize(req, body, shiftId);
    const businessId = body.businessId ? String(body.businessId) : null;

    if (String(body.action ?? "").toUpperCase() === "TEST_EMAIL") {
      if (auth.worker) throw new Response(JSON.stringify({ error: "FORBIDDEN" }), { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      const recipient = String(body.recipient ?? "").trim().toLowerCase();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipient)) {
        return json({ error: "INVALID_EMAIL" }, 400);
      }
      const subject = "VIMDY — Correo de prueba del Cierre Inteligente";
      const text = [
        "Hola,",
        "",
        "Este es un correo de prueba de VIMDY.",
        "",
        "El correo está correctamente configurado para recibir los cierres diarios de tu negocio.",
        "",
        "Cuando cierres un turno, VIMDY preparará el resumen del día y lo enviará automáticamente a este correo.",
        "",
        "— VIMDY",
      ].join("\n");
      const providerId = await sendEmail(recipient, subject, text);
      return json({ ok: true, recipient, providerId });
    }

    const branchId = body.branchId ? String(body.branchId) : null;
    const limit = Math.max(1, Math.min(Number(body.limit ?? 5), 10));

    const { data: jobs, error: claimError } = await admin.rpc("claim_daily_report_jobs", {
      p_business_id: businessId,
      p_branch_id: branchId,
      p_shift_id: shiftId,
      p_limit: limit,
    });
    if (claimError) throw new Error(`JOB_CLAIM_FAILED: ${claimError.message}`);

    const results: Array<Record<string, unknown>> = [];
    for (const job of (jobs ?? []) as JobRow[]) {
      try {
        const settings = await getSettings(job.business_id);
        if (!settings.enabled || !settings.send_on_shift_close) {
          await admin.from("daily_report_jobs").update({ status: "SKIPPED", locked_until: null, last_error: null, updated_at: new Date().toISOString() }).eq("id", job.id);
          results.push({ jobId: job.id, status: "SKIPPED" });
          continue;
        }
        const snapshot = job.snapshot ?? await buildSnapshot(job);
        const text = job.report_text ?? reportText(snapshot);
        await admin.from("daily_report_jobs").update({ snapshot, report_text: text, last_error: null, updated_at: new Date().toISOString() }).eq("id", job.id);
        await ensureDeliveries(job, settings);
        const { data: deliveries, error: deliveryClaimError } = await admin.rpc("claim_daily_report_deliveries", { p_job_id: job.id, p_limit: 20 });
        if (deliveryClaimError) throw new Error(`DELIVERY_CLAIM_FAILED: ${deliveryClaimError.message}`);
        const subject = `VIMDY — Cierre del día ${String(snapshot.businessName)} · ${String(snapshot.businessDate)}`;
        for (const delivery of (deliveries ?? []) as DeliveryRow[]) await processDelivery(delivery, snapshot, subject, text, settings);
        await finalizeJob(job.id);
        results.push({ jobId: job.id, status: "PROCESSED" });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const failedPermanently = job.attempts >= MAX_ATTEMPTS;
        await admin.from("daily_report_jobs").update({ status: failedPermanently ? "FAILED" : "RETRY", next_attempt_at: failedPermanently ? new Date().toISOString() : retryAt(job.attempts), locked_until: null, last_error: message.slice(0, 1000), updated_at: new Date().toISOString() }).eq("id", job.id);
        results.push({ jobId: job.id, status: failedPermanently ? "FAILED" : "RETRY", error: message });
      }
    }
    return json({ ok: true, worker: auth.worker, processed: results });
  } catch (error) {
    if (error instanceof Response) return error;
    console.error("DAILY_REPORT_PROCESS_FAILED", String(error));
    return json({ error: error instanceof Error ? error.message : String(error) }, 500);
  }
});