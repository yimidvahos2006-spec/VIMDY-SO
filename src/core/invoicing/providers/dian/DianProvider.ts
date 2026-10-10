/**
 * DianProvider.ts
 * ---------------------------------------------------------------------------
 * Adaptador de navegador para el proveedor DIAN de VIMDY.
 *
 * El navegador NO:
 *   - firma XML;
 *   - contiene certificado digital;
 *   - contiene clave técnica;
 *   - contiene software PIN/ID secreto;
 *   - transmite SOAP directamente a DIAN.
 *
 * Todo ese material y el transporte fiscal real viven en:
 *   supabase/functions/dian-invoice
 *
 * Este provider solo cumple el contrato IInvoiceProvider y normaliza las
 * respuestas/errors del servidor a InvoiceResult.
 */

import { supabase } from "../../../../infrastructure/supabase/supabaseClient";
import type { IInvoiceProvider } from "../../interfaces/IInvoiceProvider";
import type {
  CountryCode,
  InvoiceProviderName,
  InvoiceStatus
} from "../../types/invoice.types";
import type {
  InvoiceRequest,
  InvoiceResult
} from "../../models/InvoiceModels";
import { nowIso } from "../../utils/invoiceUtils";

const DIAN_COUNTRY: CountryCode = "CO";
const DIAN_CURRENCY = "COP";

interface DianInvoicePayload {
  id: string;
  status: InvoiceStatus;
  number?: string;
  trackingCode?: string;
  cufe?: string;
  pdfUrl?: string;
  xmlUrl?: string;
  qrCode?: string;
  createdAt?: string;
  errorCode?: string;
  errorMessage?: string;
  raw?: unknown;
}

interface DianFunctionResult {
  ok: boolean;
  invoice?: DianInvoicePayload;
  error?: string;
  detail?: string;
  code?: string;
}

interface FunctionErrorContext {
  context?: Response;
  message?: string;
}

const DIAN_SERVER_ERROR_MAP: Record<string, string> = {
  DIAN_CREDENTIALS_MISSING:
    "Faltan las credenciales fiscales requeridas para transmitir a DIAN.",
  DIAN_CERTIFICATE_MISSING:
    "No hay certificado digital DIAN configurado para este negocio.",
  DIAN_CERTIFICATE_EXPIRED:
    "El certificado digital configurado para DIAN está vencido.",
  DIAN_NUMBERING_RANGE_MISSING:
    "No hay un rango de numeración DIAN disponible para emitir la factura.",
  DIAN_NUMBERING_RANGE_EXHAUSTED:
    "El rango de numeración DIAN configurado se agotó.",
  DIAN_XML_INVALID:
    "El documento XML fiscal no cumple las reglas requeridas antes de ser transmitido.",
  DIAN_SIGNATURE_INVALID:
    "La firma digital del documento fue rechazada o no pudo validarse.",
  DIAN_AUTH_FAILED:
    "La autenticación del software ante DIAN falló.",
  DIAN_TRANSMISSION_FAILED:
    "DIAN no pudo recibir el documento en este intento.",
  DIAN_VALIDATION_REJECTED:
    "DIAN rechazó la factura durante la validación.",
  DIAN_DUPLICATE_DOCUMENT:
    "La factura ya fue transmitida o existe un documento con la misma identidad.",
  DIAN_INVOICE_NOT_FOUND:
    "No existe la factura electrónica solicitada en VIMDY.",
  DIAN_ALREADY_VALIDATED:
    "La factura ya fue validada; para reversarla debe utilizarse el mecanismo fiscal correspondiente.",
  DIAN_CANCELLATION_NOT_ALLOWED:
    "La operación de anulación no está permitida para el estado actual de la factura."
};

async function extractFunctionErrorMessage(
  fnError: unknown,
  fallback: string
): Promise<string> {
  const candidate =
    fnError as FunctionErrorContext | null;
  const context = candidate?.context;

  if (
    context &&
    typeof context.json === "function"
  ) {
    try {
      const body =
        (await context.json()) as {
          error?: unknown;
          detail?: unknown;
          code?: unknown;
        };

      const code =
        typeof body.code === "string"
          ? body.code.trim()
          : typeof body.error === "string"
            ? body.error.trim()
            : "";

      const mapped =
        DIAN_SERVER_ERROR_MAP[code];

      if (mapped) {
        const detail =
          typeof body.detail === "string"
            ? body.detail.trim()
            : "";

        return detail
          ? `${mapped} Detalle: ${detail}`
          : mapped;
      }

      if (
        typeof body.error === "string" &&
        body.error.trim()
      ) {
        return typeof body.detail === "string" && body.detail.trim()
          ? `${body.error.trim()}: ${body.detail.trim()}`
          : body.error.trim();
      }
    } catch {
      // El body de la Edge Function puede no ser JSON legible.
    }
  }

  if (
    typeof candidate?.message === "string" &&
    candidate.message.trim()
  ) {
    return candidate.message.trim();
  }

  return fallback;
}

function normalizeCountry(
  country: CountryCode
): CountryCode {
  return country.trim().toUpperCase() as CountryCode;
}

function normalizeCurrency(
  currency: string
): string {
  return currency.trim().toUpperCase();
}

function validateCreateRequest(
  request: InvoiceRequest
): void {
  if (!request.saleId?.trim()) {
    throw new Error(
      "DIAN_SALE_ID_REQUIRED"
    );
  }

  if (!request.businessId?.trim()) {
    throw new Error(
      "DIAN_BUSINESS_ID_REQUIRED"
    );
  }

  if (request.provider !== "dian") {
    throw new Error(
      "DIAN_PROVIDER_MISMATCH"
    );
  }

  if (
    normalizeCountry(request.country) !==
    DIAN_COUNTRY
  ) {
    throw new Error(
      "DIAN_COUNTRY_NOT_SUPPORTED: DIAN en VIMDY está habilitada para Colombia."
    );
  }

  if (
    normalizeCurrency(request.currency) !==
    DIAN_CURRENCY
  ) {
    throw new Error(
      `DIAN_CURRENCY_NOT_SUPPORTED: se esperaba ${DIAN_CURRENCY}.`
    );
  }

  if (
    !Number.isFinite(request.subtotal) ||
    request.subtotal < 0
  ) {
    throw new Error(
      "DIAN_SUBTOTAL_INVALID"
    );
  }

  if (
    !Number.isFinite(request.tax) ||
    request.tax < 0
  ) {
    throw new Error(
      "DIAN_TAX_INVALID"
    );
  }

  if (
    !Number.isFinite(request.total) ||
    request.total <= 0
  ) {
    throw new Error(
      "DIAN_TOTAL_INVALID"
    );
  }

  if (
    !Array.isArray(request.items) ||
    request.items.length === 0
  ) {
    throw new Error(
      "DIAN_ITEMS_REQUIRED"
    );
  }

  for (const item of request.items) {
    if (!item.productId?.trim()) {
      throw new Error(
        "DIAN_ITEM_PRODUCT_REQUIRED"
      );
    }

    if (
      !Number.isFinite(item.quantity) ||
      item.quantity <= 0
    ) {
      throw new Error(
        "DIAN_ITEM_QUANTITY_INVALID"
      );
    }

    if (
      !Number.isFinite(item.price) ||
      item.price < 0
    ) {
      throw new Error(
        "DIAN_ITEM_PRICE_INVALID"
      );
    }
  }

  if (!request.customer.documentNumber?.trim()) {
    throw new Error(
      "DIAN_CUSTOMER_DOCUMENT_REQUIRED"
    );
  }

  if (!request.customer.fullName?.trim()) {
    throw new Error(
      "DIAN_CUSTOMER_NAME_REQUIRED"
    );
  }
}

function assertFunctionResult(
  data: DianFunctionResult
): asserts data is DianFunctionResult & {
  ok: true;
  invoice: DianInvoicePayload;
} {
  if (!data?.ok || !data.invoice) {
    throw new Error(
      `DIAN_INVALID_FUNCTION_RESPONSE: ${data?.error ?? data?.detail ?? "respuesta sin invoice"}`
    );
  }

  if (!data.invoice.id?.trim()) {
    throw new Error(
      "DIAN_INVALID_INVOICE_ID"
    );
  }

  if (
    data.invoice.status === "accepted" &&
    !data.invoice.number?.trim()
  ) {
    throw new Error(
      "DIAN_ACCEPTED_WITHOUT_NUMBER"
    );
  }

  if (
    data.invoice.status === "accepted" &&
    !(
      data.invoice.trackingCode?.trim() ||
      data.invoice.cufe?.trim()
    )
  ) {
    throw new Error(
      "DIAN_ACCEPTED_WITHOUT_CUFE"
    );
  }
}

function assertHttpsUrl(
  value: string | undefined,
  field: string
): string | undefined {
  if (!value) {
    return undefined;
  }

  try {
    const url = new URL(value);

    if (url.protocol !== "https:") {
      throw new Error();
    }

    return url.toString();
  } catch {
    throw new Error(
      `DIAN_INVALID_${field.toUpperCase()}_URL`
    );
  }
}

function normalizeStatus(
  payload: DianInvoicePayload
): InvoiceStatus {
  if (payload.status) {
    return payload.status;
  }

  if (
    payload.errorCode ||
    payload.errorMessage
  ) {
    return "error";
  }

  return "pending";
}

export class DianProvider
  implements IInvoiceProvider
{
  readonly name: InvoiceProviderName =
    "dian";

  async createInvoice(
    request: InvoiceRequest
  ): Promise<InvoiceResult> {
    validateCreateRequest(request);

    const { data, error } =
      await supabase.functions.invoke<DianFunctionResult>(
        "dian-invoice",
        {
          body: {
            action: "create",
            request
          }
        }
      );

    if (error) {
      throw new Error(
        await extractFunctionErrorMessage(
          error,
          "No se pudo emitir la factura electrónica con DIAN."
        )
      );
    }

    if (!data) {
      throw new Error(
        "DIAN_EMPTY_RESPONSE: DIAN no devolvió ninguna respuesta."
      );
    }

    assertFunctionResult(data);

    return this.toInvoiceResult(
      data.invoice
    );
  }

  async getInvoice(
    invoiceId: string
  ): Promise<InvoiceResult> {
    const normalizedId =
      invoiceId?.trim();

    if (!normalizedId) {
      throw new Error(
        "DIAN_INVOICE_ID_REQUIRED"
      );
    }

    const { data, error } =
      await supabase.functions.invoke<DianFunctionResult>(
        "dian-invoice",
        {
          body: {
            action: "get",
            invoiceId: normalizedId
          }
        }
      );

    if (error) {
      throw new Error(
        await extractFunctionErrorMessage(
          error,
          "No se pudo consultar la factura en DIAN."
        )
      );
    }

    if (!data) {
      throw new Error(
        "DIAN_EMPTY_RESPONSE: DIAN no devolvió ninguna respuesta al consultar la factura."
      );
    }

    assertFunctionResult(data);

    return this.toInvoiceResult(
      data.invoice
    );
  }

  async cancelInvoice(
    invoiceId: string,
    reason: string
  ): Promise<InvoiceResult> {
    const normalizedId =
      invoiceId?.trim();
    const normalizedReason =
      reason?.trim();

    if (!normalizedId) {
      throw new Error(
        "DIAN_INVOICE_ID_REQUIRED"
      );
    }

    if (!normalizedReason) {
      throw new Error(
        "DIAN_CANCEL_REASON_REQUIRED"
      );
    }

    const { data, error } =
      await supabase.functions.invoke<DianFunctionResult>(
        "dian-invoice",
        {
          body: {
            action: "cancel",
            invoiceId: normalizedId,
            reason: normalizedReason
          }
        }
      );

    if (error) {
      throw new Error(
        await extractFunctionErrorMessage(
          error,
          "No se pudo anular la factura en DIAN."
        )
      );
    }

    if (!data) {
      throw new Error(
        "DIAN_EMPTY_RESPONSE: DIAN no devolvió ninguna respuesta al anular la factura."
      );
    }

    assertFunctionResult(data);

    return this.toInvoiceResult(
      data.invoice
    );
  }

  supportsCountry(
    country: CountryCode
  ): boolean {
    return (
      normalizeCountry(country) ===
      DIAN_COUNTRY
    );
  }

  validateResponse(
    _payload: unknown,
    _signature?: string
  ): boolean {
    /*
     * La validación criptográfica de DIAN vive server-side junto con el
     * certificado y la firma. El navegador no debe intentar verificar ni
     * poseer material privado del proveedor fiscal.
     */
    return false;
  }

  private toInvoiceResult(
    invoice: DianInvoicePayload
  ): InvoiceResult {
    const trackingCode =
      invoice.trackingCode?.trim() ||
      invoice.cufe?.trim() ||
      undefined;

    return {
      id: invoice.id,
      provider: "dian",
      status: normalizeStatus(invoice),
      number: invoice.number,
      trackingCode,
      pdfUrl: assertHttpsUrl(
        invoice.pdfUrl,
        "pdf_url"
      ),
      xmlUrl: assertHttpsUrl(
        invoice.xmlUrl,
        "xml_url"
      ),
      qrCode: invoice.qrCode,
      createdAt:
        invoice.createdAt ?? nowIso(),
      errorMessage:
        invoice.errorMessage,
      raw: {
        original: invoice.raw,
        errorCode:
          invoice.errorCode
      }
    };
  }
}
