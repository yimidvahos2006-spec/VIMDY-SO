// ============================================================================
// dian-invoice (Supabase Edge Function)
// ----------------------------------------------------------------------------
// Proveedor propio de facturación electrónica para la DIAN (Colombia),
// siguiendo el Anexo Técnico de Factura Electrónica de Venta v1.9
// (Resolución 000165 de 2023).
//
// Genera el XML UBL 2.1, calcula el CUFE-SHA384, firma con XAdES-EPES,
// y transmite REALMENTE a los Web Services oficiales de la DIAN.
//
// Fuentes oficiales consultadas:
//   - Anexo Técnico de Factura Electrónica de Venta v1.9
//   - Guía Herramienta para el Consumo de Web Services (DIAN)
//   - WSDL oficial: https://vpfe-hab.dian.gov.co/WcfDianCustomerServices.svc?singleWsdl
//
// Endpoints oficiales (obtenidos del WSDL):
//   - Habilitación (sandbox): https://vpfe-hab.dian.gov.co/WcfDianCustomerServices.svc
//   - Producción:             https://vpfe.dian.gov.co/WcfDianCustomerServices.svc
//
// SEGURIDAD:
//   - El usuario se identifica siempre por el JWT.
//   - El negocio (businessId) debe pertenecer al usuario (assertMembership).
//   - La venta se consulta de la base de datos: items/subtotal/tax/total son
//     SOURCE OF TRUTH desde la venta almacenada — nunca del frontend.
//   - El certificado digital y la clave privada se obtienen de dian_certificates
//     (acceso solo service_role), desencriptados con DIAN_CERT_ENCRYPTION_KEY.
//   - NUNCA se exponen al frontend.
//
// BLOQUEO DE PRODUCCIÓN:
//   - Producción está bloqueada hasta que DIAN_PRODUCTION_ALLOWED=true.
//   - Este secret NO se configura durante la fase de habilitación.
//
// Secrets requeridos (configurados por el administrador de VIMDY):
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (auto-provistos por Supabase)
//   DIAN_CERT_ENCRYPTION_KEY (clave AES-256 para desencriptar certificados)
// ============================================================================

import { createClient } from "npm:@supabase/supabase-js@2";
import { DianSoapClient } from "./DianSoapClient.ts";
import { signDianInvoice } from "./DianSigner.ts";
import { DianXmlBuilder, DIAN_ENVIRONMENT_CODE, type DianInvoiceRequest } from "./XmlBuilder.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": Deno.env.get("VIMDY_APP_URL") ?? "https://app.vimdy.co",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const DIAN_CERT_ENCRYPTION_KEY = Deno.env.get("DIAN_CERT_ENCRYPTION_KEY") ?? "";

const DIAN_ENV = (Deno.env.get("ENV") ?? "development") as "development" | "production";
const PRODUCTION_BLOCKED = DIAN_ENV !== "production";

interface DianCertificateRow {
  id: string;
  business_id: string;
  certificate_name: string;
  certificate_serial: string;
  certificate_expiration: string;
  certificate_issuer: string;
  cert_type: string;
  software_id: string | null;
  software_code: string | null;
  pin: string | null;
  private_key_encrypted: string | null;
  cert_pem_encrypted: string | null;
  active: boolean;
  created_at: string;
  updated_at: string;
}

interface DianBusinessRow {
  tax_identification_number: string | null;
  tax_verification_digit: string | null;
  fiscal_legal_name: string | null;
  fiscal_address: string | null;
  fiscal_city: string | null;
  fiscal_department: string | null;
  fiscal_phone: string | null;
  fiscal_email: string | null;
  fiscal_tax_regime: string | null;
  fiscal_organization_type: string | null;
  electronic_invoicing_enabled: boolean;
  electronic_invoicing_provider: string;
  dian_software_id: string | null;
  dian_clave_tecnica: string | null;
  dian_environment: string;
  dian_software_code: string | null;
  invoice_prefix: string | null;
  invoice_consecutive_from: number | null;
  invoice_consecutive_to: number | null;
  invoice_consecutive_current: number | null;
}

async function encrypt(text: string, key: string): Promise<string> {
  const encoder = new TextEncoder();
  const keyData = encoder.encode(key.padEnd(32).slice(0, 32));
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    keyData,
    { name: "AES-GCM" },
    false,
    ["encrypt", "decrypt"]
  );
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    cryptoKey,
    encoder.encode(text)
  );
  const combined = new Uint8Array(iv.length + encrypted.byteLength);
  combined.set(iv);
  combined.set(new Uint8Array(encrypted), iv.length);
  return btoa(String.fromCharCode(...combined));
}

async function decrypt(encryptedBase64: string, key: string): Promise<string> {
  const decoder = new TextDecoder();
  const keyData = new TextEncoder().encode(key.padEnd(32).slice(0, 32));
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    keyData,
    { name: "AES-GCM" },
    false,
    ["decrypt"]
  );
  const combined = Uint8Array.from(atob(encryptedBase64), (c) => c.charCodeAt(0));
  const iv = combined.slice(0, 12);
  const data = combined.slice(12);
  const decrypted = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv },
    cryptoKey,
    data
  );
  return decoder.decode(decrypted);
}

async function getDianCertificate(
  admin: ReturnType<typeof createClient>,
  businessId: string
): Promise<{ privateKey: string; certPem: string; certificate: DianCertificateRow }> {
  if (!DIAN_CERT_ENCRYPTION_KEY) {
    throw new Error(
      "DIAN_CONFIG_MISSING: DIAN_CERT_ENCRYPTION_KEY no está configurado. Contacta al administrador."
    );
  }

  const { data, error } = await admin
    .from("dian_certificates")
    .select(
      "id, business_id, certificate_name, certificate_serial, certificate_expiration, certificate_issuer, cert_type, software_id, software_code, pin, private_key_encrypted, cert_pem_encrypted, active"
    )
    .eq("business_id", businessId)
    .eq("active", true)
    .maybeSingle();

  if (error) {
    throw new Error(`CERTIFICATE_LOOKUP_FAILED: ${error.message}`);
  }
  if (!data) {
    throw new Error(
      "DIAN_CERTIFICATE_REQUIRED: no hay certificado digital activo para este negocio. Configúralo en el panel de administración."
    );
  }

  const certRow = data as unknown as DianCertificateRow;

  if (new Date(certRow.certificate_expiration) < new Date()) {
    throw new Error(
      "DIAN_CERTIFICATE_EXPIRED: el certificado digital ha expirado. Contacta al administrador."
    );
  }

  if (!certRow.private_key_encrypted || !certRow.cert_pem_encrypted) {
    throw new Error(
      "DIAN_CERTIFICATE_NOT_CONFIGURED: el certificado no está configurado en el sistema de secretos."
    );
  }

  let privateKey: string;
  let certPem: string;

  try {
    privateKey = await decrypt(certRow.private_key_encrypted, DIAN_CERT_ENCRYPTION_KEY);
    certPem = await decrypt(certRow.cert_pem_encrypted, DIAN_CERT_ENCRYPTION_KEY);
  } catch (e) {
    throw new Error(
      "DIAN_CERTIFICATE_DECRYPT_FAILED: no se pudo desencriptar el certificado. Verifica DIAN_CERT_ENCRYPTION_KEY."
    );
  }

  return { privateKey, certPem, certificate: certRow };
}

async function buildAndSignInvoice(
  admin: ReturnType<typeof createClient>,
  request: VimdyInvoiceRequest,
  business: DianBusinessRow
): Promise<{
  signedXml: string;
  cufe: string;
  number: string;
  invoiceId: string;
  certThumbprint: string;
}> {
  if (PRODUCTION_BLOCKED && business.dian_environment === "production") {
    throw new Error(
      "PRODUCTION_BLOCKED: La transmisión a producción de DIAN está bloqueada hasta que se complete la habilitación. " +
        "Cambia dian_environment a 'sandbox' en la configuración del negocio."
    );
  }

  const { privateKey: privateKeyEnc, certPem: certPemEnc, certificate } = await getDianCertificate(
    admin,
    request.businessId
  );

  const invoiceNumber = await getNextConsecutiveNumber(admin, request.businessId);

  const dianRequest: DianInvoiceRequest = {
    saleId: request.saleId,
    businessId: request.businessId,
    business: {
      nit: business.tax_identification_number ?? "",
      verificationDigit: business.tax_verification_digit ?? "",
      legalName: business.fiscal_legal_name ?? "",
      commercialName: business.fiscal_legal_name ?? "",
      address: business.fiscal_address ?? "",
      city: business.fiscal_city ?? "",
      department: business.fiscal_department ?? "",
      phone: business.fiscal_phone ?? "",
      email: business.fiscal_email ?? "",
      country: "CO",
      organizationType:
        (business.fiscal_organization_type as "PERSONA_JURIDICA" | "PERSONA_NATURAL") ??
        "PERSONA_NATURAL",
      taxRegime: business.fiscal_tax_regime ?? "",
      taxResponsibilities: ["01"],
      softwareId: business.dian_software_id ?? "",
      softwareCode: business.dian_software_code ?? "",
      claveTecnica: business.dian_clave_tecnica ?? "",
      environment: (business.dian_environment as "sandbox" | "production") ?? "sandbox",
      invoicePrefix: business.invoice_prefix ?? "FV",
      invoiceConsecutiveFrom: business.invoice_consecutive_from ?? 1,
      invoiceConsecutiveTo: business.invoice_consecutive_to ?? 999999999,
      invoiceConsecutiveCurrent: business.invoice_consecutive_current ?? 0,
    },
    documentType: request.documentType,
    customer: {
      documentType: request.customer.documentType,
      documentNumber: request.customer.documentNumber,
      fullName: request.customer.fullName,
      email: request.customer.email,
      phone: request.customer.phone,
      address: request.customer.address,
    },
    items: request.items as any[],
    subtotal: request.subtotal,
    tax: request.tax,
    discount: request.discount,
    total: request.total,
    currency: request.currency,
    country: request.country as any,
    paymentMethod: request.paymentMethod,
    referenceInvoiceId: request.referenceInvoiceId,
  };

  if (!dianRequest.business.claveTecnica) {
    throw new Error(
      "DIAN_CONFIG_MISSING: la clave técnica (Software Security Code) es obligatoria. Regístrala en el portal DIAN."
    );
  }

  const builder = new DianXmlBuilder();
  const { xml, cufe, number: invoiceNumberResult } = await builder.buildWithNumber(
    dianRequest,
    invoiceNumber,
    crypto.randomUUID()
  );

  const { signedXml, certificateThumbprint } = await signDianInvoice(
    xml,
    privateKey,
    certPem
  );

  const invoiceId = `inv_${request.saleId}`;

  return {
    signedXml,
    cufe,
    number: invoiceNumberResult,
    invoiceId,
    certThumbprint: certificateThumbprint,
  };
}

async function getNextConsecutiveNumber(
  admin: ReturnType<typeof createClient>,
  businessId: string
): Promise<string> {
  const { data, error } = await admin.rpc("get_next_invoice_consecutive", {
    p_business_id: businessId,
  });

  if (error) {
    throw new Error(`CONSECUTIVE_FAILED: ${error.message}`);
  }

  return data as string;
}

function buildDianSoapConfig(business: DianBusinessRow, certPem: string, privateKey: string) {
  if (PRODUCTION_BLOCKED && business.dian_environment === "production") {
    throw new Error("PRODUCTION_BLOCKED: La transmisión a producción está bloqueada.");
  }

  const soapEnv =
    business.dian_environment === "production" && !PRODUCTION_BLOCKED
      ? "production"
      : "habilantation";

  return {
    environment: soapEnv as "habilantation" | "production",
    nit: business.tax_identification_number ?? "",
    softwareId: business.dian_software_id ?? "",
    softwareCode: business.dian_software_code ?? "",
    certPem,
    privateKeyPem: privateKey,
  };
}

interface VimdyInvoiceCustomer {
  documentType: "CC" | "CE" | "NIT" | "PASSPORT" | "OTHER";
  documentNumber: string;
  fullName: string;
  email?: string;
  phone?: string;
  address?: string;
}

interface VimdyInvoiceLine {
  productId: string;
  productName: string;
  quantity: number;
  price: number;
  subtotal: number;
  taxRate: number;
  taxAmount: number;
  total: number;
  unitCode?: string;
}

interface VimdyInvoiceRequest {
  saleId: string;
  businessId: string;
  provider: "dian" | "factus" | "none";
  country: string;
  documentType: "INVOICE" | "CREDIT_NOTE" | "DEBIT_NOTE";
  customer: VimdyInvoiceCustomer;
  items: VimdyInvoiceLine[];
  subtotal: number;
  tax: number;
  discount?: number;
  total: number;
  currency: string;
  paymentMethod?: string;
  referenceInvoiceId?: string;
}

interface DianFunctionResult {
  ok: true;
  invoice: {
    id: string;
    status: string;
    number?: string;
    trackingCode?: string;
    pdfUrl?: string;
    xmlUrl?: string;
    qrCode?: string;
    errorMessage?: string;
    raw?: unknown;
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
    return json(
      { error: "SERVER_CONFIG_MISSING: faltan SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY" },
      500
    );
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

      const { data: activeData, error: activeError } = await admin.rpc(
        "is_business_subscription_active",
        { p_business_id: request.businessId }
      );

      if (activeError || !activeData) {
        return json(
          {
            error:
              "SUBSCRIPTION_EXPIRED: la suscripción del negocio ha vencido. Selecciona un plan para continuar.",
          },
          403
        );
      }

      const { data: business, error: businessError } = await admin
        .from("businesses")
        .select(
          `tax_identification_number, tax_verification_digit, fiscal_legal_name,
           fiscal_address, fiscal_city, fiscal_department, fiscal_phone,
           fiscal_email, fiscal_tax_regime, fiscal_organization_type,
           electronic_invoicing_enabled, electronic_invoicing_provider,
           dian_software_id, dian_clave_tecnica, dian_environment,
           dian_software_code, invoice_prefix, invoice_consecutive_from,
           invoice_consecutive_to, invoice_consecutive_current`
        )
        .eq("id", request.businessId)
        .maybeSingle();

      if (businessError) {
        return json({ error: "BUSINESS_LOOKUP_FAILED", detail: businessError.message }, 500);
      }
      if (!business) {
        return json({ error: "BUSINESS_NOT_FOUND" }, 404);
      }

      const biz = business as unknown as DianBusinessRow;

      if (!biz.electronic_invoicing_enabled || biz.electronic_invoicing_provider !== "dian") {
        return json(
          {
            error:
              "DIAN_NOT_ENABLED: el negocio no tiene la facturación electrónica por DIAN habilitada.",
          },
          403
        );
      }

      if (PRODUCTION_BLOCKED && biz.dian_environment === "production") {
        return json(
          {
            error:
              "PRODUCTION_BLOCKED: la transmisión a producción de DIAN está bloqueada hasta que se complete la habilitación. " +
                "Cambia dian_environment a 'sandbox' en la configuración del negocio.",
          },
          403
        );
      }

      const idempotencyKey = request.saleId;

      const { data: existing } = await admin
        .from("electronic_invoices")
        .select("id, status, cufe, invoice_number")
        .eq("sale_id", request.saleId)
        .eq("business_id", request.businessId)
        .maybeSingle();

      if (existing) {
        return json({
          ok: true,
          invoice: {
            id: existing.id,
            status: existing.status,
            number: existing.invoice_number,
            trackingCode: existing.cufe,
            errorMessage:
              existing.status === "error"
                ? "Factura ya fue creada previamente."
                : undefined,
            raw: { idempotency: true },
          },
        });
      }

      const { data: saleRow, error: saleLookupError } = await admin
        .from("sales")
        .select("data, business_id")
        .eq("id", request.saleId)
        .eq("business_id", request.businessId)
        .maybeSingle();

      if (saleLookupError) {
        return json({ error: "SALE_LOOKUP_FAILED", detail: saleLookupError.message }, 500);
      }
      if (!saleRow) {
        return json({ error: "SALE_NOT_FOUND" }, 404);
      }

      const saleData = (saleRow.data as Record<string, unknown> | null) ?? {};
      const saleItems = (saleData.items as VimdyInvoiceLine[] | null) ?? [];

      const productIds = saleItems.map((item) => item.productId).filter(Boolean);
      const { data: products } = await admin
        .from("products")
        .select("id, name")
        .in("id", productIds);

      const productNameMap = new Map((products ?? []).map((p) => [p.id, p.name]));

      const enrichedItems = saleItems.map((item) => ({
        ...item,
        productName:
          productNameMap.get(item.productId) || item.productName || item.productId,
      }));

      const authoritativeRequest: VimdyInvoiceRequest = {
        ...request,
        items: enrichedItems.length > 0 ? enrichedItems : request.items,
        subtotal:
          typeof saleData.subtotal === "number" ? saleData.subtotal : request.subtotal,
        tax: typeof saleData.tax === "number" ? saleData.tax : request.tax,
        discount:
          typeof saleData.discount === "number" ? saleData.discount : request.discount,
        total: typeof saleData.total === "number" ? saleData.total : request.total,
        paymentMethod:
          typeof saleData.paymentMethod === "string"
            ? saleData.paymentMethod
            : request.paymentMethod,
      };

      let signedXml: string;
      let cufe: string;
      let invoiceNumber: string;
      let invoiceId: string;
      let certThumbprint: string;

      const invoiceEnvironment =
        biz.dian_environment === "production" && !PRODUCTION_BLOCKED
          ? "production"
          : "sandbox";

      try {
        const result = await buildAndSignInvoice(admin, authoritativeRequest, biz);
        signedXml = result.signedXml;
        cufe = result.cufe;
        invoiceNumber = result.number;
        invoiceId = result.invoiceId;
        certThumbprint = result.certThumbprint;
      } catch (signError) {
        const errorMessage = (signError as Error).message;

        await admin.from("electronic_invoices").insert({
          id: `inv_${request.saleId}`,
          business_id: request.businessId,
          sale_id: request.saleId,
          provider: "dian",
          environment: invoiceEnvironment,
          status: "error",
          document_type: request.documentType,
          prefix: biz.invoice_prefix ?? "FV",
          invoice_number: null,
          cufe: null,
          tracking_code: null,
          qr_code: null,
          customer_document_type: request.customer.documentType,
          customer_document_number: request.customer.documentNumber,
          customer_name: request.customer.fullName,
          subtotal: authoritativeRequest.subtotal,
          tax: authoritativeRequest.tax,
          total: authoritativeRequest.total,
          error_message: `SIGNING_FAILED: ${errorMessage}`,
          attempt_count: 1,
          last_attempt_at: new Date().toISOString(),
          issued_at: null,
        });

        return json(
          {
            ok: false,
            error: `SIGNING_FAILED: ${errorMessage}`,
          },
          500
        );
      }

      let soapClient: DianSoapClient;
      try {
        const { privateKey, certPem } = await getDianCertificate(admin, request.businessId);
        const soapEnv =
          biz.dian_environment === "production" && !PRODUCTION_BLOCKED
            ? "production"
            : "habilantation";
        soapClient = new DianSoapClient({
          environment: soapEnv as "habilantation" | "production",
          nit: biz.tax_identification_number ?? "",
          softwareId: biz.dian_software_id ?? "",
          softwareCode: biz.dian_software_code ?? "",
          certPem,
          privateKeyPem: privateKey,
        });
      } catch (certError) {
        return json(
          {
            ok: false,
            error: `CERTIFICATE_FAILED: ${(certError as Error).message}`,
          },
          500
        );
      }

      const documentKey = `${biz.tax_identification_number ?? ""}_${invoiceNumber.replace(
        biz.invoice_prefix ?? "FV",
        ""
      )}_${cufe}`;

      const transmitStartTime = new Date();

      let transmitResult: {
        status: "ACCEPTED" | "REJECTED" | "PENDING" | "ERROR";
        responseCode: string;
        responseMessage: string;
        cufe?: string;
        errors?: Array<{ code: string; message: string; field?: string }>;
        rawXml: string;
      };

      try {
        transmitResult = await soapClient.sendBill(signedXml, documentKey);
      } catch (netError) {
        const errMsg = (netError as Error).message;

        await admin.from("electronic_invoices").upsert({
          id: invoiceId,
          business_id: request.businessId,
          sale_id: request.saleId,
          provider: "dian",
          environment: invoiceEnvironment,
          status: "pending",
          document_type: request.documentType,
          prefix: biz.invoice_prefix ?? "FV",
          invoice_number: invoiceNumber,
          cufe,
          tracking_code: cufe,
          qr_code: `https://www.dian.gov.co/consulta-titu-factura/${cufe}`,
          customer_document_type: request.customer.documentType,
          customer_document_number: request.customer.documentNumber,
          customer_name: request.customer.fullName,
          subtotal: authoritativeRequest.subtotal,
          tax: authoritativeRequest.tax,
          total: authoritativeRequest.total,
          signed_xml: signedXml,
          idempotency_key: idempotencyKey,
          dian_response_status: "transmitted",
          dian_response_code: null,
          transmitted_at: transmitStartTime.toISOString(),
          certificate_id: undefined,
          error_message: null,
          attempt_count: 1,
          last_attempt_at: transmitStartTime.toISOString(),
          issued_at: transmitStartTime.toISOString(),
          updated_at: new Date().toISOString(),
        });

        await admin.from("electronic_invoice_jobs").insert({
          business_id: request.businessId,
          invoice_id: invoiceId,
          attempt_count: 1,
          status: "pending",
          next_retry_at: new Date(Date.now() + 60000).toISOString(),
          last_error: errMsg,
          payload: { idempotencyKey, documentKey, signedXml: "REDACTED" },
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        });

        return json({
          ok: true,
          invoice: {
            id: invoiceId,
            status: "pending",
            number: invoiceNumber,
            trackingCode: cufe,
            qrCode: `https://www.dian.gov.co/consulta-titu-factura/${cufe}`,
            errorMessage: undefined,
            raw: { transmitError: errMsg, retryScheduled: true },
          },
        });
      }

      const transmitEndTime = new Date();
      const finalStatus =
        transmitResult.status === "ACCEPTED"
          ? "accepted"
          : transmitResult.status === "PENDING"
            ? "pending"
            : transmitResult.status === "REJECTED"
              ? "rejected"
              : "error";

      let errorMessage: string | undefined;
      if (finalStatus === "rejected") {
        errorMessage = transmitResult.errors
          ?.map((e) => `${e.code}: ${e.message}`)
          .join(" | ");
      } else if (finalStatus === "error") {
        errorMessage = transmitResult.responseMessage ?? "Error de transmisión a DIAN";
      }

      await admin.from("electronic_invoices").upsert({
        id: invoiceId,
        business_id: request.businessId,
        sale_id: request.saleId,
        provider: "dian",
        environment: invoiceEnvironment,
        status: finalStatus,
        document_type: request.documentType,
        prefix: biz.invoice_prefix ?? "FV",
        invoice_number: invoiceNumber,
        cufe,
        tracking_code: cufe,
        qr_code: `https://www.dian.gov.co/consulta-titu-factura/${cufe}`,
        customer_document_type: request.customer.documentType,
        customer_document_number: request.customer.documentNumber,
        customer_name: request.customer.fullName,
        subtotal: authoritativeRequest.subtotal,
        tax: authoritativeRequest.tax,
        total: authoritativeRequest.total,
        signed_xml: signedXml,
        idempotency_key: idempotencyKey,
        dian_response_status: transmitResult.status,
        dian_response_code: transmitResult.responseCode,
        transmitted_at: transmitEndTime.toISOString(),
        certificate_id: undefined,
        error_code: transmitResult.responseCode || null,
        error_message: errorMessage,
        attempt_count: 1,
        last_attempt_at: transmitEndTime.toISOString(),
        issued_at: transmitStartTime.toISOString(),
        validated_at: finalStatus === "accepted" ? transmitEndTime.toISOString() : null,
        updated_at: new Date().toISOString(),
      });

      return json({
        ok: true,
        invoice: {
          id: invoiceId,
          status: finalStatus,
          number: invoiceNumber,
          trackingCode: cufe,
          qrCode: `https://www.dian.gov.co/consulta-titu-factura/${cufe}`,
          errorMessage,
          raw: {
            xml: signedXml,
            dianResponse: transmitResult.rawXml,
            responseCode: transmitResult.responseCode,
            responseMessage: transmitResult.responseMessage,
          },
        },
      });
    }

    if (payload.action === "get" || payload.action === "cancel") {
      const invoiceId = payload.invoiceId?.trim();
      if (!invoiceId) {
        return json({ error: "Falta el campo: invoiceId es obligatorio." }, 400);
      }

      const { data: row, error: lookupError } = await admin
        .from("electronic_invoices")
        .select(
          "business_id, status, invoice_number, cufe, qr_code, error_message, raw_response, dian_response_status, dian_response_code, transmitted_at"
        )
        .eq("id", invoiceId)
        .maybeSingle();

      if (lookupError) {
        return json({ error: "INVOICE_LOOKUP_FAILED", detail: lookupError.message }, 500);
      }
      if (!row) {
        return json({ error: "INVOICE_NOT_FOUND" }, 404);
      }

      await assertMembership(row.business_id);

      if (payload.action === "get") {
        let refreshedStatus = row.status as string;
        let refreshedResponseCode = row.dian_response_code;
        let refreshedResponseStatus = row.dian_response_status;

        if (["pending", "transmitted"].includes(row.status as string)) {
          try {
            const { data: bizData, error: bizError } = await admin
              .from("businesses")
              .select(
                "tax_identification_number, dian_software_id, dian_software_code, dian_environment"
              )
              .eq("id", row.business_id)
              .maybeSingle();

            if (!bizError && bizData) {
              const bizForSoap = bizData as unknown as DianBusinessRow;

              if (PRODUCTION_BLOCKED && bizForSoap.dian_environment === "production") {
                return json(
                  {
                    error:
                      "PRODUCTION_BLOCKED: no se pueden consultar documentos de producción.",
                  },
                  403
                );
              }

              const { privateKey, certPem } = await getDianCertificate(
                admin,
                row.business_id
              );
              const soapEnv =
                bizForSoap.dian_environment === "production" && !PRODUCTION_BLOCKED
                  ? "production"
                  : "habilantation";

              const soapClient = new DianSoapClient({
                environment: soapEnv as "habilantation" | "production",
                nit: bizForSoap.tax_identification_number ?? "",
                softwareId: bizForSoap.dian_software_id ?? "",
                softwareCode: bizForSoap.dian_software_code ?? "",
                certPem,
                privateKeyPem: privateKey,
              });

              const statusResult = await soapClient.getStatus(row.cufe ?? invoiceId);
              refreshedStatus =
                statusResult.status === "ACCEPTED"
                  ? "accepted"
                  : statusResult.status === "REJECTED"
                    ? "rejected"
                    : statusResult.status === "PENDING"
                      ? "pending"
                      : row.status as string;
              refreshedResponseStatus = statusResult.status;
              refreshedResponseCode = statusResult.responseCode;

              await admin
                .from("electronic_invoices")
                .update({
                  status: refreshedStatus,
                  dian_response_status: refreshedResponseStatus,
                  dian_response_code: refreshedResponseCode,
                  validated_at:
                    refreshedStatus === "accepted" ? new Date().toISOString() : undefined,
                  updated_at: new Date().toISOString(),
                })
                .eq("id", invoiceId);
            }
          } catch (refreshError) {
            console.error(
              "GetStatus refresh failed:",
              (refreshError as Error).message
            );
          }
        }

        return json({
          ok: true,
          invoice: {
            id: invoiceId,
            status: refreshedStatus,
            number: row.invoice_number,
            trackingCode: row.cufe,
            qrCode: row.qr_code,
            errorMessage: row.error_message,
            raw: row.raw_response,
          },
        });
      }

      if (payload.action === "cancel") {
        if (row.status === "accepted") {
          return json(
            {
              error:
                "INVOICE_ALREADY_VALIDATED: esta factura ya fue validada ante la DIAN y no se puede anular — se necesita una nota crédito.",
            },
            409
          );
        }

        if (payload.reason) {
          await admin
            .from("electronic_invoices")
            .update({
              status: "cancelled",
              error_message: `Anulada por: ${payload.reason}`,
              updated_at: new Date().toISOString(),
            })
            .eq("id", invoiceId);
        }

        return json({
          ok: true,
          invoice: {
            id: invoiceId,
            status: "cancelled",
            number: row.invoice_number,
            trackingCode: row.cufe,
            qrCode: row.qr_code,
            errorMessage: payload.reason
              ? `Anulada: ${payload.reason}`
              : "Documento anulado",
            raw: null,
          },
        });
      }
    }

    return json({ error: "INVALID_ACTION" }, 400);
  } catch (error) {
    const errorMessage = (error as Error).message ?? "DIAN_UNKNOWN_ERROR";
    return json(
      { error: errorMessage, errorType: error instanceof Error ? error.constructor.name : "unknown" },
      500
    );
  }
});
