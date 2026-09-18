import type { CountryCode } from "../../types/invoice.types";

export type DianDocumentType = "INVOICE" | "CREDIT_NOTE" | "DEBIT_NOTE";
export type DianEnvironment = "sandbox" | "production";
export type DianOrganizationType = "PERSONA_NATURAL" | "PERSONA_JURIDICA";
export type DianTaxRegime =
  | "SIMPLE"
  | "PRESUNTIVO"
  | "COMUN"
  | "GRAN_CONTRIBUYENTE"
  | "RESPONSABLE_IVA";

export interface DianTaxResponsibility {
  code: string;
  name: string;
}

export const DIAN_TAX_RESPONSIBILITIES: Record<string, DianTaxResponsibility> = {
  "01": { code: "01", name: "Responsable de IVA" },
  "02": { code: "02", name: "Responsable de ICA" },
  "03": { code: "03", name: "No responsable de IVA" },
  "04": { code: "04", name: "No responsable de ICA" },
  "05": { code: "05", name: "Responsable de ICA por reducción" },
  "06": { code: "06", name: "Sujeto Exento de IVA" },
  "07": { code: "07", name: "Sujeto Pasivo Porcentaje" },
  "08": { code: "08", name: "Sujeto Pasivo Completo" },
  "09": { code: "09", name: "Régimen Especial" },
  "10": { code: "10", name: "Pequeño Responsable" },
  "11": { code: "11", name: "Pequeño No Responsable" },
  "22": { code: "22", name: "No responsable de IVA por tamaño" },
  "23": { code: "23", name: "Régimen de Responsabilidad de IVA diferente al 12" },
  "24": { code: "24", name: "Arl" },
  "25": { code: "25", name: "Aeropuerto" },
  "26": { code: "26", name: "Escenarios deportivos" },
  "27": { code: "27", name: "Plataformas electronicas comercio" },
  "28": { code: "28", name: "Régimen deIngresos Microempresas RIME" },
  "29": { code: "29", name: "Régimen de ingresos y patrimonio no especial" },
  "30": { code: "30", name: "Régimen de ingresos y patrimonio especial" },
  "31": { code: "31", name: "Régimen Tributario de las Cajas de Compensación Familiar" },
  "32": { code: "32", name: "Régimen Tributario de las Cajas de Ahorro" },
  "33": { code: "33", name: "Régimen de los ingresos por devolución de plata formación" },
  "34": { code: "34", name: "Régimen Especial de Responsabilidad Tributaria RER" },
  "35": { code: "35", name: "Régimen Especial de Caja RERC" },
  "36": { code: "36", name: "Régimen Especial deIngresos de las Sociedades Cooperativas de Suminstro" },
  "37": { code: "37", name: "Régimen Especial de las Empresas del Grupo PALO" },
  "38": { code: "38", name: "Régimen Especial de las Empresas del Grupo PALO" },
  "39": { code: "39", name: "Régimen Especial de las Empresas del Grupo PALO" },
  "99": { code: "99", name: "No habitual" },
};

export const DIAN_DOCUMENT_TYPE_CODES: Record<string, string> = {
  CC: "1",
  CE: "2",
  NIT: "3",
  PASSPORT: "4",
  OTHER: "5",
};

export interface DianCustomer {
  documentType: keyof typeof DIAN_DOCUMENT_TYPE_CODES;
  documentNumber: string;
  verificationDigit?: string;
  fullName: string;
  email?: string;
  phone?: string;
  address?: string;
  city?: string;
  department?: string;
  taxResponsibilities?: string[];
}

export interface DianBusinessConfig {
  nit: string;
  verificationDigit: string;
  legalName: string;
  commercialName?: string;
  address: string;
  city: string;
  department: string;
  phone?: string;
  email?: string;
  country?: string;
  organizationType: DianOrganizationType;
  taxRegime?: string;
  taxResponsibilities: string[];
  softwareId?: string;
  claveTecnica?: string;
  environment: DianEnvironment;
  invoicePrefix?: string;
  invoiceConsecutiveFrom?: number;
  invoiceConsecutiveTo?: number;
  invoiceConsecutiveCurrent?: number;
}

export interface DianInvoiceLine {
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

export interface DianInvoiceRequest {
  saleId: string;
  businessId: string;
  business: DianBusinessConfig;
  documentType: DianDocumentType;
  customer: DianCustomer;
  items: DianInvoiceLine[];
  subtotal: number;
  tax: number;
  discount?: number;
  total: number;
  currency: string;
  country: CountryCode;
  paymentMethod?: string;
  referenceInvoiceId?: string;
}

export interface DianInvoiceXmlResult {
  xml: string;
  cufe: string;
  number: string;
  uuid: string;
}

export interface DianTransmitResult {
  status: "accepted" | "rejected" | "pending" | "error";
  cufe?: string;
  number?: string;
  errorMessage?: string;
  raw?: unknown;
}

export const DIAN_ENVIRONMENT_CODE: Record<DianEnvironment, string> = {
  sandbox: "2",
  production: "1",
};

export const DIAN_UOM_CODES: Record<string, string> = {
  "94": "94",
  "UNT": "94",
  "HUR": "HUR",
  "KGM": "KGM",
  "MTK": "MTK",
  "MTQ": "MTQ",
  "PR": "PR",
  "H87": "H87",
  "E48": "E48",
  "E50": "E50",
  "E54": "E54",
};

export function padNumber(value: number, width: number): string {
  return value.toString().padStart(width, "0");
}
