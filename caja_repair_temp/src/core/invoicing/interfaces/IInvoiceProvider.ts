/**
 * IInvoiceProvider.ts
 * ---------------------------------------------------------------------------
 * Contrato único que TODOS los proveedores de facturación electrónica
 * (Factus hoy, y cualquier futuro proveedor — Alegra, Plemsi, o el software
 * propio de la DIAN si algún día se automatiza) deben implementar
 * EXACTAMENTE igual. VIMDY Invoicing solo conoce esta interfaz — nunca el
 * proveedor concreto. Mismo patrón que payments/interfaces/IPaymentProvider.ts.
 *
 * Importante: esta interfaz es opcional por diseño. Un negocio sin
 * `companyConfigStore.electronicInvoicing.enabled` nunca instancia ningún
 * proveedor — sigue usando ReceiptEngine tal como funciona hoy, sin tocar
 * este módulo para nada. Facturación electrónica es una capa que se agrega
 * ENCIMA del recibo normal, nunca lo reemplaza ni lo bloquea.
 */

import type { CountryCode, InvoiceProviderName } from "../types/invoice.types";
import type { InvoiceRequest, InvoiceResult } from "../models/InvoiceModels";

export interface IInvoiceProvider {
  /** Nombre interno del proveedor. Solo lo usa el motor de facturación, nunca el resto de VIMDY. */
  readonly name: InvoiceProviderName;

  /** Emite un documento electrónico (factura, nota crédito o nota débito). */
  createInvoice(request: InvoiceRequest): Promise<InvoiceResult>;

  /** Consulta el estado real de un documento ya emitido (ej. mientras la DIAN lo valida). */
  getInvoice(invoiceId: string): Promise<InvoiceResult>;

  /** Anula un documento ya emitido (cuando el proveedor lo permite). */
  cancelInvoice(invoiceId: string, reason: string): Promise<InvoiceResult>;

  /** Indica si este proveedor puede operar para el país dado. */
  supportsCountry(country: CountryCode): boolean;

  /** Valida que una respuesta / webhook realmente venga del proveedor. */
  validateResponse(payload: unknown, signature?: string): boolean;
}