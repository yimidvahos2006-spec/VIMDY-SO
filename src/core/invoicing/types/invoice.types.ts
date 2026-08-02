/**
 * invoice.types.ts
 * ---------------------------------------------------------------------------
 * Tipos base del motor de facturación electrónica de VIMDY (VIMDY Invoicing).
 * Único fuente de verdad para nombres de proveedores, países y estados
 * normalizados. Todo el resto de invoicing/ (y SOLO invoicing/) importa
 * desde acá — mismo patrón que payments/types/payment.types.ts.
 */

/** Código de país ISO 3166-1 alpha-2 (ej. "CO", "MX", "PE"). */
export type CountryCode = string;

/**
 * Proveedores tecnológicos de facturación electrónica soportados
 * internamente. Este tipo NUNCA debe filtrarse fuera de invoicing/ — el
 * resto de VIMDY no debe saber cuál proveedor concreto está detrás.
 *
 * "none" es un valor real, no un placeholder: es el estado de todo negocio
 * que no factura electrónicamente (la mayoría, fuera de Colombia, y
 * también negocios informales dentro de Colombia). VIMDY debe funcionar
 * exactamente igual con "none" — nunca bloquear ni degradar la experiencia
 * de un negocio que no la necesita.
 */
export type InvoiceProviderName = "factus" | "none";

/**
 * Régimen de facturación electrónica obligatoria conocido por país.
 * Hoy solo Colombia (DIAN) está resuelto de verdad. El resto de países
 * queda en "none" a propósito, igual que el criterio ya usado en
 * globalization.ts para taxRate: en vez de inventar un régimen, se deja
 * vacío hasta tener el dato real verificado de ese país.
 */
export type TaxAuthorityCode = "DIAN" | "none";

/** Tipo de documento electrónico que se puede emitir. */
export type InvoiceDocumentType =
  | "INVOICE" // Factura electrónica de venta
  | "CREDIT_NOTE" // Nota crédito
  | "DEBIT_NOTE"; // Nota débito

/** Estado normalizado de un documento electrónico, igual sin importar el proveedor real. */
export type InvoiceStatus =
  | "draft" // Armado en VIMDY, aún no enviado al proveedor
  | "pending" // Enviado, esperando validación de la autoridad fiscal
  | "accepted" // Validado y aceptado por la autoridad fiscal
  | "rejected" // Rechazado por la autoridad fiscal (requiere corrección)
  | "cancelled"
  | "error";

/** Tipo de documento de identidad del cliente final, para la factura. */
export type CustomerDocumentType =
  | "CC" // Cédula de ciudadanía
  | "CE" // Cédula de extranjería
  | "NIT"
  | "PASSPORT"
  | "OTHER";