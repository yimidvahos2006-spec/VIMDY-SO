// VIMDY — Supabase Edge Function: Factus API V2
// Secrets used only here: FACTUS_CLIENT_ID, FACTUS_CLIENT_SECRET,
// FACTUS_USERNAME, FACTUS_PASSWORD.
// Deploy: supabase functions deploy factus-invoice

import { createClient } from "npm:@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const FACTUS_CLIENT_ID = Deno.env.get("FACTUS_CLIENT_ID");
const FACTUS_CLIENT_SECRET = Deno.env.get("FACTUS_CLIENT_SECRET");
const FACTUS_USERNAME = Deno.env.get("FACTUS_USERNAME");
const FACTUS_PASSWORD = Deno.env.get("FACTUS_PASSWORD");
const FACTUS_ENV_RAW = Deno.env.get("FACTUS_ENV")?.trim().toLowerCase() || "sandbox";
const FACTUS_ENV = FACTUS_ENV_RAW === "production" ? "production" : "sandbox";
const FACTUS_BUCKET = Deno.env.get("FACTUS_STORAGE_BUCKET")?.trim() || "factus-invoices";
const FACTUS_SIGNED_URL_TTL = Math.min(604800, Math.max(300, Number(Deno.env.get("FACTUS_SIGNED_URL_TTL_SECONDS") || 3600)));
const FACTUS_SEND_EMAIL = Deno.env.get("FACTUS_SEND_EMAIL")?.trim().toLowerCase() === "true";
const FACTUS_CARD_METHOD_CODE = Deno.env.get("FACTUS_CARD_METHOD_CODE")?.trim() || "48";
const FACTUS_QR_METHOD_CODE = Deno.env.get("FACTUS_QR_METHOD_CODE")?.trim() || "1";
const FACTUS_MIXED_NON_CASH_METHOD_CODE = Deno.env.get("FACTUS_MIXED_NON_CASH_METHOD_CODE")?.trim() || "1";
const FACTUS_DELIVERY_TAX_RATE_RAW = Deno.env.get("FACTUS_DELIVERY_TAX_RATE")?.trim();
const FACTUS_DELIVERY_TAX_RATE = FACTUS_DELIVERY_TAX_RATE_RAW ? Number(FACTUS_DELIVERY_TAX_RATE_RAW) : null;
const FACTUS_TIMEOUT_MS = Math.min(30000, Math.max(5000, Number(Deno.env.get("FACTUS_HTTP_TIMEOUT_MS") || 15000)));
let cachedToken: { accessToken: string; expiresAt: number } | null = null;

type Json = Record<string, any>;

type InvoiceRequest = {
  saleId: string;
  businessId: string;
  provider: "factus" | "none";
  country: string;
  documentType: "INVOICE" | "CREDIT_NOTE" | "DEBIT_NOTE";
  customer: {
    documentType: "CC" | "CE" | "NIT" | "PASSPORT" | "OTHER";
    documentNumber: string;
    fullName: string;
    email?: string;
    phone?: string;
    address?: string;
  };
  items: Array<{
    productId: string;
    quantity: number;
    price: number;
    name?: string;
    note?: string;
    taxRate?: number;
    discount?: { type: "PERCENT" | "FIXED"; value: number };
    unit?: string;
  }>;
  subtotal: number;
  tax: number;
  discount?: number;
  total: number;
  currency: string;
};

function now() { return new Date().toISOString(); }
function text(v: any, fallback = "") { return typeof v === "string" ? v.trim() : fallback; }
function num(v: any, fallback = 0) { const n = typeof v === "number" ? v : Number(v); return Number.isFinite(n) ? n : fallback; }
function bool(v: any) { return typeof v === "boolean" ? v : [1, "1", "true", "TRUE", "yes", "si"].includes(v); }
function money(v: number) { return Math.round((v + Number.EPSILON) * 100) / 100; }
function moneyString(v: number) { return money(v).toFixed(2); }
function json(body: unknown, status = 200) { return new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } }); }
function apiBase() { return FACTUS_ENV === "production" ? "https://api.factus.com.co" : "https://api-sandbox.factus.com.co"; }
function record(v: any): Json { return v && typeof v === "object" && !Array.isArray(v) ? v : {}; }
function errorText(e: unknown) { return e instanceof Error ? e.message : typeof e === "string" ? e : "FACTUS_UNKNOWN_ERROR"; }

async function bodyJson<T = Json>(r: Response): Promise<T | null> {
  const t = await r.text();
  if (!t.trim()) return null;
  try { return JSON.parse(t) as T; } catch { return null; }
}

async function requestWithTimeout(url: string, init: RequestInit) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FACTUS_TIMEOUT_MS);
  try { return await fetch(url, { ...init, signal: controller.signal }); }
  finally { clearTimeout(timer); }
}

async function getFactusToken(force = false): Promise<string> {
  if (!force && cachedToken && cachedToken.expiresAt > Date.now()) return cachedToken.accessToken;
  if (!FACTUS_CLIENT_ID || !FACTUS_CLIENT_SECRET || !FACTUS_USERNAME || !FACTUS_PASSWORD) {
    throw new Error("FACTUS_CONFIG_MISSING: faltan FACTUS_CLIENT_ID / FACTUS_CLIENT_SECRET / FACTUS_USERNAME / FACTUS_PASSWORD.");
  }
  const form = new URLSearchParams({ grant_type: "password", client_id: FACTUS_CLIENT_ID, client_secret: FACTUS_CLIENT_SECRET, username: FACTUS_USERNAME, password: FACTUS_PASSWORD });
  let response: Response;
  try {
    response = await requestWithTimeout(`${apiBase()}/oauth/token`, { method: "POST", headers: { Accept: "application/json", "Content-Type": "application/x-www-form-urlencoded" }, body: form });
  } catch (e) {
    throw new Error(`FACTUS_AUTH_NETWORK_ERROR: ${errorText(e)}`);
  }
  const data = await bodyJson<Json>(response) ?? {};
  const accessToken = text(data.access_token);
  if (!response.ok || !accessToken) throw new Error(`FACTUS_AUTH_FAILED: ${text(data.message) || `HTTP ${response.status}`}`);
  const expiresIn = Math.max(60, num(data.expires_in, 600));
  cachedToken = { accessToken, expiresAt: Date.now() + Math.max(30, expiresIn - 30) * 1000 };
  return accessToken;
}

async function factus<T = Json>(path: string, init: RequestInit, retry401 = true): Promise<{ response: Response; data: T | null }> {
  const token = await getFactusToken();
  const headers = new Headers(init.headers || {});
  headers.set("Authorization", `Bearer ${token}`);
  headers.set("Accept", "application/json");
  if (init.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  let response: Response;
  try { response = await requestWithTimeout(`${apiBase()}${path}`, { ...init, headers }); }
  catch (e) { throw new Error(`FACTUS_NETWORK_ERROR: ${errorText(e)}`); }
  if (response.status === 401 && retry401) { cachedToken = null; return factus<T>(path, init, false); }
  return { response, data: await bodyJson<T>(response) };
}

function flattenErrors(v: any, prefix = ""): string[] {
  if (v == null) return [];
  if (typeof v === "string") return [prefix ? `${prefix}: ${v}` : v];
  if (Array.isArray(v)) return v.flatMap((x, i) => flattenErrors(x, `${prefix}[${i}]`));
  if (typeof v === "object") return Object.entries(v).flatMap(([k, x]) => flattenErrors(x, prefix ? `${prefix}.${k}` : k));
  return [prefix ? `${prefix}: ${String(v)}` : String(v)];
}

function documentCode(type: InvoiceRequest["customer"]["documentType"]) {
  const map = { CC: "13", CE: "22", NIT: "31", PASSPORT: "41" } as Record<string, string>;
  if (type === "OTHER") throw new Error("FACTUS_CUSTOMER_DOCUMENT_TYPE_INVALID: OTHER es ambiguo para facturación electrónica; use CC, CE, NIT o PASSPORT.");
  return map[type];
}

function customerPayload(c: InvoiceRequest["customer"]) {
  const fullName = text(c.fullName);
  const rawDoc = text(c.documentNumber).replace(/\s+/g, "");
  const consumer = /^consumidor final$/i.test(fullName) || rawDoc === "000000000";
  if (consumer) return { identification_document_code: "13", identification: "22222222222", legal_organization_code: "2", names: "Consumidor Final", country_code: "CO", tribute_code: "ZZ", responsibilities: ["R-99-PN"], ...(text(c.email) ? { email: text(c.email) } : {}), ...(text(c.phone) ? { phone: text(c.phone) } : {}), ...(text(c.address) ? { address: text(c.address) } : {}) };
  if (!rawDoc || !fullName) throw new Error("FACTUS_CUSTOMER_DATA_INVALID: documento y nombre son obligatorios.");
  if (["CC", "CE", "NIT"].includes(c.documentType) && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(rawDoc)) {
    throw new Error("FACTUS_CUSTOMER_DOCUMENT_INVALID: el documento parece ser el UUID interno de VIMDY, no el documento fiscal del cliente.");
  }
  let identification = rawDoc;
  let dv: string | undefined;
  if (c.documentType === "NIT") {
    const m = rawDoc.match(/^(\d+)-(\d)$/);
    if (m) { identification = m[1]; dv = m[2]; }
    else identification = rawDoc.replace(/\D/g, "");
  }
  return { identification_document_code: documentCode(c.documentType), identification, ...(dv ? { dv } : {}), legal_organization_code: c.documentType === "NIT" ? "1" : "2", ...(c.documentType === "NIT" ? { company: fullName } : { names: fullName }), country_code: "CO", tribute_code: "ZZ", ...(c.documentType === "NIT" ? {} : { responsibilities: ["R-99-PN"] }), ...(text(c.email) ? { email: text(c.email) } : {}), ...(text(c.phone) ? { phone: text(c.phone) } : {}), ...(text(c.address) ? { address: text(c.address) } : {}) };
}

function lineDiscount(item: InvoiceRequest["items"][number]) {
  const gross = money(item.quantity * item.price);
  if (!item.discount) return 0;
  const value = Math.max(0, num(item.discount.value));
  return item.discount.type === "PERCENT" ? Math.min(gross, money(gross * value / 100)) : Math.min(gross, money(value));
}

function distributeDiscount(lines: Array<{ gross: number; ownDiscount: number }>, amount: number) {
  const bases = lines.map(x => Math.max(0, money(x.gross - x.ownDiscount)));
  const total = money(bases.reduce((s, x) => s + x, 0));
  if (amount <= 0 || total <= 0) return bases.map(() => 0);
  const target = Math.min(amount, total);
  const out = bases.map(x => money(target * x / total));
  const delta = money(target - out.reduce((s, x) => s + x, 0));
  if (Math.abs(delta) > 0 && out.length) out[0] = money(Math.max(0, out[0] + delta));
  return out;
}

function paymentDetails(sale: Json, total: number) {
  const breakdown = Array.isArray(sale.paymentBreakdown) ? sale.paymentBreakdown : [];
  if (breakdown.length) {
    const rows = breakdown.map((x: any) => ({ amount: num(x.amount), payment_form: text(x.paymentForm) || "1", payment_method_code: text(x.paymentMethodCode || x.factusPaymentMethodCode), reference_code: text(x.referenceCode || x.paymentReference) || undefined })).filter((x: any) => x.amount > 0 && x.payment_method_code);
    if (rows.length && Math.abs(rows.reduce((s: number, x: any) => s + x.amount, 0) - total) <= 0.01) return rows.map((x: any) => ({ payment_form: x.payment_form, payment_method_code: x.payment_method_code, ...(x.reference_code ? { reference_code: x.reference_code } : {}), amount: moneyString(x.amount) }));
  }
  const method = text(sale.paymentMethod).toUpperCase();
  const reference = text(sale.paymentReference || sale.externalPaymentReference || sale.providerReference);
  const explicit = text(sale.factusPaymentMethodCode);
  if (explicit) return [{ payment_form: "1", payment_method_code: explicit, ...(reference ? { reference_code: reference } : {}), amount: moneyString(total) }];
  if (method === "MIXED") {
    const cash = Math.min(total, Math.max(0, num(sale.cashAmount)));
    const rows: any[] = [];
    if (cash > 0) rows.push({ payment_form: "1", payment_method_code: "10", amount: moneyString(cash) });
    const rest = money(total - cash);
    if (rest > 0) rows.push({ payment_form: "1", payment_method_code: FACTUS_MIXED_NON_CASH_METHOD_CODE, ...(reference ? { reference_code: reference } : {}), amount: moneyString(rest) });
    if (rows.length) return rows;
  }
  const code = method === "CASH" ? "10" : method === "CARD" ? FACTUS_CARD_METHOD_CODE : method === "TRANSFER" ? "47" : method === "QR" ? FACTUS_QR_METHOD_CODE : "1";
  return [{ payment_form: "1", payment_method_code: code, ...(reference ? { reference_code: reference } : {}), amount: moneyString(total) }];
}

async function numberingRange(sale: Json, business: Json) {
  const qs = new URLSearchParams({ "filter[document]": "21", "filter[is_active]": "1" });
  const { response, data } = await factus<Json>(`/v2/numbering-ranges?${qs.toString()}`, { method: "GET" });
  if (!response.ok) throw new Error(`FACTUS_NUMBERING_RANGES_FAILED: ${text(data?.message) || `HTTP ${response.status}`}`);
  const container = record(data?.data);
  const list = Array.isArray(data?.data) ? data?.data : Array.isArray(container.data) ? container.data : [];
  const ranges = list.map(record).filter((x: any) => bool(x.is_active) && !bool(x.is_expired) && !x.deleted_at);
  const explicit = num(sale.factusNumberingRangeId ?? Deno.env.get("FACTUS_NUMBERING_RANGE_ID"), NaN);
  if (Number.isFinite(explicit)) {
    const match = ranges.find((x: any) => num(x.id, NaN) === explicit);
    if (!match) throw new Error(`FACTUS_NUMBERING_RANGE_INVALID: ${explicit}`);
    return match;
  }
  const prefix = text(sale.invoicePrefix || business.invoice_prefix).toUpperCase();
  if (prefix) {
    const matches = ranges.filter((x: any) => text(x.prefix).toUpperCase() === prefix);
    if (matches.length === 1) return matches[0];
    if (matches.length > 1) throw new Error(`FACTUS_NUMBERING_RANGE_AMBIGUOUS: prefijo ${prefix} tiene múltiples rangos activos.`);
  }
  if (ranges.length === 1) return ranges[0];
  if (!ranges.length) throw new Error("FACTUS_NUMBERING_RANGE_MISSING: no existe un rango activo de Factura de Venta (document=21).");
  throw new Error("FACTUS_NUMBERING_RANGE_REQUIRED: configura FACTUS_NUMBERING_RANGE_ID o businesses.invoice_prefix.");
}

function buildPayload(req: InvoiceRequest, sale: Json, business: Json, products: Map<string, string>, range: any) {
  const subtotal = money(num(sale.subtotal, req.subtotal));
  const tax = money(num(sale.tax, req.tax));
  const total = money(num(sale.total, req.total));
  const discount = Math.max(0, money(num(sale.discount, req.discount || 0)));
  const delivery = Math.max(0, money(num(sale.deliveryFee, 0)));
  if (delivery > 0 && (FACTUS_DELIVERY_TAX_RATE === null || !Number.isFinite(FACTUS_DELIVERY_TAX_RATE))) throw new Error("FACTUS_DELIVERY_TAX_RATE_REQUIRED: configura el tratamiento fiscal del domicilio.");
  const items = req.items.map((item, i) => ({ ...item, name: products.get(item.productId) || text(item.name) || item.productId || `ITEM-${i + 1}`, gross: money(item.quantity * item.price), ownDiscount: lineDiscount(item) }));
  const extraDiscount = Math.max(0, money(discount - items.reduce((s, x) => s + x.ownDiscount, 0)));
  const distributed = distributeDiscount(items, extraDiscount);
  const effectiveTax = subtotal > 0 ? tax / subtotal * 100 : num(business.tax_rate, 0);
  const itemPayloads: any[] = items.map((item: any, i: number) => {
    const globalDiscount = distributed[i] || 0;
    const discountAmount = Math.min(item.gross, money(item.ownDiscount + globalDiscount));
    const taxRate = item.taxRate !== undefined && Number.isFinite(item.taxRate) && item.taxRate >= 0 && item.taxRate <= 100 ? item.taxRate : Math.max(0, Math.min(100, effectiveTax));
    return { code_reference: item.productId || `ITEM-${i + 1}`, name: item.name, quantity: Number(item.quantity).toFixed(2), ...(item.note ? { note: text(item.note).slice(0, 500) } : {}), ...(discountAmount > 0 ? { discount_amount: moneyString(discountAmount) } : {}), price: moneyString(item.price), unit_measure_code: "94", standard_code: "999", taxes: [{ code: "01", rate: Number(taxRate).toFixed(2) }] };
  });
  if (delivery > 0) itemPayloads.push({ code_reference: "VIMDY-DELIVERY", name: "Servicio de entrega", quantity: "1.00", price: moneyString(delivery), unit_measure_code: "94", standard_code: "999", taxes: [{ code: "01", rate: Number(FACTUS_DELIVERY_TAX_RATE).toFixed(2) }] });
  const payload: Json = { reference_code: `VIMDY-${req.saleId}`, document: "01", operation_type: "10", send_email: FACTUS_SEND_EMAIL, observation: (text(sale.invoiceObservation) || `Venta VIMDY ${text(sale.code) || req.saleId}`).slice(0, 500), payment_details: paymentDetails(sale, total), cash_rounding_amount: "0.00", customer: customerPayload(req.customer), items: itemPayloads };
  if (range) payload.numbering_range_id = num(range.id);
  const tip = Math.max(0, money(num(sale.tip, 0)));
  if (tip > 0) {
    const base = Math.max(0, money(subtotal - discount));
    payload.allowance_charges = [{ concept_type: "03", is_surcharge: true, reason: "Propina", base_amount: moneyString(base), amount: moneyString(tip) }];
  }
  return payload;
}

async function listByReference(reference: string) {
  const q = new URLSearchParams({ "filter[reference_code]": reference, "filter[per_page]": "10" });
  const { response, data } = await factus<Json>(`/v2/bills?${q.toString()}`, { method: "GET" });
  if (!response.ok) return null;
  const box = record(data?.data);
  const list = Array.isArray(data?.data) ? data?.data : Array.isArray(box.data) ? box.data : [];
  return list.map(record).find((x: any) => text(x.reference_code) === reference) || null;
}

async function destroyPending(reference: string) {
  const { response, data } = await factus<Json>(`/v2/bills/destroy/reference/${encodeURIComponent(reference)}`, { method: "DELETE" });
  if (!response.ok) throw new Error(`FACTUS_PENDING_DELETE_FAILED: ${text(data?.message) || `HTTP ${response.status}`}`);
}

async function createOrReconcile(payload: Json, reference: string) {
  const first = await factus<Json>("/v2/bills/validate", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
  if (first.response.ok && first.data?.data) return record(first.data.data);
  const existing = await listByReference(reference);
  if (existing) {
    if (bool(existing.is_validated) || text(existing.cufe)) return existing;
    if (first.response.status === 409) {
      await destroyPending(reference);
      const retry = await factus<Json>("/v2/bills/validate", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      if (retry.response.ok && retry.data?.data) return record(retry.data.data);
      throw new Error(`FACTUS_RETRY_FAILED: ${text(retry.data?.message) || `HTTP ${retry.response.status}`}`);
    }
  }
  throw new Error(`FACTUS_REJECTED: ${text(first.data?.message) || `HTTP ${first.response.status}`}`);
}

async function getBill(number: string) {
  const { response, data } = await factus<Json>(`/v2/bills/${encodeURIComponent(number)}`, { method: "GET" });
  if (!response.ok || !data?.data) throw new Error(`FACTUS_GET_BILL_FAILED: ${text(data?.message) || `HTTP ${response.status}`}`);
  return record(data.data);
}

function b64Bytes(v: string) {
  const s = v.trim().replace(/^data:[^;]+;base64,/, "").replace(/\s/g, "");
  let bin: string;
  try { bin = atob(s); } catch { throw new Error("FACTUS_INVALID_BASE64_ARTIFACT"); }
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

async function ensureBucket(admin: ReturnType<typeof createClient>) {
  const found = await admin.storage.getBucket(FACTUS_BUCKET);
  if (!found.error && found.data) return;
  const made = await admin.storage.createBucket(FACTUS_BUCKET, { public: false });
  if (made.error) {
    const retry = await admin.storage.getBucket(FACTUS_BUCKET);
    if (retry.error || !retry.data) throw new Error(`FACTUS_STORAGE_BUCKET_FAILED: ${made.error.message}`);
  }
}

function artifactPath(businessId: string, saleId: string, ext: "pdf" | "xml") { return `business/${businessId}/sales/${saleId}/invoice.${ext}`; }

async function artifact(admin: ReturnType<typeof createClient>, path: string, bytes: Uint8Array, type: string) {
  const { error } = await admin.storage.from(FACTUS_BUCKET).upload(path, new Blob([bytes], { type }), { upsert: true, cacheControl: "31536000", contentType: type });
  if (error) throw new Error(`FACTUS_STORAGE_UPLOAD_FAILED: ${error.message}`);
}

async function signed(admin: ReturnType<typeof createClient>, path: string | null) {
  if (!path) return undefined;
  if (/^https?:\/\//i.test(path)) return path;
  const { data, error } = await admin.storage.from(FACTUS_BUCKET).createSignedUrl(path, FACTUS_SIGNED_URL_TTL);
  if (error || !data?.signedUrl) throw new Error(`FACTUS_SIGNED_URL_FAILED: ${error?.message || "no se pudo generar URL firmada"}`);
  return data.signedUrl;
}

async function downloadArtifacts(admin: ReturnType<typeof createClient>, businessId: string, saleId: string, invoiceNumber: string, oldPdf: string | null, oldXml: string | null) {
  await ensureBucket(admin);
  const pdfPath = oldPdf || artifactPath(businessId, saleId, "pdf");
  const xmlPath = oldXml || artifactPath(businessId, saleId, "xml");
  const done: string[] = [];
  try {
    const pdf = await factus<Json>(`/v2/bills/${encodeURIComponent(invoiceNumber)}/download-pdf`, { method: "GET" });
    if (!pdf.response.ok) throw new Error(`FACTUS_PDF_DOWNLOAD_FAILED: ${text(pdf.data?.message) || `HTTP ${pdf.response.status}`}`);
    const pdfData = record(pdf.data?.data);
    const pdf64 = text(pdf.data?.pdf_base_64_encoded || pdfData.pdf_base_64_encoded);
    await artifact(admin, pdfPath, b64Bytes(pdf64), "application/pdf");
    done.push(pdfPath);
    const xml = await factus<Json>(`/v2/bills/${encodeURIComponent(invoiceNumber)}/download-xml/`, { method: "GET" });
    if (!xml.response.ok) throw new Error(`FACTUS_XML_DOWNLOAD_FAILED: ${text(xml.data?.message) || `HTTP ${xml.response.status}`}`);
    const xmlData = record(xml.data?.data);
    const xml64 = text(xml.data?.xml_base_64_encoded || xmlData.xml_base_64_encoded);
    await artifact(admin, xmlPath, b64Bytes(xml64), "application/xml");
    done.push(xmlPath);
    return { pdfPath, xmlPath };
  } catch (e) {
    if (done.length) { try { await admin.storage.from(FACTUS_BUCKET).remove(done); } catch {} }
    throw e;
  }
}

async function loadBusiness(admin: ReturnType<typeof createClient>, businessId: string) {
  const { data, error } = await admin.from("businesses").select("id,name,country,currency,tax_rate,fiscal_legal_name,fiscal_address,fiscal_city,fiscal_department,fiscal_phone,fiscal_email,fiscal_tax_regime,fiscal_organization_type,electronic_invoicing_enabled,electronic_invoicing_provider,invoice_prefix,invoice_consecutive_from,invoice_consecutive_to,invoice_consecutive_current").eq("id", businessId).maybeSingle();
  if (error) throw new Error(`BUSINESS_LOOKUP_FAILED: ${error.message}`);
  if (!data) throw new Error("BUSINESS_NOT_FOUND");
  return data as Json;
}

async function loadSale(admin: ReturnType<typeof createClient>, businessId: string, saleId: string) {
  const { data, error } = await admin.from("sales").select("id,business_id,branch_id,data").eq("id", saleId).eq("business_id", businessId).maybeSingle();
  if (error) throw new Error(`SALE_LOOKUP_FAILED: ${error.message}`);
  if (!data) throw new Error("SALE_NOT_FOUND");
  return { id: data.id as string, business_id: data.business_id as string, branch_id: data.branch_id as string | null, data: record(data.data) };
}

const invoiceSelect = "id,business_id,sale_id,provider,environment,status,document_type,prefix,invoice_number,cufe,tracking_code,qr_code,customer_id,customer_document_type,customer_document_number,customer_name,subtotal,tax,total,xml_reference,pdf_reference,raw_response,error_code,error_message,attempt_count,last_attempt_at,issued_at,validated_at,created_at,updated_at";

async function loadInvoice(admin: ReturnType<typeof createClient>, businessId: string, saleId: string) {
  const { data, error } = await admin.from("electronic_invoices").select(invoiceSelect).eq("business_id", businessId).eq("sale_id", saleId).maybeSingle();
  if (error) throw new Error(`INVOICE_LOOKUP_FAILED: ${error.message}`);
  return data as Json | null;
}

async function loadInvoiceById(admin: ReturnType<typeof createClient>, id: string) {
  const { data, error } = await admin.from("electronic_invoices").select(invoiceSelect).eq("id", id).maybeSingle();
  if (error) throw new Error(`INVOICE_LOOKUP_FAILED: ${error.message}`);
  return data as Json | null;
}

async function persistInvoice(admin: ReturnType<typeof createClient>, req: InvoiceRequest, factusData: Json, status: string, attemptCount: number, pdfPath: string | null, xmlPath: string | null, errorCode: string | null = null, errorMessage: string | null = null) {
  const validated = bool(factusData.is_validated);
  const invoiceNumber = text(factusData.number) || null;
  const cufe = text(factusData.cufe) || null;
  const referenceCode = text(factusData.reference_code) || `VIMDY-${req.saleId}`;
  const { data, error } = await admin.from("electronic_invoices").upsert({
    id: `inv_${req.saleId}`,
    business_id: req.businessId,
    sale_id: req.saleId,
    provider: "factus",
    environment: FACTUS_ENV,
    status,
    document_type: "INVOICE",
    prefix: invoiceNumber ? (invoiceNumber.match(/^([A-Za-z]+)/)?.[1] || null) : null,
    invoice_number: invoiceNumber,
    cufe,
    tracking_code: cufe,
    qr_code: text(factusData.links?.qr) || null,
    customer_document_type: req.customer.documentType,
    customer_document_number: text(req.customer.documentNumber),
    customer_name: text(req.customer.fullName),
    subtotal: money(req.subtotal),
    tax: money(req.tax),
    total: money(req.total),
    xml_reference: xmlPath,
    pdf_reference: pdfPath,
    raw_response: { ...factusData, reference_code: referenceCode, environment: FACTUS_ENV },
    error_code: errorCode,
    error_message: errorMessage,
    attempt_count: attemptCount,
    last_attempt_at: now(),
    issued_at: validated && invoiceNumber ? now() : null,
    validated_at: validated ? now() : null,
    updated_at: now(),
  }, { onConflict: "business_id,sale_id" }).select(invoiceSelect).single();
  if (error || !data) throw new Error(`INVOICE_PERSIST_FAILED: ${error?.message || "sin fila resultante"}`);
  return data as Json;
}

async function updateArtifactsRefs(admin: ReturnType<typeof createClient>, id: string, pdfPath: string, xmlPath: string) {
  const { data, error } = await admin.from("electronic_invoices").update({ pdf_reference: pdfPath, xml_reference: xmlPath, updated_at: now() }).eq("id", id).select(invoiceSelect).single();
  if (error || !data) throw new Error(`INVOICE_ARTIFACT_REFERENCE_PERSIST_FAILED: ${error?.message || "sin fila resultante"}`);
  return data as Json;
}

async function linkSale(admin: ReturnType<typeof createClient>, sale: any, invoice: Json) {
  const d = { ...sale.data, invoiceId: invoice.id, invoiceCufe: invoice.cufe || invoice.tracking_code || undefined, invoiceNumber: invoice.invoice_number || undefined, invoiceProvider: "factus", invoiceStatus: invoice.status, invoicePdfPath: invoice.pdf_reference || undefined, invoiceXmlPath: invoice.xml_reference || undefined, invoiceIssuedAt: invoice.validated_at || invoice.issued_at || undefined, invoiceUpdatedAt: now() };
  const { data, error } = await admin.from("sales").update({ data: d, updated_at: now() }).eq("id", sale.id).eq("business_id", sale.business_id).select("id,business_id,branch_id,data").single();
  if (error || !data) throw new Error(`SALE_INVOICE_LINK_FAILED: ${error?.message || "no se pudo actualizar sales.data"}`);
  return data;
}

function frontendInvoice(row: Json, pdfUrl?: string, xmlUrl?: string) {
  return { id: row.id, businessId: row.business_id, saleId: row.sale_id, provider: "factus", status: row.status, number: row.invoice_number || undefined, reference_code: text(row.raw_response?.reference_code) || undefined, cufe: row.cufe || row.tracking_code || undefined, pdfUrl, xmlUrl, qrCode: row.qr_code || undefined, createdAt: row.created_at || now(), errorMessage: row.error_message || undefined, raw: row.raw_response };
}

async function assertMembership(admin: ReturnType<typeof createClient>, userId: string, businessId: string) {
  const { data, error } = await admin.from("business_members").select("role").eq("user_id", userId).eq("business_id", businessId).maybeSingle();
  if (error) throw new Error(`MEMBERSHIP_CHECK_FAILED: ${error.message}`);
  if (!data) throw new Error("NOT_A_MEMBER: no perteneces a este negocio.");
}

async function assertSubscription(admin: ReturnType<typeof createClient>, businessId: string) {
  const { data, error } = await admin.rpc("is_business_subscription_active", { p_business_id: businessId });
  if (error) throw new Error(`SUBSCRIPTION_CHECK_FAILED: ${error.message}`);
  if (!data) throw new Error("SUBSCRIPTION_EXPIRED: la suscripción del negocio ha vencido.");
}

async function createWorkflow(admin: ReturnType<typeof createClient>, req: InvoiceRequest) {
  if (!req.saleId || !req.businessId) throw new Error("INVOICE_REQUEST_REQUIRED");
  if (req.provider !== "factus") throw new Error("FACTUS_PROVIDER_MISMATCH");
  if (text(req.country).toUpperCase() !== "CO") throw new Error("FACTUS_COUNTRY_NOT_SUPPORTED");
  if (text(req.currency).toUpperCase() !== "COP") throw new Error("FACTUS_CURRENCY_NOT_SUPPORTED");
  if (req.documentType !== "INVOICE") throw new Error(`FACTUS_DOCUMENT_TYPE_NOT_SUPPORTED: ${req.documentType}`);
  if (!Array.isArray(req.items) || !req.items.length) throw new Error("FACTUS_ITEMS_REQUIRED");
  if (!Number.isFinite(req.total) || req.total <= 0) throw new Error("FACTUS_TOTAL_INVALID");
  const business = await loadBusiness(admin, req.businessId);
  if (text(business.country).toUpperCase() !== "CO" || text(business.currency).toUpperCase() !== "COP") throw new Error("BUSINESS_FISCAL_COUNTRY_CURRENCY_INVALID");
  if (!bool(business.electronic_invoicing_enabled) || text(business.electronic_invoicing_provider) !== "factus") throw new Error("FACTUS_NOT_ENABLED");
  const sale = await loadSale(admin, req.businessId, req.saleId);
  const saleStatus = text(sale.data.status).toUpperCase();
  if (!["PAID", "CLOSED"].includes(saleStatus)) throw new Error(`SALE_NOT_READY_FOR_INVOICE: ${saleStatus || "UNKNOWN"}`);
  let local = await loadInvoice(admin, req.businessId, req.saleId);
  if (local?.provider && local.provider !== "factus") throw new Error(`INVOICE_PROVIDER_MISMATCH: ${local.provider}`);
  if (local?.status === "accepted" && local.invoice_number && (local.cufe || local.tracking_code)) {
    if (!local.pdf_reference || !local.xml_reference) {
      const a = await downloadArtifacts(admin, req.businessId, req.saleId, local.invoice_number, local.pdf_reference, local.xml_reference);
      local = await updateArtifactsRefs(admin, local.id, a.pdfPath, a.xmlPath);
    }
    await linkSale(admin, sale, local);
    return { invoice: local, pdfUrl: await signed(admin, local.pdf_reference), xmlUrl: await signed(admin, local.xml_reference) };
  }
  let attempts = num(local?.attempt_count, 0) + 1;
  if (local) {
    const { error } = await admin.from("electronic_invoices").update({ status: "pending", error_code: null, error_message: null, attempt_count: attempts, last_attempt_at: now(), updated_at: now() }).eq("id", local.id);
    if (error) throw new Error(`INVOICE_ATTEMPT_UPDATE_FAILED: ${error.message}`);
  } else {
    const { error } = await admin.from("electronic_invoices").insert({ id: `inv_${req.saleId}`, business_id: req.businessId, sale_id: req.saleId, provider: "factus", environment: FACTUS_ENV, status: "pending", document_type: "INVOICE", customer_document_type: req.customer.documentType, customer_document_number: text(req.customer.documentNumber), customer_name: text(req.customer.fullName), subtotal: money(req.subtotal), tax: money(req.tax), total: money(req.total), attempt_count: attempts, last_attempt_at: now(), raw_response: { reference_code: `VIMDY-${req.saleId}`, environment: FACTUS_ENV } });
    if (error && !String(error.message).toLowerCase().includes("duplicate")) throw new Error(`INVOICE_CREATE_ROW_FAILED: ${error.message}`);
  }
  const ids = [...new Set(req.items.map(x => text(x.productId)).filter(Boolean))];
  const names = new Map<string, string>();
  if (ids.length) {
    const { data, error } = await admin.from("products").select("id,business_id,data").eq("business_id", req.businessId).in("id", ids);
    if (error) throw new Error(`PRODUCT_LOOKUP_FAILED: ${error.message}`);
    const found = new Set((data || []).map((x: any) => x.id));
    for (const p of data || []) { const pd = record(p.data); const n = text(pd.name || pd.label || pd.title); if (n) names.set(p.id, n); }
    const missing = ids.filter(id => !found.has(id));
    if (missing.length) throw new Error(`FACTUS_PRODUCT_NOT_FOUND: ${missing.join(", ")}`);
  }
  const range = await numberingRange(sale.data, business);
  const authoritativeReq: InvoiceRequest = { ...req, subtotal: num(sale.data.subtotal, req.subtotal), tax: num(sale.data.tax, req.tax), discount: num(sale.data.discount, req.discount || 0), total: num(sale.data.total, req.total), items: Array.isArray(sale.data.items) ? sale.data.items as InvoiceRequest["items"] : req.items };
  const payload = buildPayload(authoritativeReq, sale.data, business, names, range);
  let factusData: Json;
  try { factusData = await createOrReconcile(payload, `VIMDY-${req.saleId}`); }
  catch (e) { await admin.from("electronic_invoices").update({ status: "error", error_code: "FACTUS_CREATE_FAILED", error_message: errorText(e).slice(0, 2000), attempt_count: attempts, last_attempt_at: now(), updated_at: now() }).eq("id", `inv_${req.saleId}`); throw e; }
  factusData = {
    ...factusData,
    numbering_range: range ? {
      id: num(range.id),
      prefix: text(range.prefix) || null,
      resolution_number: text(range.resolution_number) || null,
      from: range.from ?? null,
      to: range.to ?? null,
      current: range.current ?? null,
      start_date: text(range.start_date) || null,
      end_date: text(range.end_date) || null,
      is_active: bool(range.is_active),
      is_expired: bool(range.is_expired),
    } : null,
  };
  const validationErrors = flattenErrors(factusData.errors);
  const validated = bool(factusData.is_validated);
  const status = validationErrors.length ? "rejected" : validated ? "accepted" : "pending";
  if (status === "accepted" && !text(factusData.cufe)) throw new Error("FACTUS_CUFE_MISSING: Factus no devolvió CUFE.");
  local = await persistInvoice(admin, authoritativeReq, factusData, status, attempts, null, null, validationErrors.length ? "FACTUS_VALIDATION_FAILED" : null, validationErrors.length ? validationErrors.join(" | ").slice(0, 2000) : null);
  if (status !== "accepted") return { invoice: local };
  if (!local.invoice_number) throw new Error("FACTUS_NUMBER_MISSING");
  const a = await downloadArtifacts(admin, req.businessId, req.saleId, local.invoice_number, local.pdf_reference, local.xml_reference);
  local = await updateArtifactsRefs(admin, local.id, a.pdfPath, a.xmlPath);
  try { await linkSale(admin, sale, local); }
  catch (e) { await admin.from("electronic_invoices").update({ error_code: "SALE_LINK_PENDING", error_message: errorText(e).slice(0, 2000), updated_at: now() }).eq("id", local.id); throw e; }
  return { invoice: local, pdfUrl: await signed(admin, local.pdf_reference), xmlUrl: await signed(admin, local.xml_reference) };
}

async function getWorkflow(admin: ReturnType<typeof createClient>, invoiceId: string) {
  let row = await loadInvoiceById(admin, invoiceId);
  if (!row) throw new Error("INVOICE_NOT_FOUND");
  if (row.provider !== "factus") throw new Error(`INVOICE_PROVIDER_MISMATCH: ${row.provider}`);
  const sale = await loadSale(admin, row.business_id, row.sale_id);
  if (row.status === "accepted" && row.invoice_number && (row.cufe || row.tracking_code)) {
    if (!row.pdf_reference || !row.xml_reference) {
      const a = await downloadArtifacts(admin, row.business_id, row.sale_id, row.invoice_number, row.pdf_reference, row.xml_reference);
      row = await updateArtifactsRefs(admin, row.id, a.pdfPath, a.xmlPath);
    }
    await linkSale(admin, sale, row);
  }
  return { invoice: row, pdfUrl: await signed(admin, row.pdf_reference), xmlUrl: await signed(admin, row.xml_reference) };
}

async function cancelWorkflow(admin: ReturnType<typeof createClient>, invoiceId: string, reason: string, actorId: string) {
  const row = await loadInvoiceById(admin, invoiceId);
  if (!row) throw new Error("INVOICE_NOT_FOUND");
  if (row.provider !== "factus") throw new Error(`INVOICE_PROVIDER_MISMATCH: ${row.provider}`);
  if (row.status === "accepted") throw new Error("INVOICE_ALREADY_VALIDATED: se requiere nota crédito, no eliminación.");
  const reference = text(row.raw_response?.reference_code) || `VIMDY-${row.sale_id}`;
  await destroyPending(reference);
  const cancellation = { reference_code: reference, reason: reason.slice(0, 1000), cancelled_at: now() };
  const { data, error } = await admin.from("electronic_invoices").update({ status: "cancelled", error_code: null, error_message: "Facturación anulada en Factus.", raw_response: { ...record(row.raw_response), cancellation }, updated_at: now() }).eq("id", row.id).select(invoiceSelect).single();
  if (error || !data) throw new Error(`INVOICE_UPDATE_FAILED: ${error?.message || "sin fila resultante"}`);
  await admin.from("subscription_audit_log").insert({ business_id: row.business_id, action: "FACTUS_INVOICE_CANCELLED", actor_type: "user", actor_id: actorId, details: { invoiceId: row.id, saleId: row.sale_id, referenceCode: reference, reason: reason.slice(0, 1000), environment: FACTUS_ENV } });
  return data as Json;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) return json({ error: "SERVER_CONFIG_MISSING" }, 500);
  if (!FACTUS_CLIENT_ID || !FACTUS_CLIENT_SECRET || !FACTUS_USERNAME || !FACTUS_PASSWORD) return json({ error: "FACTUS_CONFIG_MISSING" }, 500);
  if (FACTUS_ENV_RAW !== "sandbox" && FACTUS_ENV_RAW !== "production") return json({ error: "FACTUS_ENV_INVALID: usa sandbox o production." }, 500);
  const auth = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "").trim();
  if (!auth) return json({ error: "NO_AUTH" }, 401);
  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
  const { data: userData, error: userError } = await admin.auth.getUser(auth);
  if (userError || !userData.user) return json({ error: "SESSION_INVALID" }, 401);
  let body: any;
  try { body = await req.json(); } catch { return json({ error: "INVALID_JSON" }, 400); }
  try {
    if (body.action === "create") {
      const request = body.request as InvoiceRequest | undefined;
      if (!request) return json({ error: "INVOICE_REQUEST_REQUIRED" }, 400);
      await assertMembership(admin, userData.user.id, request.businessId);
      await assertSubscription(admin, request.businessId);
      const result = await createWorkflow(admin, request);
      return json({ ok: true, invoice: frontendInvoice(result.invoice, result.pdfUrl, result.xmlUrl) });
    }
    const invoiceId = text(body.invoiceId);
    if (body.action === "get") {
      if (!invoiceId) return json({ error: "INVOICE_ID_REQUIRED" }, 400);
      const target = await loadInvoiceById(admin, invoiceId);
      if (!target) return json({ error: "INVOICE_NOT_FOUND" }, 404);
      await assertMembership(admin, userData.user.id, target.business_id);
      const result = await getWorkflow(admin, invoiceId);
      return json({ ok: true, invoice: frontendInvoice(result.invoice, result.pdfUrl, result.xmlUrl) });
    }
    if (body.action === "cancel") {
      if (!invoiceId) return json({ error: "INVOICE_ID_REQUIRED" }, 400);
      const reason = text(body.reason);
      if (!reason) return json({ error: "INVOICE_CANCEL_REASON_REQUIRED" }, 400);
      const target = await loadInvoiceById(admin, invoiceId);
      if (!target) return json({ error: "INVOICE_NOT_FOUND" }, 404);
      await assertMembership(admin, userData.user.id, target.business_id);
      const result = await cancelWorkflow(admin, invoiceId, reason, userData.user.id);
      return json({ ok: true, invoice: frontendInvoice(result, await signed(admin, result.pdf_reference), await signed(admin, result.xml_reference)) });
    }
    return json({ error: "INVALID_ACTION" }, 400);
  } catch (e) {
    const message = errorText(e);
    const status = message.startsWith("NOT_A_MEMBER") || message.startsWith("SUBSCRIPTION_EXPIRED") ? 403 : message.includes("NOT_FOUND") ? 404 : message.includes("ALREADY_VALIDATED") || message.includes("CONFLICT") ? 409 : message.includes("REQUIRED") || message.includes("INVALID") ? 400 : 500;
    return json({ error: message }, status);
  }
});
