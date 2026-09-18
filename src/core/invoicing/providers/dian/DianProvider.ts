import { supabase } from "../../../../infrastructure/supabase/supabaseClient";
import type { IInvoiceProvider } from "../../interfaces/IInvoiceProvider";
import type { CountryCode, InvoiceProviderName } from "../../types/invoice.types";
import type { InvoiceRequest, InvoiceResult } from "../../models/InvoiceModels";
import { nowIso } from "../../utils/invoiceUtils";
import type {
  DianInvoiceRequest,
  DianInvoiceXmlResult,
} from "./types";

const DIAN_SUPPORTED_COUNTRIES: CountryCode[] = ["CO"];

async function extractFunctionErrorMessage(fnError: unknown, fallback: string): Promise<string> {
  const context = (fnError as { context?: Response })?.context;
  if (context && typeof context.json === "function") {
    try {
      const body = await context.json();
      if (body?.error) return body.error as string;
    } catch {
    }
  }
  return (fnError as { message?: string })?.message ?? fallback;
}

interface DianFunctionResult {
  ok: true;
  invoice: {
    id: string;
    status: InvoiceResult["status"];
    number?: string;
    trackingCode?: string;
    pdfUrl?: string;
    xmlUrl?: string;
    qrCode?: string;
    errorMessage?: string;
    raw?: unknown;
  };
}

interface BusinessRow {
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

export class DianProvider implements IInvoiceProvider {
  readonly name: InvoiceProviderName = "dian";

  async createInvoice(request: InvoiceRequest): Promise<InvoiceResult> {
    const { data, error } = await supabase.functions.invoke<DianFunctionResult>(
      "dian-invoice",
      {
        body: { action: "create", request },
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
      throw new Error("DIAN no devolvió ninguna respuesta al emitir la factura.");
    }

    return this.toInvoiceResult(data);
  }

  async getInvoice(invoiceId: string): Promise<InvoiceResult> {
    const { data, error } = await supabase.functions.invoke<DianFunctionResult>(
      "dian-invoice",
      {
        body: { action: "get", invoiceId },
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
      throw new Error("DIAN no devolvió ninguna respuesta al consultar la factura.");
    }

    return this.toInvoiceResult(data);
  }

  async cancelInvoice(invoiceId: string, reason: string): Promise<InvoiceResult> {
    const { data, error } = await supabase.functions.invoke<DianFunctionResult>(
      "dian-invoice",
      {
        body: { action: "cancel", invoiceId, reason },
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
      throw new Error("DIAN no devolvió ninguna respuesta al anular la factura.");
    }

    return this.toInvoiceResult(data);
  }

  supportsCountry(country: CountryCode): boolean {
    return DIAN_SUPPORTED_COUNTRIES.includes(country);
  }

  validateResponse(payload: unknown, signature?: string): boolean {
    if (!payload) return false;
    const data = payload as Record<string, unknown>;
    return data.status === "accepted" || data.status === "pending";
  }

  private toInvoiceResult(data: DianFunctionResult): InvoiceResult {
    return {
      id: data.invoice.id,
      provider: "dian",
      status: data.invoice.status,
      number: data.invoice.number,
      trackingCode: data.invoice.trackingCode,
      pdfUrl: data.invoice.pdfUrl,
      xmlUrl: data.invoice.xmlUrl,
      qrCode: data.invoice.qrCode,
      createdAt: nowIso(),
      errorMessage: data.invoice.errorMessage,
      raw: data.invoice.raw,
    };
  }
}
