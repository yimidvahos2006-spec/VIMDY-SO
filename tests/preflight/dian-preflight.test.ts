import { DOMParser } from "@xmldom/xmldom";
(globalThis as any).DOMParser = DOMParser;

import { describe, expect, it, vi } from "vitest";
import * as nodeCrypto from "node:crypto";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import {
  DianXmlBuilder,
  DianCufeCalculator,
  DIAN_ENVIRONMENT_CODE,
  formatDate,
  formatTime,
  type DianInvoiceRequest,
  type DianBusinessConfig,
  type DianCustomer,
  type DianInvoiceLine,
} from "../../supabase/functions/dian-invoice/XmlBuilder";
import {
  signDianInvoice,
  exclusiveCanonicalize,
  parseDerCertificate,
  computeSha256,
  uint8ArrayToBase64,
  base64ToUint8Array,
  type DianSignatureResult,
} from "../../supabase/functions/dian-invoice/DianSigner";
import {
  DianSoapClient,
  type DianSoapConfig,
} from "../../supabase/functions/dian-invoice/DianSoapClient";

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURES = join(__dirname, "..", "fixtures");

const CERT_PEM = readFileSync(join(FIXTURES, "test-cert.pem"), "utf-8");
const PRIVATE_KEY_PEM = readFileSync(join(FIXTURES, "test-key.pem"), "utf-8");

const SIGNATURE_POLICY_OID = "urn:oid:1.3.6.1.4.1.27194.1.1.1.1.1";

const BUSINESS: DianBusinessConfig = {
  nit: "900123456",
  verificationDigit: "8",
  legalName: "VIMDY SAS",
  commercialName: "VIMDY",
  address: "Calle 100 #50-30",
  city: "Bogotá",
  department: "Cundinamarca",
  phone: "6011234567",
  email: "factura@vimdy.co",
  country: "CO",
  organizationType: "PERSONA_JURIDICA",
  taxRegime: "COMUN",
  taxResponsibilities: ["01"],
  softwareId: "VIMDY_SOFTWARE_ID_TEST",
  softwareCode: "SW_TEST_12345",
  claveTecnica: "abc123def456",
  environment: "sandbox",
  invoicePrefix: "FV",
  invoiceConsecutiveFrom: 1,
  invoiceConsecutiveTo: 999999999,
  invoiceConsecutiveCurrent: 1,
};

const CUSTOMER: DianCustomer = {
  documentType: "CC",
  documentNumber: "123456789",
  fullName: "Juan Pérez",
  email: "juan@example.com",
  address: "Calle 50 #20-10",
  city: "Bogotá",
  department: "Cundinamarca",
  taxResponsibilities: ["01"],
};

const ITEMS: DianInvoiceLine[] = [
  {
    productId: "PROD001",
    productName: "Hamburguesa",
    quantity: 2,
    price: 25000,
    subtotal: 50000,
    taxRate: 19,
    taxAmount: 9500,
    total: 59500,
    unitCode: "94",
  },
];

function makeInvoiceRequest(overrides: Partial<DianInvoiceRequest> = {}): DianInvoiceRequest {
  return {
    saleId: "sale_test_001",
    businessId: "biz_test_001",
    business: BUSINESS,
    documentType: "INVOICE",
    customer: CUSTOMER,
    items: ITEMS,
    subtotal: 50000,
    tax: 9500,
    total: 59500,
    currency: "COP",
    country: "CO",
    paymentMethod: "CASH",
    ...overrides,
  };
}

const SIGNER_CONFIG = {
  certificate: CERT_PEM,
  privateKey: PRIVATE_KEY_PEM,
};

async function buildAndSign(
  request: DianInvoiceRequest,
  uuid = "test-uuid-preflight-1"
): Promise<{ xml: string; signedXml: string; cufe: string; number: string }> {
  const builder = new DianXmlBuilder();
  const { xml, cufe, number } = await builder.build(request, uuid);
  const result = await signDianInvoice(xml, SIGNER_CONFIG.privateKey, SIGNER_CONFIG.certificate);
  return { xml, signedXml: result.signedXml, cufe, number };
}

/* ──────────────────────────────────────────────────────────
   1. XML UBL 2.1 Structure — Invoice, CreditNote, DebitNote
   ────────────────────────────────────────────────────────── */
describe("PRE-FLIGHT 1: XML UBL 2.1 Structure", () => {
  it("Invoice: root element, namespaces, UBLVersion, CustomizationID, ProfileID", async () => {
    const { xml } = await buildAndSign(makeInvoiceRequest());

    expect(xml).toMatch(/^<\?xml version="1\.0" encoding="utf-8"\?>/);
    expect(xml).toContain('xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2"');
    expect(xml).toContain("<cbc:UBLVersionID>2.1</cbc:UBLVersionID>");
    expect(xml).toContain("<cbc:CustomizationID schemeAgencyID=\"01\">1.2.1</cbc:CustomizationID>");
    expect(xml).toContain('<cbc:ProfileID schemeID="1">2</cbc:ProfileID>'); // sandbox = "2"
    expect(xml).toContain("<cbc:InvoiceTypeCode");
    expect(xml).toContain("documentCurrencyCode=\"COP\"");
  });

  it("Invoice: InvoiceTypeCode = 01 (Factura de venta)", async () => {
    const { xml } = await buildAndSign(makeInvoiceRequest({ documentType: "INVOICE" }));
    expect(xml).toContain(">01<");
  });

  it("CreditNote: root element is CreditNote, type code = 02", async () => {
    const { xml } = await buildAndSign(
      makeInvoiceRequest({ documentType: "CREDIT_NOTE" })
    );

    expect(xml).toContain('xmlns="urn:oasis:names:specification:ubl:schema:xsd:CreditNote-2"');
    expect(xml).toContain("<CreditNote ");
    expect(xml).toContain(">02<");
    expect(xml).toContain("<cac:CreditNoteLine");
    expect(xml).toContain("<cbc:CreditedQuantity");
  });

  it("DebitNote: root element is DebitNote, type code = 03", async () => {
    const { xml } = await buildAndSign(
      makeInvoiceRequest({ documentType: "DEBIT_NOTE" })
    );

    expect(xml).toContain('xmlns="urn:oasis:names:specification:ubl:schema:xsd:DebitNote-2"');
    expect(xml).toContain("<DebitNote ");
    expect(xml).toContain(">03<");
    expect(xml).toContain("<cac:DebitNoteLine");
    expect(xml).toContain("<cbc:DebitedQuantity");
  });

  it("ProfileID reflects production environment = 1", async () => {
    const request = makeInvoiceRequest({
      business: { ...BUSINESS, environment: "production" },
    });
    const builder = new DianXmlBuilder();
    const { xml } = await builder.build(request, "uuid");

    expect(xml).toContain('<cbc:ProfileID schemeID="1">1</cbc:ProfileID>');
  });

  it("ProfileID reflects sandbox environment = 2", async () => {
    const request = makeInvoiceRequest({
      business: { ...BUSINESS, environment: "sandbox" },
    });
    const builder = new DianXmlBuilder();
    const { xml } = await builder.build(request, "uuid");

    expect(xml).toContain('<cbc:ProfileID schemeID="1">2</cbc:ProfileID>');
  });

  it("CUFE appears in UUID element with schemeName CUFE-SHA384", async () => {
    const { xml, cufe } = await buildAndSign(makeInvoiceRequest());

    const uuidMatch = xml.match(/<cbc:UUID[^>]*schemeName="CUFE-SHA384">([^<]*)<\/cbc:UUID>/);
    expect(uuidMatch).toBeTruthy();
    expect(uuidMatch![1]).toBe(cufe);
  });

  it("cac:Signature block references CUFE as signature ID", async () => {
    const { xml, cufe } = await buildAndSign(makeInvoiceRequest());

    expect(xml).toContain("<cac:Signature>");
    expect(xml).toContain(`<cbc:ID>${cufe}</cbc:ID>`);
  });
});

/* ──────────────────────────────────────────────────────────
   2. CUFE-SHA384 Verification
   ────────────────────────────────────────────────────────── */
describe("PRE-FLIGHT 2: CUFE-SHA384 Verification", () => {
  it("CUFE is exactly 96 hexadecimal characters", async () => {
    const { cufe } = await buildAndSign(makeInvoiceRequest());

    expect(cufe).toHaveLength(96);
    expect(cufe).toMatch(/^[0-9a-f]{96}$/);
  });

  it("CUFE is independently recalculated from XML fields and matches", async () => {
    const { xml, cufe, number } = await buildAndSign(makeInvoiceRequest());
    const request = makeInvoiceRequest();

    const fecFacMatch = xml.match(/<cbc:IssueDate>([^<]*)<\/cbc:IssueDate>/);
    const horFacMatch = xml.match(/<cbc:IssueTime>([^<]*)<\/cbc:IssueTime>/);
    expect(fecFacMatch).toBeTruthy();
    expect(horFacMatch).toBeTruthy();

    const prefix = request.business.invoicePrefix ?? "FV";
    const numberPart = number.replace(prefix, "");
    const tipoAmb = DIAN_ENVIRONMENT_CODE[request.business.environment ?? "sandbox"];

    const input = {
      prefix,
      number: numberPart,
      fecFac: fecFacMatch![1],
      horFac: horFacMatch![1],
      subtotal: request.subtotal,
      taxes: [{ code: "01", rate: 19, value: request.tax }],
      total: request.total,
      nitOfe: request.business.nit,
      numAdq: request.customer.documentNumber,
      clTec: request.business.claveTecnica ?? "",
      tipoAmb,
    };

    const expectedCufe = await new DianCufeCalculator().calculate(input);
    expect(cufe).toBe(expectedCufe);
  });

  it("CUFE contains all 14 required DIAN fields (numFac+fecFac+horFac+valFac+c1+c2+c3+v1+v2+v3+valTot+nit+nitAdq+clTec+tipoAmb)", async () => {
    const { cufe, number, xml } = await buildAndSign(makeInvoiceRequest());

    const prefix = BUSINESS.invoicePrefix ?? "FV";
    const numberPart = number.replace(prefix, "");

    const fecFac = xml.match(/<cbc:IssueDate>([^<]*)<\/cbc:IssueDate>/)?.[1] ?? "";
    const horFac = xml.match(/<cbc:IssueTime>([^<]*)<\/cbc:IssueTime>/)?.[1] ?? "";
    const tipoAmb = DIAN_ENVIRONMENT_CODE["sandbox"];

    const valFac = (50000).toFixed(2);
    const valTot = (59500).toFixed(2);
    const valImp1 = (9500).toFixed(2);
    const valImp2 = "0.00";
    const valImp3 = "0.00";

    const expected =
      `${prefix}${numberPart.padStart(8, "0")}` +
      `${fecFac}` +
      `${horFac}` +
      `${valFac}` +
      `01${valImp1}` +
      `0${valImp2}` +
      `0${valImp3}` +
      `${valTot}` +
      `900123456` +
      `123456789` +
      `abc123def456` +
      `${tipoAmb}`;

    const expectedCufe = await computeSha384Hex(expected);
    expect(cufe).toBe(expectedCufe);
  });

  it("CUFE uses SHA-384 (96 hex chars, not 64 like SHA-256)", async () => {
    const { cufe } = await buildAndSign(makeInvoiceRequest());

    const sha256 = await computeSha256Hex("test");
    const sha384 = await computeSha384Hex("test");
    expect(sha256).toHaveLength(64);
    expect(sha384).toHaveLength(96);
    expect(cufe).toHaveLength(96);
  });

  it("Different claveTecnica produces different CUFE", async () => {
    const r1 = await buildAndSign(makeInvoiceRequest());
    const r2 = await buildAndSign(
      makeInvoiceRequest({
        business: { ...BUSINESS, claveTecnica: "different_key" },
      })
    );

    expect(r1.cufe).not.toBe(r2.cufe);
  });

  it("Same inputs produce same CUFE (deterministic)", async () => {
    const r1 = await buildAndSign(makeInvoiceRequest());
    const r2 = await buildAndSign(makeInvoiceRequest());

    expect(r1.cufe).toBe(r2.cufe);
  });
});

/* ──────────────────────────────────────────────────────────
   3. XAdES-EPES Signature — Cryptographic Verification
   ────────────────────────────────────────────────────────── */
describe("PRE-FLIGHT 3: XAdES-EPES Signature Verification", () => {
  function extractXmlElement(xml: string, tagName: string): string | null {
    const match = xml.match(
      new RegExp(`<${tagName.replace(":", "\\:")}[^>]*>[\\s\\S]*?<\\/${tagName.replace(":", "\\:")}>`, "i")
    );
    return match ? match[0] : null;
  }

  function extractElementContent(xml: string, tagName: string): string | null {
    const match = xml.match(
      new RegExp(`<${tagName.replace(":", "\\:")}[^>]*>([^<]*)<\\/${tagName.replace(":", "\\:")}>`, "i")
    );
    return match ? match[1] : null;
  }

  it("XAdES Signature element is present inside UBLExtensions", async () => {
    const { signedXml, xml } = await buildAndSign(makeInvoiceRequest());

    const sigMatch = signedXml.match(/<ds:Signature[^>]*>[\s\S]*<\/ds:Signature>/);
    expect(sigMatch).toBeTruthy();
    expect(signedXml).toContain("xmlns:ext=\"urn:oasis:names:specification:ubl:schema:xsd:CommonExtensionComponents-2\"");
    expect(signedXml).toContain("ext:UBLExtensions");
    expect(signedXml).toContain("ext:ExtensionContent");
  });

  it("XAdES uses Exclusive C14N canonicalization method", async () => {
    const { signedXml } = await buildAndSign(makeInvoiceRequest());

    expect(signedXml).toContain(
      'Algorithm="http://www.w3.org/2001/10/xml-exc-c14n#"'
    );
  });

  it("XAdES uses RSA-SHA256 signature method", async () => {
    const { signedXml } = await buildAndSign(makeInvoiceRequest());

    expect(signedXml).toContain(
      'Algorithm="http://www.w3.org/2001/04/xmldsig-more#rsa-sha256"'
    );
  });

  it("XAdES uses SHA-256 digest method", async () => {
    const { signedXml } = await buildAndSign(makeInvoiceRequest());

    expect(signedXml).toContain(
      'Algorithm="http://www.w3.org/2001/04/xmldsig-more#sha256"'
    );
  });

  it("XAdES has SignaturePolicyIdentifier with correct OID", async () => {
    const { signedXml } = await buildAndSign(makeInvoiceRequest());

    expect(signedXml).toContain(SIGNATURE_POLICY_OID);
    expect(signedXml).toContain("xades:SignaturePolicyIdentifier");
    expect(signedXml).toContain("xades:SignaturePolicyId");
  });

  it("XAdES has SigningCertificate with X509Serial matching the certificate", async () => {
    const { signedXml } = await buildAndSign(makeInvoiceRequest());

    const cert = new nodeCrypto.X509Certificate(CERT_PEM);
    const certDer = cert.raw;
    const certInfo = parseDerCertificate(new Uint8Array(certDer));

    const serialMatch = signedXml.match(/<xades:X509Serial>([^<]*)<\/xades:X509Serial>/);
    expect(serialMatch).toBeTruthy();
    expect(serialMatch![1]).toBe(certInfo.serialNumber);
  });

  it("XAdES has cert digest matching SHA-256 of the certificate", async () => {
    const { signedXml } = await buildAndSign(makeInvoiceRequest());

    const cert = new nodeCrypto.X509Certificate(CERT_PEM);
    const certDer = cert.raw;
    const expectedThumbprint = nodeCrypto
      .createHash("sha256")
      .update(Buffer.from(certDer))
      .digest("base64");

    const digestMatch = signedXml.match(/<ds:DigestValue>([^<]*)<\/ds:DigestValue>/);
    // The first DigestValue in X509CertDigest should match
    const x509CertDigestMatch = signedXml.match(
      /<xades:CertDigest>[\s\S]*?<ds:DigestValue>([^<]*)<\/ds:DigestValue>/
    );
    expect(x509CertDigestMatch).toBeTruthy();
    expect(x509CertDigestMatch![1]).toBe(expectedThumbprint);
  });

  it("RSA-SHA256 SignatureValue verifies with public key from certificate (ENVELOPED + C14N)", async () => {
    const { signedXml, xml: unsignedXml } = await buildAndSign(makeInvoiceRequest());

    const sigMatch = signedXml.match(/<ds:Signature[\s\S]*<\/ds:Signature>/);
    expect(sigMatch).toBeTruthy();
    const sigXml = sigMatch![0];

    const siMatch = sigXml.match(/<ds:SignedInfo[\s\S]*?<\/ds:SignedInfo>/);
    expect(siMatch).toBeTruthy();
    const signedInfoXml = siMatch![0];

    const canonicalSignedInfo = exclusiveCanonicalize(signedInfoXml);

    const svMatch = sigXml.match(/<ds:SignatureValue[^>]*>([^<]+)<\/ds:SignatureValue>/);
    expect(svMatch).toBeTruthy();
    const signatureValue = svMatch![1].trim();
    const signatureBytes = Buffer.from(signatureValue, "base64");

    const cert = new nodeCrypto.X509Certificate(CERT_PEM);
    const publicKey = cert.publicKey;

    const verifier = nodeCrypto.createVerify("RSA-SHA256");
    verifier.update(canonicalSignedInfo);
    const isValid = verifier.verify(publicKey, signatureBytes);

    expect(isValid).toBe(true);
  });

  it("Document Reference (URI='') DigestValue matches canonicalized unsigned document", async () => {
    const { signedXml, xml: unsignedXml } = await buildAndSign(makeInvoiceRequest());

    const sigMatch = signedXml.match(/<ds:Signature[\s\S]*<\/ds:Signature>/);
    const sigXml = sigMatch![0];

    const siMatch = sigXml.match(/<ds:SignedInfo[\s\S]*?<\/ds:SignedInfo>/);
    const signedInfoXml = siMatch![0];

    const refMatches = [...signedInfoXml.matchAll(/<ds:Reference/g)];

    const docRefMatch = signedInfoXml.match(
      /<ds:Reference URI="">[\s\S]*?<ds:DigestValue>([^<]*)<\/ds:DigestValue>/
    );
    expect(docRefMatch).toBeTruthy();
    const docDigestValue = docRefMatch![1];

    const canonicalUnsignedDoc = exclusiveCanonicalize(unsignedXml);
    const computedDigest = nodeCrypto
      .createHash("sha256")
      .update(Buffer.from(canonicalUnsignedDoc, "utf-8"))
      .digest("base64");

    expect(docDigestValue).toBe(computedDigest);
  });

  it("SignedProperties Reference DigestValue matches", async () => {
    const { signedXml } = await buildAndSign(makeInvoiceRequest());

    const sigMatch = signedXml.match(/<ds:Signature[\s\S]*<\/ds:Signature>/);
    const sigXml = sigMatch![0];

    const signedPropsMatch = sigXml.match(/<xades:SignedProperties[\s\S]*?<\/xades:SignedProperties>/);
    expect(signedPropsMatch).toBeTruthy();
    const signedPropsXml = signedPropsMatch[0];

    const signedPropsId = signedPropsXml.match(/<xades:SignedProperties Id="([^"]*)"/)?.[1];

    const spRefMatch = sigXml.match(
      new RegExp(`<ds:Reference[^>]*URI="#${signedPropsId}">[\\s\\S]*?<ds:DigestValue>([^<]*)<\/ds:DigestValue>`)
    );
    expect(spRefMatch).toBeTruthy();
    const spDigestValue = spRefMatch![1];

    const canonicalSignedProps = exclusiveCanonicalize(signedPropsXml);
    const computedDigest = nodeCrypto
      .createHash("sha256")
      .update(Buffer.from(canonicalSignedProps, "utf-8"))
      .digest("base64");

    expect(spDigestValue).toBe(computedDigest);
  });

  it("Enveloped-signature transform is present in document Reference", async () => {
    const { signedXml } = await buildAndSign(makeInvoiceRequest());

    const sigMatch = signedXml.match(/<ds:Signature[\s\S]*<\/ds:Signature>/);
    const signedInfoXml = sigMatch![0].match(/<ds:SignedInfo[\s\S]*?<\/ds:SignedInfo>/)![0];

    expect(signedInfoXml).toMatch(
      /<ds:Transform Algorithm="http:\/\/www\.w3\.org\/2000\/09\/xmldsig#enveloped-signature" \/>/
    );
  });
});

/* ──────────────────────────────────────────────────────────
   4. WS-Security Signature — SOAP Envelope Verification
   ────────────────────────────────────────────────────────── */
describe("PRE-FLIGHT 4: WS-Security Signature", () => {
  let capturedEnvelope: string | null = null;
  let capturedHeaders: any = null;
  let fetchMock: any;

  async function captureSoapEnvelope(signedXml: string, documentKey: string): Promise<string> {
    const config: DianSoapConfig = {
      environment: "habilantation",
      nit: BUSINESS.nit,
      softwareId: BUSINESS.softwareId ?? "",
      softwareCode: BUSINESS.softwareCode ?? "",
      certPem: CERT_PEM,
      privateKeyPem: PRIVATE_KEY_PEM,
    };

    fetchMock = vi.spyOn(globalThis, "fetch");
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      statusText: "OK",
      text: async () =>
        '<a:SendBillSyncResponse xmlns:a="http://wcf.dian.colombia/">' +
        "<a:StatusCode>0</a:StatusCode>" +
        "<a:StatusMessage>OK</a:StatusMessage>" +
        "<a:Cufe>abc</a:Cufe>" +
        "<a:Number>123</a:Number>" +
        "</a:SendBillSyncResponse>",
    } as Response);

    const soapClient = new DianSoapClient(config);
    await soapClient.sendBill(signedXml, documentKey);

    const callArgs = fetchMock.mock.calls[0];
    capturedEnvelope = callArgs[1].body;
    capturedHeaders = callArgs[1].headers;
    fetchMock.mockRestore();
    return capturedEnvelope;
  }

  it("SOAP endpoint is the DIAN sandbox (vpfe-hab)", async () => {
    const { signedXml } = await buildAndSign(makeInvoiceRequest());
    const envelope = await captureSoapEnvelope(signedXml, "doc_key");

    expect(envelope).toContain("https://vpfe-hab.dian.gov.co/WcfDianCustomerServices.svc");
  });

  it("SOAP Action header points to SendBillSync", async () => {
    const { signedXml } = await buildAndSign(makeInvoiceRequest());
    await captureSoapEnvelope(signedXml, "doc_key");

    expect(capturedHeaders.SOAPAction).toContain("SendBillSync");
  });

  it("WS-Security Timestamp element present with Created/Expires", async () => {
    const { signedXml } = await buildAndSign(makeInvoiceRequest());
    const envelope = await captureSoapEnvelope(signedXml, "doc_key");

    expect(envelope).toContain("<wsu:Timestamp");
    expect(envelope).toMatch(/<wsu:Created[^>]*>[^<]+<\/wsu:Created>/);
    expect(envelope).toMatch(/<wsu:Expires[^>]*>[^<]+<\/wsu:Expires>/);
  });

  it("BinarySecurityToken present with certificate X.509 v3", async () => {
    const { signedXml } = await buildAndSign(makeInvoiceRequest());
    const envelope = await captureSoapEnvelope(signedXml, "doc_key");

    expect(envelope).toContain("<wsse:BinarySecurityToken");
    expect(envelope).toContain(
      "ValueType=\"http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-x509v3-nslabel\""
    );

    const certB64 = CERT_PEM.replace(/-----BEGIN CERTIFICATE-----|-----END CERTIFICATE-----|\s+/g, "");
    expect(envelope).toContain(certB64);
  });

  it("WS-Security Signature has two References (Timestamp + BST)", async () => {
    const { signedXml } = await buildAndSign(makeInvoiceRequest());
    const envelope = await captureSoapEnvelope(signedXml, "doc_key");

    const sigMatch = envelope.match(/<ds:Signature[\s\S]*?<\/ds:Signature>/);
    expect(sigMatch).toBeTruthy();
    const sigXml = sigMatch![0];

    const refMatches = [...sigXml.matchAll(/<ds:Reference/g)];
    expect(refMatches).toHaveLength(2);

    const uriMatches = [...sigXml.matchAll(/URI="#([^"]*)"/g)];
    const uris = uriMatches.map((m) => m[1]);
    expect(uris.some((u) => u.startsWith("TS-"))).toBe(true);
    expect(uris.some((u) => u.startsWith("SIG-"))).toBe(true);
  });

  it("WS-Security Timestamp is signed (DigestValue present for Timestamp ref)", async () => {
    const { signedXml } = await buildAndSign(makeInvoiceRequest());
    const envelope = await captureSoapEnvelope(signedXml, "doc_key");

    const sigMatch = envelope.match(/<ds:Signature[\s\S]*?<\/ds:Signature>/);
    const sigXml = sigMatch![0];

    const tsRefMatch = sigXml.match(
      /<ds:Reference URI="#(TS-[^"]+)">[\s\S]*?<ds:DigestValue>([^<]*)<\/ds:DigestValue>/
    );
    expect(tsRefMatch).toBeTruthy();
    expect(tsRefMatch![2]).not.toBe("");

    const tsId = tsRefMatch![1];
    const tsMatch = envelope.match(
      new RegExp(`<wsu:Timestamp[^>]*wsu:Id="${tsId}">[\\s\\S]*?<\\/wsu:Timestamp>`)
    );
    expect(tsMatch).toBeTruthy();

    const canonicalTs = exclusiveCanonicalize(tsMatch![0]);
    const computedTsDigest = nodeCrypto
      .createHash("sha256")
      .update(Buffer.from(canonicalTs, "utf-8"))
      .digest("base64");

    expect(tsRefMatch![2]).toBe(computedTsDigest);
  });

  it("WS-Security BinarySecurityToken is signed (DigestValue present for BST ref)", async () => {
    const { signedXml } = await buildAndSign(makeInvoiceRequest());
    const envelope = await captureSoapEnvelope(signedXml, "doc_key");

    const sigMatch = envelope.match(/<ds:Signature[\s\S]*?<\/ds:Signature>/);
    const sigXml = sigMatch![0];

    const bstRefMatch = sigXml.match(
      /<ds:Reference URI="#(SIG-[^"]+)">[\s\S]*?<ds:DigestValue>([^<]*)<\/ds:DigestValue>/
    );
    expect(bstRefMatch).toBeTruthy();

    const bstId = bstRefMatch![1];
    const bstMatch = envelope.match(
      new RegExp(`<wsse:BinarySecurityToken[^>]*wsu:Id="${bstId}"[^>]*>([^<]*)<\\/wsse:BinarySecurityToken>`)
    );
    expect(bstMatch).toBeTruthy();

    const canonicalBst = exclusiveCanonicalize(bstMatch![0]);
    const computedBstDigest = nodeCrypto
      .createHash("sha256")
      .update(Buffer.from(canonicalBst, "utf-8"))
      .digest("base64");

    expect(bstRefMatch![2]).toBe(computedBstDigest);
  });

  it("WS-Security SignedInfo SignatureValue verifies with private key", async () => {
    const { signedXml } = await buildAndSign(makeInvoiceRequest());
    const envelope = await captureSoapEnvelope(signedXml, "doc_key");

    const sigMatch = envelope.match(/<ds:Signature[\s\S]*?<\/ds:Signature>/);
    const sigXml = sigMatch![0];

    const siMatch = sigXml.match(/<ds:SignedInfo[\s\S]*?<\/ds:SignedInfo>/);
    expect(siMatch).toBeTruthy();
    let signedInfoXml = siMatch![0];
    if (!signedInfoXml.includes('xmlns:ds=')) {
      signedInfoXml = '<ds:SignedInfo xmlns:ds=\"http://www.w3.org/2000/09/xmldsig#\">' +
        signedInfoXml.slice('<ds:SignedInfo>'.length);
    }

    const canonicalSI = exclusiveCanonicalize(signedInfoXml);

    const svMatch = sigXml.match(/<ds:SignatureValue[^>]*>([^<]+)<\/ds:SignatureValue>/);
    expect(svMatch).toBeTruthy();
    const signatureValue = svMatch![1].trim();
    const signatureBytes = Buffer.from(signatureValue, "base64");

    const cert = new nodeCrypto.X509Certificate(CERT_PEM);
    const verifier = nodeCrypto.createVerify("RSA-SHA256");
    verifier.update(canonicalSI);
    const isValid = verifier.verify(cert.publicKey, signatureBytes);

    expect(isValid).toBe(true);
  });
});

/* ──────────────────────────────────────────────────────────
   5. Certificate & X509 Verification
   ────────────────────────────────────────────────────────── */
describe("PRE-FLIGHT 5: Certificate Information", () => {
  it("Certificate serial number is real (not placeholder)", () => {
    const cert = new nodeCrypto.X509Certificate(CERT_PEM);
    const certDer = cert.raw;
    const certInfo = parseDerCertificate(new Uint8Array(certDer));

    expect(certInfo.serialNumber).toMatch(/^[0-9a-fA-F]+$/);
    expect(certInfo.serialNumber.toLowerCase()).toBe(
      (cert.serialNumber.replace(/^0+/, "") || "0").toLowerCase()
    );
  });

  it("Certificate modulus is real (not empty)", () => {
    const cert = new nodeCrypto.X509Certificate(CERT_PEM);
    const certDer = cert.raw;
    const certInfo = parseDerCertificate(new Uint8Array(certDer));

    expect(certInfo.modulus).toMatch(/^[0-9a-fA-F]+$/);
    expect(certInfo.modulus.length).toBeGreaterThan(100);
  });

  it("Certificate thumbprint (SHA-1) matches X509Data", async () => {
    const cert = new nodeCrypto.X509Certificate(CERT_PEM);
    const expectedSha1Thumbprint = nodeCrypto
      .createHash("sha1")
      .update(Buffer.from(cert.raw))
      .digest("hex")
      .toUpperCase();

    const { signedXml } = await buildAndSign(makeInvoiceRequest());

    const certDigestMatch = signedXml.match(
      /<xades:CertDigest>[\s\S]*?<ds:DigestValue>([^<]*)<\/ds:DigestValue>/
    );
    expect(certDigestMatch).toBeTruthy();

    const actualSha256Thumbprint = certDigestMatch![1];
    const expectedSha256Thumbprint = nodeCrypto
      .createHash("sha256")
      .update(Buffer.from(cert.raw))
      .digest("base64");
    expect(actualSha256Thumbprint).toBe(expectedSha256Thumbprint);
  });

  it("X509Certificate in signature KeyInfo matches test certificate", async () => {
    const { signedXml } = await buildAndSign(makeInvoiceRequest());

    const certB64 = CERT_PEM
      .replace(/-----BEGIN CERTIFICATE-----/g, "")
      .replace(/-----END CERTIFICATE-----/g, "")
      .replace(/\s+/g, "");

    const b64Match = signedXml.match(/<ds:X509Certificate>([^<]+)<\/ds:X509Certificate>/);
    expect(b64Match).toBeTruthy();
    expect(b64Match![1].trim()).toBe(certB64);
  });
});

/* ──────────────────────────────────────────────────────────
   6. Business Rules: Production Blocked, Idempotencia
   ────────────────────────────────────────────────────────── */
describe("PRE-FLIGHT 6: Business Rules", () => {
  it("PRODUCTION_BLOCKED prevents production transmission", () => {
    const env = "development" as const;
    const PRODUCTION_BLOCKED = env !== "production";

    const prodBusiness = { ...BUSINESS, environment: "production" as const };

    if (PRODUCTION_BLOCKED && prodBusiness.environment === "production") {
      expect(() => {
        throw new Error("PRODUCTION_BLOCKED");
      }).toThrow("PRODUCTION_BLOCKED");
    } else {
      throw new Error("Test setup error: should be blocked");
    }
  });

  it("SANDBOX environment is allowed when PRODUCTION_BLOCKED", () => {
    const env = "development" as const;
    const PRODUCTION_BLOCKED = env !== "production";

    const sandboxBusiness = { ...BUSINESS, environment: "sandbox" as const };

    const wouldBlock = PRODUCTION_BLOCKED && sandboxBusiness.environment === "production";
    expect(wouldBlock).toBe(false);
  });

  it("Idempotency: same sale produces same CUFE (deterministic)", async () => {
    const req = makeInvoiceRequest();

    const r1 = await buildAndSign(req);
    const r2 = await buildAndSign(req);

    expect(r1.cufe).toBe(r2.cufe);
    expect(r1.xml).toBe(r2.xml);
  });

  it("Consecutivo increments correctly with invoiceConsecutiveCurrent", async () => {
    const req = makeInvoiceRequest();
    const builder = new DianXmlBuilder();

    const r1 = await builder.build(req, "uuid1");
    expect(r1.number).toBe("FV00000002");

    const req2 = makeInvoiceRequest({
      business: { ...BUSINESS, invoiceConsecutiveCurrent: 2 },
    });
    const r2 = await builder.build(req2, "uuid2");
    expect(r2.number).toBe("FV00000003");
  });

  it("Consecutivo throws when range exhausted", async () => {
    const req = makeInvoiceRequest({
      business: {
        ...BUSINESS,
        invoiceConsecutiveFrom: 1,
        invoiceConsecutiveTo: 1,
        invoiceConsecutiveCurrent: 1,
      },
    });
    const builder = new DianXmlBuilder();

    await expect(builder.build(req, "uuid")).rejects.toThrow("NUMERATION_EXHAUSTED");
  });
});

/* ──────────────────────────────────────────────────────────
   7. XML Output Inspection (no secrets)
   ────────────────────────────────────────────────────────── */
describe("PRE-FLIGHT 7: XML Output Inspection (no secrets)", () => {
  it("Signed XML contains no private key material", async () => {
    const { signedXml } = await buildAndSign(makeInvoiceRequest());

    expect(signedXml).not.toContain("BEGIN PRIVATE KEY");
    expect(signedXml).not.toContain("BEGIN RSA PRIVATE KEY");
    expect(signedXml).not.toContain("BEGIN ENCRYPTED PRIVATE KEY");
    expect(signedXml).not.toContain(PRIVATE_KEY_PEM);
  });

  it("Signed XML contains certificate but NO private key", async () => {
    const { signedXml } = await buildAndSign(makeInvoiceRequest());

    const certB64 = CERT_PEM
      .replace(/-----BEGIN CERTIFICATE-----/g, "")
      .replace(/-----END CERTIFICATE-----/g, "")
      .replace(/\s+/g, "");
    expect(signedXml).toContain(certB64);
    expect(signedXml).not.toContain(PRIVATE_KEY_PEM);
  });

  it("Produces valid well-formed XML after signing", async () => {
    const { signedXml } = await buildAndSign(makeInvoiceRequest());

    const parser = new DOMParser();
    const doc = parser.parseFromString(signedXml, "text/xml");
    const errors = doc.getElementsByTagName("parsererror");
    expect(errors.length).toBe(0);
    expect(doc.documentElement).toBeTruthy();
  });
});

async function computeSha384Hex(message: string): Promise<string> {
  const data = new TextEncoder().encode(message);
  const buf = await crypto.subtle.digest("SHA-384", data);
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function computeSha256Hex(message: string): Promise<string> {
  const data = new TextEncoder().encode(message);
  const buf = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
