import type { CountryCode } from "../../../src/core/invoicing/types/invoice.types";

const XMLNS_UBL_INVOICE = "urn:oasis:names:specification:ubl:schema:xsd:Invoice-2";
const XMLNS_UBL_CREDIT_NOTE = "urn:oasis:names:specification:ubl:schema:xsd:CreditNote-2";
const XMLNS_UBL_DEBIT_NOTE = "urn:oasis:names:specification:ubl:schema:xsd:DebitNote-2";
const XMLNS_CAC = "urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2";
const XMLNS_CBC = "urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2";
const XMLNS_UBL_EXT = "urn:oasis:names:specification:ubl:schema:xsd:CommonExtensionComponents-2";
const XMLNS_XSI = "http://www.w3.org/2001/XMLSchema-instance";

export const DIAN_ENVIRONMENT_CODE: Record<string, string> = {
  sandbox: "2",
  production: "1",
};

export const UBL_VERSION = "1.9.0";

export type DianEnvironment = "sandbox" | "production";
export type DianDocumentType = "INVOICE" | "CREDIT_NOTE" | "DEBIT_NOTE";

export interface CufeInput {
  prefix: string;
  number: string;
  fecFac: string;
  horFac: string;
  subtotal: number;
  taxes: Array<{ code: string; rate: number; value: number }>;
  discount?: number;
  total: number;
  nitOfe: string;
  numAdq: string;
  clTec: string;
  tipoAmb: string;
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
  organizationType: "PERSONA_JURIDICA" | "PERSONA_NATURAL";
  taxRegime?: string;
  taxResponsibilities: string[];
  softwareId?: string;
  softwareCode?: string;
  claveTecnica?: string;
  environment: DianEnvironment;
  invoicePrefix?: string;
  invoiceConsecutiveFrom?: number;
  invoiceConsecutiveTo?: number;
  invoiceConsecutiveCurrent?: number;
}

export interface DianCustomer {
  documentType: "CC" | "CE" | "NIT" | "PASSPORT" | "OTHER";
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

export const DIAN_UOM_CODES: Record<string, string> = {
  "94": "94",
  UNT: "94",
  HUR: "HUR",
  KGM: "KGM",
  MTK: "MTK",
  MTQ: "MTQ",
  PR: "PR",
  H87: "H87",
  E48: "E48",
  E50: "E50",
  E54: "E54",
};

function escXml(value: string | number | undefined | null): string {
  if (value === undefined || value === null) return "";
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function formatDecimal(value: number): string {
  if (!isFinite(value)) return "0.00";
  return (Math.round(value * 100) / 100).toFixed(2);
}

export function formatDate(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function formatTime(date: Date): string {
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  const seconds = String(date.getSeconds()).padStart(2, "0");
  return `${hours}:${minutes}:${seconds}`;
}

export async function computeSha384(message: string): Promise<string> {
  const data = new TextEncoder().encode(message);
  const buffer = await crypto.subtle.digest("SHA-384", data);
  return Array.from(new Uint8Array(buffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export class DianCufeCalculator {
  async calculate(input: CufeInput): Promise<string> {
    const numFac = `${input.prefix}${input.number.padStart(8, "0")}`;
    const fecFac = input.fecFac;
    const horFac = input.horFac;

    const valFac = formatDecimal(input.subtotal);

    const codImp: string[] = [];
    const valImp: string[] = [];

    codImp.push("01");
    valImp.push(formatDecimal(input.taxes[0]?.value ?? 0));

    codImp.push("0");
    valImp.push("0.00");

    codImp.push("0");
    valImp.push("0.00");

    const valTot = formatDecimal(input.total);
    const nitOfe = input.nitOfe;
    const numAdq = input.numAdq;
    const clTec = input.clTec;
    const tipoAmb = input.tipoAmb;

    const cadena =
      `${numFac}` +
      `${fecFac}` +
      `${horFac}` +
      `${valFac}` +
      `${codImp[0]}` +
      `${valImp[0]}` +
      `${codImp[1]}` +
      `${valImp[1]}` +
      `${codImp[2]}` +
      `${valImp[2]}` +
      `${valTot}` +
      `${nitOfe}` +
      `${numAdq}` +
      `${clTec}` +
      `${tipoAmb}`;

    return computeSha384(cadena);
  }
}

export class DianXmlBuilder {
  async build(request: DianInvoiceRequest, uuid: string): Promise<DianInvoiceXmlResult> {
    const number = this.nextInvoiceNumber(request);
    return this.buildWithNumber(request, number, uuid);
  }

  async buildWithNumber(
    request: DianInvoiceRequest,
    number: string,
    uuid: string
  ): Promise<DianInvoiceXmlResult> {
    const tipoAmb = DIAN_ENVIRONMENT_CODE[request.business.environment] ?? "2";
    const prefix = request.business.invoicePrefix ?? "FV";

    const issueDate = new Date();
    const fecFac = formatDate(issueDate);
    const horFac = formatTime(issueDate);

    const nitOfe = request.business.nit;
    const documentTypeCode = this.getDocumentTypeCode(request.customer.documentType);
    const numAdq = request.customer.documentNumber;
    const clTec = request.business.claveTecnica ?? "";

    if (!clTec) {
      throw new Error(
        "DIAN_CONFIG_MISSING: la clave técnica (Software Security Code) es obligatoria para calcular el CUFE. Regístrala en el portal DIAN."
      );
    }

    const numberPart = number.replace(prefix, "");

    const cufe = await new DianCufeCalculator().calculate({
      prefix,
      number: numberPart,
      fecFac,
      horFac,
      subtotal: request.subtotal,
      taxes: [{ code: "01", rate: this.taxRatePercent(request), value: request.tax }],
      total: request.total,
      nitOfe,
      numAdq,
      clTec,
      tipoAmb,
    });

    const xml = this.buildXmlDocument({
      request,
      number,
      cufe,
      uuid,
      fecFac,
      horFac,
      documentTypeCode,
    });

    return { xml, cufe, number, uuid };
  }

  private nextInvoiceNumber(request: DianInvoiceRequest): string {
    const current = request.business.invoiceConsecutiveCurrent ?? 0;
    const from = request.business.invoiceConsecutiveFrom ?? 1;
    const to = request.business.invoiceConsecutiveTo ?? 999999999;

    const next = Math.max(from, current + 1);
    if (next > to) {
      throw new Error(
        `NUMERATION_EXHAUSTED: el rango de numeración (${from}-${to}) está agotado.`
      );
    }

    const prefix = request.business.invoicePrefix ?? "FV";
    return `${prefix}${String(next).padStart(8, "0")}`;
  }

  private taxRatePercent(request: DianInvoiceRequest): number {
    if (request.subtotal > 0 && request.tax > 0) {
      return (request.tax / request.subtotal) * 100;
    }
    return 0;
  }

  private getDocumentTypeCode(documentType: string): string {
    const map: Record<string, string> = {
      CC: "1",
      CE: "2",
      NIT: "3",
      PASSPORT: "4",
      OTHER: "5",
    };
    return map[documentType] ?? "1";
  }

  private getDianDocTypeCode(documentType: string): string {
    const map: Record<string, string> = {
      INVOICE: "01",
      CREDIT_NOTE: "02",
      DEBIT_NOTE: "03",
    };
    return map[documentType] ?? "01";
  }

  private getOrganizationCode(type: string): string {
    return type === "PERSONA_JURIDICA" ? "1" : "2";
  }

  private paymentMethodCode(method?: string): string {
    const map: Record<string, string> = {
      CASH: "1",
      CARD: "13",
      TRANSFER: "11",
      QR: "13",
      MIXED: "1",
    };
    return map[method ?? ""] ?? "1";
  }

  private paymentMethodName(method?: string): string {
    const map: Record<string, string> = {
      CASH: "Efectivo",
      CARD: "Tarjeta",
      TRANSFER: "Transferencia",
      QR: "Código QR",
      MIXED: "Mixto",
    };
    return map[method ?? ""] ?? "Efectivo";
  }

  private getRootElement(documentType: DianDocumentType): string {
    if (documentType === "CREDIT_NOTE") return "CreditNote";
    if (documentType === "DEBIT_NOTE") return "DebitNote";
    return "Invoice";
  }

  private getUblNamespace(documentType: DianDocumentType): string {
    if (documentType === "CREDIT_NOTE") return XMLNS_UBL_CREDIT_NOTE;
    if (documentType === "DEBIT_NOTE") return XMLNS_UBL_DEBIT_NOTE;
    return XMLNS_UBL_INVOICE;
  }

  private getLineElement(documentType: DianDocumentType): string {
    if (documentType === "CREDIT_NOTE") return "cac:CreditNoteLine";
    if (documentType === "DEBIT_NOTE") return "cac:DebitNoteLine";
    return "cac:InvoiceLine";
  }

  private getQuantityElement(documentType: DianDocumentType): string {
    if (documentType === "CREDIT_NOTE") return "cbc:CreditedQuantity";
    if (documentType === "DEBIT_NOTE") return "cbc:DebitedQuantity";
    return "cbc:InvoicedQuantity";
  }

  private buildInvoiceLine(
    item: DianInvoiceLine,
    index: number,
    documentType: DianDocumentType
  ): string {
    const lineNumber = index + 1;
    const unitCode = item.unitCode ?? "94";
    const price = formatDecimal(item.price);
    const qty = formatDecimal(item.quantity);
    const lineExtension = formatDecimal(item.subtotal);
    const taxAmount = formatDecimal(item.taxAmount);
    const lineTotal = formatDecimal(item.total);
    const taxRate = formatDecimal(item.taxRate);
    const lineEl = this.getLineElement(documentType);
    const qtyEl = this.getQuantityElement(documentType);

    return `
  <${lineEl}>
    <cbc:ID schemeID="1">${lineNumber}</cbc:ID>
    <cbc:UUID schemeID="2" schemeName="CUFE-SHA384"></cbc:UUID>
    <cbc:Note>${escXml(item.productName)}</cbc:Note>
    <${qtyEl} unitCode="${unitCode}">${qty}</${qtyEl}>
    <cbc:LineExtensionAmount currencyID="COP">${lineExtension}</cbc:LineExtensionAmount>
    <cbc:TaxExclusiveAmount currencyID="COP">${lineExtension}</cbc:TaxExclusiveAmount>
    <cbc:TaxInclusiveAmount currencyID="COP">${lineTotal}</cbc:TaxInclusiveAmount>
    <cbc:ChargeTotalAmount currencyID="COP">0.00</cbc:ChargeTotalAmount>
    <cbc:ConsumptionItem>
      <cbc:ConsumptionLevelCode>${lineNumber}</cbc:ConsumptionLevelCode>
    </cbc:ConsumptionItem>
    <cac:Item>
      <cbc:Description>${escXml(item.productName)}</cbc:Description>
      <cbc:Name>${escXml(item.productName)}</cbc:Name>
      <cac:ClassifiedTaxCategory>
        <cbc:ID schemeID="UNSPSC">00801001</cbc:ID>
        <cbc:Percent>${taxRate}</cbc:Percent>
        <cac:BaseUnit>
          <cbc:UnitCode>${unitCode}</cbc:UnitCode>
        </cac:BaseUnit>
        <cac:TaxScheme>
          <cbc:ID schemeID="0">01</cbc:ID>
          <cbc:Name>IVA</cbc:Name>
        </cac:TaxScheme>
      </cac:ClassifiedTaxCategory>
      <cac:SellersItemIdentification>
        <cbc:ID>${escXml(item.productId)}</cbc:ID>
      </cac:SellersItemIdentification>
    </cac:Item>
    <cac:Price>
      <cbc:PriceAmount currencyID="COP">${price}</cbc:PriceAmount>
      <cbc:BaseQuantity unitCode="${unitCode}">1</cbc:BaseQuantity>
    </cac:Price>
    <cac:TaxTotal>
      <cbc:TaxableAmount currencyID="COP">${lineExtension}</cbc:TaxableAmount>
      <cbc:TaxAmount currencyID="COP">${taxAmount}</cbc:TaxAmount>
      <cac:TaxSubtotal>
        <cbc:TaxableAmount currencyID="COP">${lineExtension}</cbc:TaxableAmount>
        <cbc:TaxAmount currencyID="COP">${taxAmount}</cbc:TaxAmount>
        <cbc:CalculationSequence>1</cbc:CalculationSequence>
        <cac:TransactionTax>
          <cbc:ID>1</cbc:ID>
          <cbc:CalculationMethod>1</cbc:CalculationMethod>
          <cbc:Percent>${taxRate}</cbc:Percent>
        </cac:TransactionTax>
        <cac:TaxCategory>
          <cbc:ID schemeID="UNSPSC">00801001</cbc:ID>
          <cbc:Percent>${taxRate}</cbc:Percent>
          <cac:TaxScheme>
            <cbc:ID schemeID="0">01</cbc:ID>
            <cbc:Name>IVA</cbc:Name>
          </cac:TaxScheme>
        </cac:TaxCategory>
      </cac:TaxSubtotal>
    </cac:TaxTotal>
  </${lineEl}>`;
  }

  private buildXmlDocument(opts: {
    request: DianInvoiceRequest;
    number: string;
    cufe: string;
    uuid: string;
    fecFac: string;
    horFac: string;
    documentTypeCode: string;
  }): string {
    const { request, number, cufe, uuid, fecFac, horFac, documentTypeCode } = opts;
    const tipoAmb = DIAN_ENVIRONMENT_CODE[request.business.environment] ?? "2";
    const docTypeCode = this.getDianDocTypeCode(request.documentType);
    const organizationCode = this.getOrganizationCode(
      request.business.organizationType ?? "PERSONA_NATURAL"
    );
    const rootElement = this.getRootElement(request.documentType);
    const xmlnsUbl = this.getUblNamespace(request.documentType);

    const linesXml = request.items
      .map((item, idx) => this.buildInvoiceLine(item, idx, request.documentType))
      .join("\n");

    const taxTotal = formatDecimal(request.tax);
    const payableAmount = formatDecimal(request.total);
    const taxableAmount = formatDecimal(request.subtotal);

    const discountXml =
      request.discount && request.discount > 0
        ? `
  <cac:AllowanceCharge>
    <cbc:ID>01</cbc:ID>
    <cbc:ChargeIndicator>false</cbc:ChargeIndicator>
    <cbc:Amount currencyID="${request.currency}">${formatDecimal(request.discount)}</cbc:Amount>
    <cbc:BaseAmount currencyID="${request.currency}">${taxableAmount}</cbc:BaseAmount>
  </cac:AllowanceCharge>`
        : "";

    const customerTaxId = request.customer.documentNumber;
    const customerName = escXml(request.customer.fullName);
    const customerEmail = request.customer.email
      ? `<cbc:ElectronicMail>${escXml(request.customer.email)}</cbc:ElectronicMail>`
      : "";

    const seller = request.business;
    const sellerNit = seller.nit;
    const sellerName = escXml(seller.legalName ?? "");
    const sellerAddress = escXml(seller.address ?? "");
    const sellerCity = escXml(seller.city ?? "");
    const sellerPhone = seller.phone ? `<cbc:Value>${escXml(seller.phone)}</cbc:Value>` : "";
    const sellerEmail = seller.email
      ? `<cbc:ElectronicMail>${escXml(seller.email)}</cbc:ElectronicMail>`
      : "";

    return `<?xml version="1.0" encoding="utf-8"?>
<${rootElement} xmlns="${xmlnsUbl}"
       xmlns:cac="${XMLNS_CAC}"
       xmlns:cbc="${XMLNS_CBC}"
       xmlns:ext="${XMLNS_UBL_EXT}"
       xmlns:xsi="${XMLNS_XSI}">
  <cbc:UBLVersionID>2.1</cbc:UBLVersionID>
  <cbc:CustomizationID schemeAgencyID="01">1.2.1</cbc:CustomizationID>
  <cbc:ProfileID schemeID="1">${tipoAmb}</cbc:ProfileID>
  <cbc:ID>${escXml(number)}</cbc:ID>
  <cbc:UUID schemeID="2" schemeName="CUFE-SHA384">${escXml(cufe)}</cbc:UUID>
  <cbc:IssueDate>${fecFac}</cbc:IssueDate>
  <cbc:IssueTime>${horFac}</cbc:IssueTime>
  <cbc:DueDate>${fecFac}</cbc:DueDate>
  <cbc:InvoiceTypeCode documentCurrencyCode="${request.currency}" listID="01">${docTypeCode}</cbc:InvoiceTypeCode>
  <cbc:DocumentCurrencyCode>${request.currency}</cbc:DocumentCurrencyCode>
  <cbc:LineCountNumeric>${request.items.length}</cbc:LineCountNumeric>

  <cac:AccountingSupplierParty>
    <cbc:CustomerAssignedAccountID>${escXml(sellerNit)}</cbc:CustomerAssignedAccountID>
    <cbc:SupplierAssignedAccountID>${escXml(sellerName)}</cbc:SupplierAssignedAccountID>
    <cac:Party>
      <cbc:EndpointID schemeID="CC">${escXml(sellerNit)}</cbc:EndpointID>
      <cac:PartyIdentification>
        <cbc:ID schemeID="${documentTypeCode}">${escXml(sellerNit)}</cbc:ID>
      </cac:PartyIdentification>
      <cac:PartyName>
        <cbc:Name>${escXml(sellerName)}</cbc:Name>
      </cac:PartyName>
      <cac:PostalAddress>
        <cbc:AddressLine>${sellerAddress}</cbc:AddressLine>
        <cbc:CityName>${sellerCity}</cbc:CityName>
        <cbc:CountrySubentity>${escXml(seller.department ?? "")}</cbc:CountrySubentity>
        <cac:Country>
          <cbc:IdentificationCode listID="ISO 3166-1 alpha-2">${escXml(seller.country ?? "CO")}</cbc:IdentificationCode>
        </cac:Country>
      </cac:PostalAddress>
      <cac:Contact>
        ${sellerPhone}
        ${sellerEmail}
      </cac:Contact>
      <cac:PartyTaxScheme>
        <cbc:RegistrationName>${escXml(sellerName)}</cbc:RegistrationName>
        <cbc:CompanyID>${escXml(sellerNit)}</cbc:CompanyID>
        <cac:TaxScheme>
          <cbc:ID>1</cbc:ID>
          <cbc:Name>IVA</cbc:Name>
        </cac:TaxScheme>
      </cac:PartyTaxScheme>
      <cac:PartyLegalEntity>
        <cbc:RegistrationName>${escXml(sellerName)}</cbc:RegistrationName>
        <cbc:CompanyID schemeID="${documentTypeCode}">${escXml(sellerNit)}</cbc:CompanyID>
        <cbc:OrganizationName>${escXml(organizationCode)}</cbc:OrganizationName>
      </cac:PartyLegalEntity>
    </cac:Party>
  </cac:AccountingSupplierParty>

  <cac:AccountingCustomerParty>
    <cbc:CustomerAssignedAccountID>${escXml(customerTaxId)}</cbc:CustomerAssignedAccountID>
    <cac:Party>
      <cac:PartyIdentification>
        <cbc:ID schemeID="${documentTypeCode}">${escXml(customerTaxId)}</cbc:ID>
      </cac:PartyIdentification>
      <cac:PartyName>
        <cbc:Name>${customerName}</cbc:Name>
      </cac:PartyName>
      <cac:PostalAddress>
        <cbc:AddressLine>${escXml(request.customer.address ?? "")}</cbc:AddressLine>
        <cbc:CityName></cbc:CityName>
        <cac:Country>
          <cbc:IdentificationCode listID="ISO 3166-1 alpha-2">${escXml(request.country)}</cbc:IdentificationCode>
        </cac:Country>
      </cac:PostalAddress>
      <cac:Contact>
        ${customerEmail}
      </cac:Contact>
      <cac:PartyTaxScheme>
        <cbc:RegistrationName>${customerName}</cbc:RegistrationName>
        <cbc:CompanyID>${escXml(customerTaxId)}</cbc:CompanyID>
        <cac:TaxScheme>
          <cbc:ID>1</cbc:ID>
          <cbc:Name>IVA</cbc:Name>
        </cac:TaxScheme>
      </cac:PartyTaxScheme>
    </cac:Party>
  </cac:AccountingCustomerParty>

  <cac:OrderReference>
    <cbc:ID>${escXml(request.saleId)}</cbc:ID>
  </cac:OrderReference>

  <cac:LegalMonetaryTotal>
    <cbc:LineExtensionAmount currencyID="${request.currency}">${taxableAmount}</cbc:LineExtensionAmount>
    <cbc:TaxExclusiveAmount currencyID="${request.currency}">${taxableAmount}</cbc:TaxExclusiveAmount>
    <cbc:TaxInclusiveAmount currencyID="${request.currency}">${payableAmount}</cbc:TaxInclusiveAmount>
    <cbc:ChargeTotalAmount currencyID="${request.currency}">0.00</cbc:ChargeTotalAmount>
    <cbc:PrepaidAmount currencyID="${request.currency}">0.00</cbc:PrepaidAmount>${discountXml}
    <cbc:PayableAmount currencyID="${request.currency}">${payableAmount}</cbc:PayableAmount>
  </cac:LegalMonetaryTotal>

  <cac:TaxTotal>
    <cbc:TaxableAmount currencyID="${request.currency}">${taxableAmount}</cbc:TaxableAmount>
    <cbc:TaxAmount currencyID="${request.currency}">${taxTotal}</cbc:TaxAmount>
    <cac:TaxSubtotal>
      <cbc:TaxableAmount currencyID="${request.currency}">${taxableAmount}</cbc:TaxableAmount>
      <cbc:TaxAmount currencyID="${request.currency}">${taxTotal}</cbc:TaxAmount>
      <cbc:CalculationSequence>1</cbc:CalculationSequence>
      <cac:TransactionTax>
        <cbc:ID>1</cbc:ID>
        <cbc:CalculationMethod>1</cbc:CalculationMethod>
        <cbc:Percent>${formatDecimal(this.taxRatePercent(request))}</cbc:Percent>
        <cbc:BaseUnitAmount currencyID="${request.currency}">${taxableAmount}</cbc:BaseUnitAmount>
        <cbc:TierRange>0.00</cbc:TierRange>
        <cbc:UnitCode>94</cbc:UnitCode>
      </cac:TransactionTax>
      <cac:TaxCategory>
        <cbc:ID schemeID="UNSPSC">00801001</cbc:ID>
        <cbc:Percent>${formatDecimal(this.taxRatePercent(request))}</cbc:Percent>
        <cac:TaxScheme>
          <cbc:ID schemeID="0">01</cbc:ID>
          <cbc:Name>IVA</cbc:Name>
        </cac:TaxScheme>
      </cac:TaxCategory>
    </cac:TaxSubtotal>
  </cac:TaxTotal>

  <cac:PaymentMeans>
    <cbc:ID>1</cbc:ID>
    <cbc:PaymentMethodCode>${this.paymentMethodCode(request.paymentMethod)}</cbc:PaymentMethodCode>
    <cac:PayeeFinancialAccount>
      <cbc:ID>${escXml(this.paymentMethodName(request.paymentMethod))}</cbc:ID>
    </cac:PayeeFinancialAccount>
  </cac:PaymentMeans>

  <cac:PaymentTerms>
    <cbc:ID>1</cbc:ID>
    <cbc:Note>1</cbc:Note>
  </cac:PaymentTerms>

 ${linesXml}

  <cac:Signature>
    <cbc:ID>${escXml(cufe)}</cbc:ID>
    <cac:SignatoryParty>
      <cbc:ID>${escXml(sellerNit)}</cbc:ID>
      <cac:PartyIdentification>
        <cbc:ID schemeID="${documentTypeCode}">${escXml(sellerNit)}</cbc:ID>
      </cac:PartyIdentification>
      <cac:PartyName>
        <cbc:Name>${escXml(sellerName)}</cbc:Name>
      </cac:PartyName>
    </cac:SignatoryParty>
    <cac:DigitalSignatureAttachment>
      <cac:ExternalReference>
        <cbc:URI>#${escXml(cufe)}</cbc:URI>
      </cac:ExternalReference>
    </cac:DigitalSignatureAttachment>
  </cac:Signature>
</${rootElement}>`;
  }
}

function padNumber(num: number | string, length: number): string {
  return num.toString().padStart(length, "0");
}

export { padNumber };
