/**
 * InvoiceModels.ts
 * ---------------------------------------------------------------------------
 * Modelos de datos que viajan dentro de VIMDY Invoicing. Son agnósticos de
 * proveedor: el motor y los stores hablan siempre en estos términos, nunca
 * en los términos propios de Factus (o cualquier proveedor futuro).
 */

import type { SaleItem } from "../../entities/Entities";
import type {
  CountryCode,
  CustomerDocumentType,
  InvoiceDocumentType,
  InvoiceProviderName,
  InvoiceStatus
} from "../types/invoice.types";

/** Datos del cliente final, requeridos por la autoridad fiscal para emitir el documento. */
export interface InvoiceCustomer {
  documentType: CustomerDocumentType;
  documentNumber: string;
  fullName: string;
  email?: string;
  phone?: string;
  address?: string;
}

/**
 * Solicitud de emisión de un documento electrónico, ya enriquecida con el
 * negocio, el país y el proveedor resueltos (ver InvoiceRouter, cuando se
 * construya). Reutiliza SaleItem para no duplicar la forma de las líneas
 * de venta que ya vive en Entities.ts.
 */
export interface InvoiceRequest {
  /** Venta de VIMDY (Sale.id) que origina este documento — trazabilidad, nunca se adivina. */
  saleId: string;
  businessId: string;
  provider: InvoiceProviderName;
  country: CountryCode;
  documentType: InvoiceDocumentType;
  customer: InvoiceCustomer;
  items: SaleItem[];
  subtotal: number;
  tax: number;
  discount?: number;
  total: number;
  currency: string;
  /** Solo para notas crédito/débito: documento que se está corrigiendo. */
  referenceInvoiceId?: string;
}

/** Resultado normalizado de la emisión, sin importar el proveedor real detrás. */
export interface InvoiceResult {
  id: string;
  provider: InvoiceProviderName;
  status: InvoiceStatus;
  /** Número de factura asignado por el proveedor/autoridad (ej. consecutivo DIAN). */
  number?: string;
  /** CUFE/CUDE — código único que identifica el documento ante la autoridad fiscal. */
  trackingCode?: string;
  pdfUrl?: string;
  xmlUrl?: string;
  qrCode?: string;
  createdAt: string;
  /** Motivo de rechazo/error, en texto legible, cuando status es "rejected" o "error". */
  errorMessage?: string;
  raw?: unknown;
}