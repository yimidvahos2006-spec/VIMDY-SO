// ============================================================================
// factus-invoice (Supabase Edge Function)
// ----------------------------------------------------------------------------
// Único punto autorizado para hablar con la API de Factus (proveedor
// tecnológico DIAN — https://developers.factus.com.co). FactusProvider.ts
// (navegador) SOLO llama a esta función — nunca a Factus directamente,
// porque el client_secret/username/password de Factus son credenciales de
// verdad, sin equivalente "público" como la llave de Wompi.
//
// CONTRATO:
//   Body: { action: "create", request: InvoiceRequest }
//       | { action: "get", invoiceId: string }
//       | { action: "cancel", invoiceId: string, reason: string }
//   Respuesta: { ok: true, invoice: {...} } — ver FactusFunctionResult en
//   FactusProvider.ts, misma forma exacta.
//
// SEGURIDAD:
//   - El usuario se identifica siempre por el JWT (nunca por el body).
//   - request.businessId (en "create") debe pertenecer al negocio del
//     usuario que llama — igual criterio que wompi-void-transaction.
//   - Para "get"/"cancel", invoiceId debe existir en electronic_invoices
//     con el business_id del usuario — así nadie puede consultar/anular
//     la factura de OTRO negocio adivinando un id.
//   - FACTUS_CLIENT_ID / FACTUS_CLIENT_SECRET / FACTUS_USERNAME /
//     FACTUS_PASSWORD viven SOLO como secrets de esta función.
//
// CONFIGURACIÓN REQUERIDA:
//   supabase secrets set FACTUS_CLIENT_ID=...
//   supabase secrets set FACTUS_CLIENT_SECRET=...
//   supabase secrets set FACTUS_USERNAME=...
//   supabase secrets set FACTUS_PASSWORD=...
//   supabase secrets set FACTUS_ENV=sandbox   (o "production" cuando aplique)
//
// Despliegue:
//   supabase functions deploy factus-invoice
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
const FACTUS_CLIENT_ID = Deno.env.get("FACTUS_CLIENT_ID");
const FACTUS_CLIENT_SECRET = Deno.env.get("FACTUS_CLIENT_SECRET");
const FACTUS_USERNAME = Deno.env.get("FACTUS_USERNAME");
const FACTUS_PASSWORD = Deno.env.get("FACTUS_PASSWORD");
/** "sandbox" mientras no tengas producción habilitada con Factus — ver Buenas prácticas en sus docs. */
const FACTUS_ENV = Deno.env.get("FACTUS_ENV") ?? "sandbox";

function resolveFactusApiBase(): string {
  return FACTUS_ENV === "production"
    ? "https://api.factus.com.co"
    : "https://api-sandbox.factus.com.co";
}

// ----------------------------------------------------------------------------
// Autenticación OAuth2 contra Factus (POST /oauth/token, grant_type password).
// El token dura 1 hora (ver docs) — se cachea en memoria del isolate de la
// función mientras siga vivo; si expiró o la función se reinició, se pide
// uno nuevo. Nunca se persiste en ninguna tabla.
// ----------------------------------------------------------------------------
let cachedToken: { accessToken: string; expiresAt: number } | null = null;

async function getFactusAccessToken(): Promise<string> {
  if (cachedToken && cachedToken.expiresAt > Date.now()) {
    return cachedToken.accessToken;
  }

  if (!FACTUS_CLIENT_ID || !FACTUS_CLIENT_SECRET || !FACTUS_USERNAME || !FACTUS_PASSWORD) {
    throw new Error(
      "FACTUS_CONFIG_MISSING: faltan FACTUS_CLIENT_ID / FACTUS_CLIENT_SECRET / FACTUS_USERNAME / FACTUS_PASSWORD."
    );
  }

  const body = new URLSearchParams({
    grant_type: "password",
    client_id: FACTUS_CLIENT_ID,
    client_secret: FACTUS_CLIENT_SECRET,
    username: FACTUS_USERNAME,
    password: FACTUS_PASSWORD
  });

  const response = await fetch(`${resolveFactusApiBase()}/oauth/token`, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body
  });

  const data = await response.json();

  if (!response.ok || !data.access_token) {
    throw new Error(`FACTUS_AUTH_FAILED: ${data.message ?? `Factus respondió HTTP ${response.status}.`}`);
  }

  // expires_in viene en segundos (ver docs: 600s en sandbox). Se le resta
  // un margen de 30s para nunca usar un token a punto de vencer a mitad
  // de una request.
  cachedToken = {
    accessToken: data.access_token as string,
    expiresAt: Date.now() + (Number(data.expires_in ?? 600) - 30) * 1000
  };

  return cachedToken.accessToken;
}

// ----------------------------------------------------------------------------
// Tipos mínimos del lado VIMDY (deben calzar con InvoiceModels.ts /
// invoice.types.ts del frontend — se duplican acá porque las Edge
// Functions de Deno no comparten módulos con src/ del frontend Vite).
// ----------------------------------------------------------------------------
interface VimdyInvoiceCustomer {
  documentType: "CC" | "CE" | "NIT" | "PASSPORT" | "OTHER";
  documentNumber: string;
  fullName: string;
  email?: string;
  phone?: string;
  address?: string;
}

interface VimdyInvoiceRequest {
  saleId: string;
  businessId: string;
  provider: "factus" | "none";
  country: string;
  documentType: "INVOICE" | "CREDIT_NOTE" | "DEBIT_NOTE";
  customer: VimdyInvoiceCustomer;
  items: Array<{ productId: string; quantity: number; price: number; name?: string }>;
  subtotal: number;
  tax: number;
  discount?: number;
  total: number;
  currency: string;
  paymentMethod?: string;
}

const PAYMENT_METHOD_TO_FACTUS: Record<string, string> = {
  CASH: "10",
  CARD: "13",
  TRANSFER: "11",
  QR: "13",
  MIXED: "10"
};

function resolveFactusPaymentMethod(vimdyMethod: string | undefined): string {
  if (!vimdyMethod) return "10";
  return PAYMENT_METHOD_TO_FACTUS[vimdyMethod] ?? "10";
}

/** VIMDY solo maneja CC/NIT hoy en Colombia — mapa al código real de Factus. Ver tablas-de-referencia/tablas. */
const DOCUMENT_TYPE_TO_FACTUS: Record<VimdyInvoiceCustomer["documentType"], string> = {
  CC: "13",
  CE: "22",
  NIT: "31",
  PASSPORT: "41",
  OTHER: "43" // "Sin identificación" / consumidor final, ver tabla oficial de Factus.
};

function buildFactusPayload(request: VimdyInvoiceRequest) {
  const isCompany = request.customer.documentType === "NIT";
  const paymentMethodCode = resolveFactusPaymentMethod(request.paymentMethod);

  return {
    reference_code: `VIMDY-${request.saleId}`,
    document: "01",
    payment_details: [
      {
        payment_form: "1",
        payment_method_code: paymentMethodCode,
        amount: request.total.toFixed(2)
      }
    ],
    customer: {
      identification_document_code: DOCUMENT_TYPE_TO_FACTUS[request.customer.documentType],
      identification: request.customer.documentNumber,
      legal_organization_code: isCompany ? "1" : "2",
      ...(isCompany ? { company: request.customer.fullName } : { names: request.customer.fullName }),
      email: request.customer.email,
      phone: request.customer.phone,
      address: request.customer.address,
      country_code: request.country
    },
    items: request.items.map((item, index) => ({
      code_reference: item.productId || `ITEM-${index + 1}`,
      name: item.name || item.productId,
      quantity: item.quantity.toFixed(2),
      price: item.price.toFixed(2),
      unit_measure_code: "94",
      standard_code: "999",
      taxes: [
        {
          code: "01",
          rate: request.tax > 0 && request.subtotal > 0
            ? ((request.tax / request.subtotal) * 100).toFixed(2)
            : "0.00"
        }
      ]
    }))
  };
}

interface FactusCreateResponse {
  status: string;
  message: string;
  data?: {
    reference_code: string;
    number: string;
    cufe: string;
    is_validated: boolean;
    errors?: Record<string, string>;
    links?: { qr?: string; public_url?: string };
  };
}

/**
 * TODO importante: este endpoint construye el PDF/XML a partir de los
 * endpoints dedicados (`/v2/bills/{id}/pdf`, `/v2/bills/{id}/xml` — ver
 * "Descargar PDF/XML" en la documentación de Factus). Se deja para
 * cuando exista un caso de uso real (botón "Descargar factura" en VIMDY)
 * en vez de pedirlo siempre — evita llamadas innecesarias a Factus.
 */
async function createFactusInvoice(request: VimdyInvoiceRequest): Promise<FactusCreateResponse> {
  const token = await getFactusAccessToken();

  const productIds = request.items.map((item) => item.productId).filter(Boolean);
  const { data: products } = await admin
    .from("products")
    .select("id, name")
    .in("id", productIds);

  const productNameMap = new Map((products ?? []).map((p) => [p.id, p.name]));

  const enrichedItems = request.items.map((item) => ({
    ...item,
    name: productNameMap.get(item.productId) || item.name || item.productId
  }));

  const { data: saleRow } = await admin
    .from("sales")
    .select("data")
    .eq("id", request.saleId)
    .maybeSingle();

  const saleData = (saleRow?.data as Record<string, unknown> | null) ?? null;
  const paymentMethod = typeof saleData?.paymentMethod === "string" ? saleData.paymentMethod : undefined;

  const enrichedRequest = {
    ...request,
    items: enrichedItems,
    paymentMethod
  };

  const payload = buildFactusPayload(enrichedRequest);

  const response = await fetch(`${resolveFactusApiBase()}/v2/bills/validate`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      Accept: "application/json"
    },
    body: JSON.stringify(payload)
  });

  const data = (await response.json()) as FactusCreateResponse;

  if (!response.ok) {
    throw new Error(`FACTUS_REJECTED: ${data.message ?? `Factus respondió HTTP ${response.status}.`}`);
  }

  return data;
}

function toVimdyInvoice(businessId: string, saleId: string, factusData: FactusCreateResponse["data"]) {
  const hasErrors = factusData?.errors && Object.keys(factusData.errors).length > 0;

  return {
    id: `inv_${saleId}`,
    businessId,
    saleId,
    provider: "factus" as const,
    status: hasErrors ? ("rejected" as const) : factusData?.is_validated ? ("accepted" as const) : ("pending" as const),
    number: factusData?.number,
    cufe: factusData?.cufe,
    qrCode: factusData?.links?.qr,
    errorMessage: hasErrors ? Object.values(factusData!.errors!).join(" | ") : undefined,
    raw: factusData
  };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }

  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
    return json({ error: "SERVER_CONFIG_MISSING: faltan SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY" }, 500);
  }

  const authHeader = req.headers.get("Authorization") ?? req.headers.get("authorization");
  const accessToken = authHeader?.replace(/^Bearer\s+/i, "").trim();

  if (!accessToken) {
    return json({ error: "NO_AUTH: falta el token de sesión. Inicia sesión de nuevo." }, 401);
  }

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  const { data: userData, error: userError } = await admin.auth.getUser(accessToken);
  if (userError || !userData.user) {
    return json({ error: "SESSION_INVALID: tu sesión no es válida o expiró." }, 401);
  }
  const authUser = userData.user;

  let payload: {
    action?: "create" | "get" | "cancel";
    request?: VimdyInvoiceRequest;
    invoiceId?: string;
    reason?: string;
  };

  try {
    payload = await req.json();
  } catch {
    return json({ error: "INVALID_JSON" }, 400);
  }

  async function assertMembership(businessId: string) {
    const { data: membership, error: membershipError } = await admin
      .from("business_members")
      .select("role")
      .eq("user_id", authUser.id)
      .eq("business_id", businessId)
      .maybeSingle();

    if (membershipError) {
      throw new Error(`MEMBERSHIP_CHECK_FAILED: ${membershipError.message}`);
    }
    if (!membership) {
      throw new Error("NOT_A_MEMBER: no perteneces a este negocio.");
    }
  }

  try {
    if (payload.action === "create") {
      const request = payload.request;
      if (!request?.businessId || !request.saleId) {
        return json({ error: "Faltan campos: businessId y saleId son obligatorios." }, 400);
      }

      await assertMembership(request.businessId);

      const { data: activeData, error: activeError } = await admin.rpc("is_business_subscription_active", {
        p_business_id: request.businessId
      });

      if (activeError || !activeData) {
        return json({ error: "SUBSCRIPTION_EXPIRED: la suscripción del negocio ha vencido. Selecciona un plan para continuar." }, 403);
      }

      const factusResult = await createFactusInvoice(request);
      const invoice = toVimdyInvoice(request.businessId, request.saleId, factusResult.data);

      const { error: upsertError } = await admin
        .from("electronic_invoices")
        .upsert({ id: invoice.id, business_id: request.businessId, data: invoice, updated_at: new Date().toISOString() });

      if (upsertError) {
        return json({ error: "INVOICE_PERSIST_FAILED", detail: upsertError.message }, 500);
      }

      return json({ ok: true, invoice });
    }

    if (payload.action === "get" || payload.action === "cancel") {
      const invoiceId = payload.invoiceId?.trim();
      if (!invoiceId) {
        return json({ error: "Falta el campo: invoiceId es obligatorio." }, 400);
      }

      const { data: row, error: lookupError } = await admin
        .from("electronic_invoices")
        .select("business_id, data")
        .eq("id", invoiceId)
        .maybeSingle();

      if (lookupError) {
        return json({ error: "INVOICE_LOOKUP_FAILED", detail: lookupError.message }, 500);
      }
      if (!row) {
        return json({ error: "INVOICE_NOT_FOUND: esta factura no existe en VIMDY." }, 404);
      }

      await assertMembership(row.business_id);

      if (payload.action === "get") {
        return json({ ok: true, invoice: row.data });
      }

      // "cancel": Factus solo permite ELIMINAR una factura aún no validada
      // (DELETE /v2/bills/{reference_code}). Si ya fue validada ante la
      // DIAN, es legalmente irreversible — VIMDY debe guiar al negocio a
      // emitir una nota crédito en su lugar (fuera del alcance de este
      // primer corte). Por ahora, este camino devuelve un error claro en
      // vez de fingir una anulación que Factus rechazaría igual.
      const currentInvoice = row.data as { status: string };
      if (currentInvoice.status === "accepted") {
        return json(
          {
            error:
              "INVOICE_ALREADY_VALIDATED: esta factura ya fue validada ante la DIAN y no se puede anular — se necesita una nota crédito."
          },
          409
        );
      }

      return json({ error: "CANCEL_NOT_IMPLEMENTED: la anulación de facturas no validadas aún no está conectada." }, 501);
    }

    return json({ error: "INVALID_ACTION" }, 400);
  } catch (error) {
    return json({ error: (error as Error).message ?? "FACTUS_UNKNOWN_ERROR" }, 500);
  }
});