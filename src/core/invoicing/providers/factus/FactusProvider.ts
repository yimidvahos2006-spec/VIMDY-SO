/**
 * FactusProvider.ts
 * ---------------------------------------------------------------------------
 * Implementación de IInvoiceProvider para Factus (proveedor tecnológico
 * autorizado por la DIAN — https://developers.factus.com.co).
 *
 * Nadie fuera de invoicing/ debe importar esta clase directamente: siempre
 * se accede a través de InvoiceFactory.
 *
 * Ninguna credencial vive aquí (este archivo corre en el navegador). El
 * client_id, client_secret, username y password de Factus son secretos de
 * verdad — a diferencia de la llave pública de Wompi, aquí NO existe un
 * equivalente "seguro de exponer". Por eso este archivo nunca llama
 * directamente a api-sandbox.factus.com.co / api.factus.com.co: siempre
 * delega en la Edge Function `factus-invoice`, que es la única que conoce
 * las credenciales (viven como secrets de esa función).
 */

import { supabase } from "../../../../infrastructure/supabase/supabaseClient";
import type { IInvoiceProvider } from "../../interfaces/IInvoiceProvider";
import type { CountryCode, InvoiceProviderName } from "../../types/invoice.types";
import type { InvoiceRequest, InvoiceResult } from "../../models/InvoiceModels";
import { nowIso } from "../../utils/invoiceUtils";

/** Factus hoy solo cubre Colombia — igual que el criterio de globalization.ts para el IVA real. */
const FACTUS_SUPPORTED_COUNTRIES: CountryCode[] = ["CO"];

/** Extrae el mensaje detallado de un error de Edge Function, mismo patrón que WompiProvider.ts. */
async function extractFunctionErrorMessage(fnError: unknown, fallback: string): Promise<string> {
  const context = (fnError as { context?: Response })?.context;
  if (context && typeof context.json === "function") {
    try {
      const body = await context.json();
      if (body?.error) return body.error as string;
    } catch {
      // El body no era JSON válido; nos quedamos con el mensaje genérico.
    }
  }
  return (fnError as { message?: string })?.message ?? fallback;
}

/** Forma de la respuesta que devuelve la Edge Function factus-invoice, ya normalizada. */
interface FactusFunctionResult {
  ok: true;
  invoice: {
    id: string;
    status: InvoiceResult["status"];
    number?: string;
    cufe?: string;
    pdfUrl?: string;
    xmlUrl?: string;
    qrCode?: string;
    errorMessage?: string;
    raw?: unknown;
  };
}

export class FactusProvider implements IInvoiceProvider {
  readonly name: InvoiceProviderName = "factus";

  async createInvoice(request: InvoiceRequest): Promise<InvoiceResult> {
    const { data, error } = await supabase.functions.invoke<FactusFunctionResult>(
      "factus-invoice",
      { body: { action: "create", request } }
    );

    if (error) {
      throw new Error(await extractFunctionErrorMessage(error, "No se pudo emitir la factura electrónica con Factus."));
    }
    if (!data) {
      throw new Error("Factus no devolvió ninguna respuesta al emitir la factura.");
    }

    return this.toInvoiceResult(data);
  }

  async getInvoice(invoiceId: string): Promise<InvoiceResult> {
    const { data, error } = await supabase.functions.invoke<FactusFunctionResult>(
      "factus-invoice",
      { body: { action: "get", invoiceId } }
    );

    if (error) {
      throw new Error(await extractFunctionErrorMessage(error, "No se pudo consultar la factura en Factus."));
    }
    if (!data) {
      throw new Error("Factus no devolvió ninguna respuesta al consultar la factura.");
    }

    return this.toInvoiceResult(data);
  }

  async cancelInvoice(invoiceId: string, reason: string): Promise<InvoiceResult> {
    // Factus solo permite eliminar facturas AÚN NO validadas ante la DIAN
    // (ver data.is_validated en la respuesta de creación) — una vez
    // validada, el documento es legalmente irreversible y lo correcto es
    // emitir una nota crédito, no "cancelar". La Edge Function es quien
    // decide cuál de las dos operaciones aplica; este método solo pide
    // "anular" en términos genéricos de VIMDY.
    const { data, error } = await supabase.functions.invoke<FactusFunctionResult>(
      "factus-invoice",
      { body: { action: "cancel", invoiceId, reason } }
    );

    if (error) {
      throw new Error(await extractFunctionErrorMessage(error, "No se pudo anular la factura en Factus."));
    }
    if (!data) {
      throw new Error("Factus no devolvió ninguna respuesta al anular la factura.");
    }

    return this.toInvoiceResult(data);
  }

  supportsCountry(country: CountryCode): boolean {
    return FACTUS_SUPPORTED_COUNTRIES.includes(country);
  }

  validateResponse(): boolean {
    // Factus no envía webhooks hoy (se consulta por polling vía getInvoice);
    // este método existe solo para cumplir la interfaz y queda listo para
    // el día en que Factus lo ofrezca sin tener que tocar el contrato.
    return true;
  }

  private toInvoiceResult(data: FactusFunctionResult): InvoiceResult {
    return {
      id: data.invoice.id,
      provider: "factus",
      status: data.invoice.status,
      number: data.invoice.number,
      trackingCode: data.invoice.cufe,
      pdfUrl: data.invoice.pdfUrl,
      xmlUrl: data.invoice.xmlUrl,
      qrCode: data.invoice.qrCode,
      createdAt: nowIso(),
      errorMessage: data.invoice.errorMessage,
      raw: data.invoice.raw
    };
  }
}