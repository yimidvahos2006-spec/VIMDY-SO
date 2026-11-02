/**
 * fiscal.types.ts
 * ---------------------------------------------------------------------------
 * Tipos fiscales de la facturación electrónica (DIAN) que el FRONTEND puede
 * ver: configuración fiscal del negocio y datos fiscales del cliente final.
 *
 * Fuente de verdad de la BD: tabla `public.businesses` (columnas
 * `electronic_invoicing_*`, `fiscal_*`, `invoice_*`), creadas en
 * 20260916000001_electronic_invoicing_dian.sql y con privilegios por columna
 * definidos en 20261023000006_harden_dian_secret_column_access.sql.
 *
 * REGLAS (no romper):
 * - Aquí NO existen `dian_software_id`, `dian_software_code`,
 *   `dian_clave_tecnica` ni `dian_environment`: `authenticated` no tiene
 *   privilegio de SELECT sobre esas columnas. Solo las lee/escribe el
 *   service_role desde las Edge Functions. Tampoco hay credenciales de Factus:
 *   viven como secretos de la Edge Function `factus-invoice` (FACTUS_*).
 * - Nunca hacer `select("*")` sobre `businesses` desde el navegador: falla por
 *   los privilegios por columna. Usar BUSINESS_INVOICING_SELECT_COLUMNS.
 * - `invoice_consecutive_current` es solo lectura para el navegador: lo avanza
 *   el RPC `get_next_invoice_consecutive` (server-side).
 */

import type {
  CustomerDocumentType,
  InvoiceProviderName
} from "./invoice.types";

/* ===========================================================================
   1. NEGOCIO — configuración fiscal / de facturación electrónica
   ======================================================================== */

/** Valores que hoy leen las Edge Functions en `fiscal_organization_type`. */
export type FiscalOrganizationType = "PERSONA_NATURAL" | "PERSONA_JURIDICA";

/**
 * Fila de `public.businesses` limitada a las columnas de facturación que el
 * navegador puede leer (snake_case, igual que en la BD).
 */
export interface BusinessInvoicingRow {
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
  /** CHECK en BD: 'dian' | 'factus' | 'none'. */
  electronic_invoicing_provider: string;
  invoice_prefix: string | null;
  invoice_consecutive_from: number | null;
  invoice_consecutive_to: number | null;
  /** Solo lectura para el navegador (sin privilegio UPDATE). */
  invoice_consecutive_current: number | null;
}

/** Columnas a pasar a `supabase.from("businesses").select(...)`. */
export const BUSINESS_INVOICING_SELECT_COLUMNS: string = [
  "tax_identification_number",
  "tax_verification_digit",
  "fiscal_legal_name",
  "fiscal_address",
  "fiscal_city",
  "fiscal_department",
  "fiscal_phone",
  "fiscal_email",
  "fiscal_tax_regime",
  "fiscal_organization_type",
  "electronic_invoicing_enabled",
  "electronic_invoicing_provider",
  "invoice_prefix",
  "invoice_consecutive_from",
  "invoice_consecutive_to",
  "invoice_consecutive_current"
].join(",");

/** Configuración fiscal del negocio en camelCase, para store/UI. */
export interface BusinessInvoicingConfig {
  /** `electronic_invoicing_enabled` */
  enabled: boolean;
  /** `electronic_invoicing_provider` ("none" cuando enabled es false). */
  provider: InvoiceProviderName;

  /** NIT sin dígito de verificación (`tax_identification_number`). */
  nit: string;
  verificationDigit: string;
  /** Razón social (`fiscal_legal_name`). */
  legalName: string;
  address: string;
  city: string;
  department: string;
  phone: string;
  email: string;
  taxRegime: string;
  organizationType: FiscalOrganizationType | null;

  invoicePrefix: string;
  consecutiveFrom: number | null;
  consecutiveTo: number | null;
  /** Solo lectura. */
  consecutiveCurrent: number | null;
}

/**
 * Parche de UPDATE hacia `businesses`. Contiene ÚNICAMENTE columnas con
 * privilegio UPDATE para `authenticated`. Por eso no incluye
 * `invoice_consecutive_current` ni ninguna columna `dian_*`.
 */
export type BusinessInvoicingUpdate = Partial<
  Omit<BusinessInvoicingRow, "invoice_consecutive_current">
>;

const trim = (v: string | null | undefined): string => (v ?? "").trim();

function normalizeProvider(value: string | null | undefined): InvoiceProviderName {
  return value === "dian" || value === "factus" ? value : "none";
}

function normalizeOrganizationType(
  value: string | null | undefined
): FiscalOrganizationType | null {
  return value === "PERSONA_NATURAL" || value === "PERSONA_JURIDICA" ? value : null;
}

/** BD → camelCase. Un valor inválido de proveedor cae a "none" (nunca factura). */
export function businessInvoicingFromRow(
  row: BusinessInvoicingRow
): BusinessInvoicingConfig {
  const enabled = row.electronic_invoicing_enabled === true;
  return {
    enabled,
    provider: enabled ? normalizeProvider(row.electronic_invoicing_provider) : "none",
    nit: trim(row.tax_identification_number),
    verificationDigit: trim(row.tax_verification_digit),
    legalName: trim(row.fiscal_legal_name),
    address: trim(row.fiscal_address),
    city: trim(row.fiscal_city),
    department: trim(row.fiscal_department),
    phone: trim(row.fiscal_phone),
    email: trim(row.fiscal_email),
    taxRegime: trim(row.fiscal_tax_regime),
    organizationType: normalizeOrganizationType(row.fiscal_organization_type),
    invoicePrefix: trim(row.invoice_prefix),
    consecutiveFrom: row.invoice_consecutive_from,
    consecutiveTo: row.invoice_consecutive_to,
    consecutiveCurrent: row.invoice_consecutive_current
  };
}

/**
 * camelCase → parche de UPDATE. Mantiene la invariante de la BD:
 * si `enabled` es false el proveedor se guarda como "none".
 */
export function businessInvoicingToUpdate(
  config: Omit<BusinessInvoicingConfig, "consecutiveCurrent">
): BusinessInvoicingUpdate {
  const empty = (v: string): string | null => (v.trim() === "" ? null : v.trim());
  return {
    electronic_invoicing_enabled: config.enabled,
    electronic_invoicing_provider: config.enabled ? config.provider : "none",
    tax_identification_number: empty(config.nit),
    tax_verification_digit: empty(config.verificationDigit),
    fiscal_legal_name: empty(config.legalName),
    fiscal_address: empty(config.address),
    fiscal_city: empty(config.city),
    fiscal_department: empty(config.department),
    fiscal_phone: empty(config.phone),
    fiscal_email: empty(config.email),
    fiscal_tax_regime: empty(config.taxRegime),
    fiscal_organization_type: config.organizationType,
    invoice_prefix: empty(config.invoicePrefix),
    invoice_consecutive_from: config.consecutiveFrom,
    invoice_consecutive_to: config.consecutiveTo
  };
}

/* ===========================================================================
   2. CLIENTE — datos fiscales para la factura electrónica
   ======================================================================== */

/** Tipo de persona del cliente (aplica sobre todo cuando el documento es NIT). */
export type CustomerOrganizationType = FiscalOrganizationType;

/**
 * Códigos de responsabilidad fiscal (RUT casilla 53) que se envían en la
 * factura. Son los que hoy usa el repo (Factus envía "R-99-PN").
 *
 * OJO: los nombres de abajo NO se verificaron contra la tabla oficial
 * "Tablas Referenciadas" del Anexo Técnico v1.9 en esta sesión. Confirmarlos
 * antes de usar esta lista para VALIDAR (por eso el tipo acepta `string`).
 * La tabla `DIAN_TAX_RESPONSIBILITIES` de providers/dian/types.ts usa otra
 * numeración ("01".."39") que no coincide con estos códigos.
 */
export const KNOWN_FISCAL_RESPONSIBILITY_CODES = {
  "O-13": "Gran contribuyente",
  "O-15": "Autorretenedor",
  "O-23": "Agente de retención IVA",
  "O-47": "Régimen simple de tributación",
  "R-99-PN": "No aplica - Otros"
} as const;

export type KnownFiscalResponsibilityCode =
  keyof typeof KNOWN_FISCAL_RESPONSIBILITY_CODES;

/** Código de responsabilidad fiscal; abierto a `string` para no rechazar códigos válidos aún no listados. */
export type FiscalResponsibilityCode = KnownFiscalResponsibilityCode | (string & {});

/**
 * Datos fiscales del cliente final requeridos para emitir la factura.
 * Complementa a `Customer` (Entities.ts), que hoy solo guarda
 * documentType/documentNumber/email/phone/address.
 *
 * Mínimo para facturar a un cliente identificado: documentType,
 * documentNumber y name. Consumidor final no necesita nada de esto (el
 * proveedor usa el documento genérico).
 */
export interface CustomerFiscalData {
  /** CC | CE | NIT | PASSPORT | OTHER (mismo set que `customers_v2.document_type`). */
  documentType: CustomerDocumentType;
  /** NIT/Cédula sin puntos ni dígito de verificación. NUNCA el UUID interno del cliente. */
  documentNumber: string;
  /** Dígito de verificación; solo aplica cuando documentType es "NIT". */
  verificationDigit?: string;
  /** Persona natural o jurídica. */
  organizationType?: CustomerOrganizationType;
  /** Razón social (persona jurídica) o nombre completo (persona natural). */
  legalName: string;
  /** Nombre comercial, si difiere de la razón social. */
  tradeName?: string;
  address?: string;
  city?: string;
  department?: string;
  email?: string;
  phone?: string;
  /**
   * Responsabilidades fiscales del cliente. Todavía ningún proveedor lo lee:
   * hoy `factus-invoice` envía "R-99-PN" fijo a quien no es NIT y omite el campo con NIT.
   */
  fiscalResponsibilities?: FiscalResponsibilityCode[];
}

/* ===========================================================================
   3. NEGOCIO — identidad fiscal editable (Ajustes > Facturación)
   ======================================================================== */

/**
 * Subconjunto de la config fiscal que edita el formulario "Datos fiscales del
 * negocio". Todo son strings (lo que el usuario escribe); `organizationType`
 * es "" mientras no se haya elegido.
 *
 * Deliberadamente NO incluye el switch/proveedor (los guarda
 * businessSettings.ts) ni el consecutivo, para que guardar este formulario
 * jamás pueda pisar esos valores con datos viejos.
 */
export interface BusinessFiscalIdentity {
  /** NIT o cédula, solo dígitos y sin dígito de verificación. */
  nit: string;
  verificationDigit: string;
  /** Razón social. */
  legalName: string;
  organizationType: FiscalOrganizationType | "";
  address: string;
  city: string;
  department: string;
  phone: string;
  email: string;
  /** Prefijo de numeración. Con Factus debe coincidir con el prefijo de un rango activo en Factus. */
  invoicePrefix: string;
}

/** Columnas de `businesses` que escribe este formulario (todas con GRANT UPDATE para authenticated). */
export type BusinessFiscalIdentityUpdate = Pick<
  BusinessInvoicingRow,
  | "tax_identification_number"
  | "tax_verification_digit"
  | "fiscal_legal_name"
  | "fiscal_organization_type"
  | "fiscal_address"
  | "fiscal_city"
  | "fiscal_department"
  | "fiscal_phone"
  | "fiscal_email"
  | "invoice_prefix"
>;

export const BUSINESS_FISCAL_IDENTITY_SELECT_COLUMNS: string = [
  "tax_identification_number",
  "tax_verification_digit",
  "fiscal_legal_name",
  "fiscal_organization_type",
  "fiscal_address",
  "fiscal_city",
  "fiscal_department",
  "fiscal_phone",
  "fiscal_email",
  "invoice_prefix"
].join(",");

export const EMPTY_BUSINESS_FISCAL_IDENTITY: BusinessFiscalIdentity = {
  nit: "",
  verificationDigit: "",
  legalName: "",
  organizationType: "",
  address: "",
  city: "",
  department: "",
  phone: "",
  email: "",
  invoicePrefix: ""
};

/** BD → formulario. Columnas nulas o ausentes quedan como "". */
export function fiscalIdentityFromRow(
  row: Partial<BusinessFiscalIdentityUpdate> | null | undefined
): BusinessFiscalIdentity {
  const r = row ?? {};
  return {
    nit: trim(r.tax_identification_number),
    verificationDigit: trim(r.tax_verification_digit),
    legalName: trim(r.fiscal_legal_name),
    organizationType: normalizeOrganizationType(r.fiscal_organization_type) ?? "",
    address: trim(r.fiscal_address),
    city: trim(r.fiscal_city),
    department: trim(r.fiscal_department),
    phone: trim(r.fiscal_phone),
    email: trim(r.fiscal_email),
    invoicePrefix: trim(r.invoice_prefix)
  };
}

/** Formulario → parche de UPDATE. Vacío se guarda como NULL. */
export function fiscalIdentityToUpdate(
  identity: BusinessFiscalIdentity
): BusinessFiscalIdentityUpdate {
  const empty = (v: string): string | null => (v.trim() === "" ? null : v.trim());
  return {
    tax_identification_number: empty(identity.nit),
    tax_verification_digit: empty(identity.verificationDigit),
    fiscal_legal_name: empty(identity.legalName),
    fiscal_organization_type: identity.organizationType === "" ? null : identity.organizationType,
    fiscal_address: empty(identity.address),
    fiscal_city: empty(identity.city),
    fiscal_department: empty(identity.department),
    fiscal_phone: empty(identity.phone),
    fiscal_email: empty(identity.email),
    invoice_prefix: empty(identity.invoicePrefix)
  };

}