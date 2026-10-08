/**
 * FactusProvider.ts
 * ---------------------------------------------------------------------------
 * Adaptador de navegador para Factus API V2.
 *
 * Seguridad:
 *   - NO contiene client_id, client_secret, username, password ni OAuth token.
 *   - Todas las llamadas HTTP privadas contra Factus ocurren en la Edge
 *     Function `factus-invoice`.
 *
 * Responsabilidad de este adapter:
 *   1. Validar el contrato agnóstico InvoiceRequest.
 *   2. Invocar la Edge Function server-side.
 *   3. Validar la forma mínima de la respuesta.
 *   4. Normalizar Factus -> InvoiceResult.
 *
 * El cálculo fiscal autoritativo vive en servidor. El navegador no recalcula
 * ni reescribe el importe que se factura.
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

const FACTUS_COUNTRY: CountryCode = "CO";
const FACTUS_CURRENCY = "COP";
const MONEY_EPSILON = 0.005;

interface FactusInvoicePayload {
  id: string;
  status: InvoiceStatus;
  number?: string;
  reference_code?: string;
  cufe?: string;
  trackingCode?: string;
  pdfUrl?: string;
  pdfPath?: string;
  xmlUrl?: string;
  xmlPath?: string;
  qrCode?: string;
  createdAt?: string;
  errorMessage?: string;
  raw?: unknown;
}

interface FactusFunctionResult {
  ok: boolean;
  invoice?: FactusInvoicePayload;
  error?: string;
  detail?: string;
}

interface FunctionErrorContext {
  context?: Response;
  message?: string;
}

async function extractFunctionErrorMessage(
  fnError: unknown,
  fallback: string
): Promise<string> {
  const candidate = fnError as FunctionErrorContext | null;
  const context = candidate?.context;

  if (context && typeof context.json === "function") {
    try {
      const body = (await context.json()) as {
        error?: unknown;
        detail?: unknown;
      };

      if (
        typeof body.error === "string" &&
        body.error.trim()
      ) {
        if (
          typeof body.detail === "string" &&
          body.detail.trim()
        ) {
          return `${body.error}: ${body.detail}`;
        }

        return body.error;
      }
    } catch {
      // Algunas respuestas de Supabase Functions no tienen un body JSON legible.
    }
  }

  if (
    typeof candidate?.message === "string" &&
    candidate.message.trim()
  ) {
    return candidate.message;
  }

  return fallback;
}

function normalizeCountry(country: CountryCode): CountryCode {
  return country.trim().toUpperCase() as CountryCode;
}

function normalizeCurrency(currency: string): string {
  return currency.trim().toUpperCase();
}

function assertFiniteMoney(
  value: number,
  field: string,
  allowZero = true
): void {
  if (!Number.isFinite(value)) {
    throw new Error(
      `FACTUS_${field.toUpperCase()}_INVALID`
    );
  }

  if (allowZero && value < 0) {
    throw new Error(
      `FACTUS_${field.toUpperCase()}_INVALID`
    );
  }

  if (!allowZero && value <= 0) {
    throw new Error(
      `FACTUS_${field.toUpperCase()}_INVALID`
    );
  }
}

function validateInvoiceRequest(
  request: InvoiceRequest
): void {
  if (!request.saleId?.trim()) {
    throw new Error("FACTUS_SALE_ID_REQUIRED");
  }

  if (!request.businessId?.trim()) {
    throw new Error("FACTUS_BUSINESS_ID_REQUIRED");
  }

  if (request.provider !== "factus") {
    throw new Error("FACTUS_PROVIDER_MISMATCH");
  }

  if (
    normalizeCountry(request.country) !==
    FACTUS_COUNTRY
  ) {
    throw new Error(
      "FACTUS_COUNTRY_NOT_SUPPORTED: Factus en VIMDY está habilitado para Colombia."
    );
  }

  if (
    normalizeCurrency(request.currency) !==
    FACTUS_CURRENCY
  ) {
    throw new Error(
      `FACTUS_CURRENCY_NOT_SUPPORTED: se esperaba ${FACTUS_CURRENCY}.`
    );
  }

  if (request.documentType !== "INVOICE") {
    throw new Error(
      `FACTUS_DOCUMENT_TYPE_NOT_SUPPORTED: ${request.documentType} requiere el endpoint específico de nota crédito/débito, no el endpoint de factura estándar.`
    );
  }

  assertFiniteMoney(request.subtotal, "subtotal");
  assertFiniteMoney(request.tax, "tax");
  assertFiniteMoney(request.discount ?? 0, "discount");
  assertFiniteMoney(request.total, "total", false);

  if (!Array.isArray(request.items) || request.items.length === 0) {
    throw new Error("FACTUS_ITEMS_REQUIRED");
  }

  for (const item of request.items) {
    if (!item.productId?.trim()) {
      throw new Error(
        "FACTUS_ITEM_PRODUCT_REQUIRED"
      );
    }

    if (
      !Number.isFinite(item.quantity) ||
      item.quantity <= 0
    ) {
      throw new Error(
        "FACTUS_ITEM_QUANTITY_INVALID"
      );
    }

    if (
      !Number.isFinite(item.price) ||
      item.price < 0
    ) {
      throw new Error(
        "FACTUS_ITEM_PRICE_INVALID"
      );
    }
  }

  if (!request.customer.documentNumber?.trim()) {
    throw new Error(
      "FACTUS_CUSTOMER_DOCUMENT_REQUIRED"
    );
  }

  if (!request.customer.fullName?.trim()) {
    throw new Error(
      "FACTUS_CUSTOMER_NAME_REQUIRED"
    );
  }
}

function assertInvoicePayload(
  data: FactusFunctionResult
): asserts data is FactusFunctionResult & {
  ok: true;
  invoice: FactusInvoicePayload;
} {
  if (!data?.ok || !data.invoice) {
    throw new Error(
      `FACTUS_INVALID_FUNCTION_RESPONSE: ${data?.error ?? data?.detail ?? "respuesta sin invoice"}`
    );
  }

  if (!data.invoice.id?.trim()) {
    throw new Error(
      "FACTUS_INVALID_INVOICE_ID"
    );
  }

  if (
    data.invoice.status === "accepted" &&
    !data.invoice.number?.trim()
  ) {
    throw new Error(
      "FACTUS_ACCEPTED_WITHOUT_NUMBER"
    );
  }

  if (
    data.invoice.status === "accepted" &&
    !(data.invoice.cufe?.trim() || data.invoice.trackingCode?.trim())
  ) {
    throw new Error(
      "FACTUS_ACCEPTED_WITHOUT_CUFE"
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
      `FACTUS_INVALID_${field.toUpperCase()}_URL`
    );
  }
}

export class FactusProvider
  implements IInvoiceProvider
{
  readonly name: InvoiceProviderName =
    "factus";

  async createInvoice(
    request: InvoiceRequest
  ): Promise<InvoiceResult> {
    validateInvoiceRequest(request);

    const { data, error } =
      await supabase.functions.invoke<FactusFunctionResult>(
        "factus-invoice",
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
          "No se pudo emitir la factura electrónica con Factus."
        )
      );
    }

    if (!data) {
      throw new Error(
        "FACTUS_EMPTY_RESPONSE: Factus no devolvió ninguna respuesta."
      );
    }

    assertInvoicePayload(data);

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
        "FACTUS_INVOICE_ID_REQUIRED"
      );
    }

    const { data, error } =
      await supabase.functions.invoke<FactusFunctionResult>(
        "factus-invoice",
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
          "No se pudo consultar la factura en Factus."
        )
      );
    }

    if (!data) {
      throw new Error(
        "FACTUS_EMPTY_RESPONSE: Factus no devolvió ninguna respuesta al consultar la factura."
      );
    }

    assertInvoicePayload(data);

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
        "FACTUS_INVOICE_ID_REQUIRED"
      );
    }

    if (!normalizedReason) {
      throw new Error(
        "FACTUS_CANCEL_REASON_REQUIRED"
      );
    }

    const { data, error } =
      await supabase.functions.invoke<FactusFunctionResult>(
        "factus-invoice",
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
          "No se pudo anular la factura en Factus."
        )
      );
    }

    if (!data) {
      throw new Error(
        "FACTUS_EMPTY_RESPONSE: Factus no devolvió ninguna respuesta al anular la factura."
      );
    }

    assertInvoicePayload(data);

    return this.toInvoiceResult(
      data.invoice
    );
  }

  supportsCountry(
    country: CountryCode
  ): boolean {
    return (
      normalizeCountry(country) ===
      FACTUS_COUNTRY
    );
  }

  validateResponse(
    _payload: unknown,
    _signature?: string
  ): boolean {
    /*
     * La autenticidad y firma de las respuestas/webhooks se valida server-side.
     * Este adapter no posee client_secret ni material criptográfico de Factus.
     */
    return false;
  }

  private toInvoiceResult(
    invoice: FactusInvoicePayload
  ): InvoiceResult {
    const trackingCode =
      invoice.cufe?.trim() ||
      invoice.trackingCode?.trim() ||
      undefined;

    const pdfUrl =
      assertHttpsUrl(
        invoice.pdfUrl,
        "pdf_url"
      );

    const xmlUrl =
      assertHttpsUrl(
        invoice.xmlUrl,
        "xml_url"
      );

    return {
      id: invoice.id,
      provider: "factus",
      status: invoice.status,
      number: invoice.number,
      trackingCode,
      pdfUrl,
      xmlUrl,
      qrCode: invoice.qrCode,
      createdAt:
        invoice.createdAt ?? nowIso(),
      errorMessage:
        invoice.errorMessage,
      raw: {
        original: invoice.raw,
        referenceCode:
          invoice.reference_code,
        pdfPath:
          invoice.pdfPath,
        xmlPath:
          invoice.xmlPath,
        pdfAvailable:
          Boolean(invoice.pdfUrl || invoice.pdfPath),
        xmlAvailable:
          Boolean(invoice.xmlUrl || invoice.xmlPath)
      }
    };
  }
}

void MONEY_EPSILON;
