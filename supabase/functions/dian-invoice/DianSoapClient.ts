// ============================================================================
// DianSoapClient.ts
// ----------------------------------------------------------------------------
// Cliente SOAP REAL para los Web Services de la DIAN.
//
// Fuentes oficiales consultadas:
//   - Anexo Técnico de Factura Electrónica de Venta v1.9 (Resolución 000165/2023)
//   - Guía Herramienta para el Consumo de Web Services (DIAN)
//   - WSDL oficial: https://vpfe-hab.dian.gov.co/WcfDianCustomerServices.svc?singleWsdl
//
// Endpoints oficiales (obtenidos del WSDL):
//   - Habilitación (sandbox): https://vpfe-hab.dian.gov.co/WcfDianCustomerServices.svc
//   - Producción:             https://vpfe.dian.gov.co/WcfDianCustomerServices.svc
//
// Operaciones soportadas (según WSDL):
//   - SendBillSync          → envío individual de factura firmada (síncrono)
//   - SendTestSetAsync      → envío de set de pruebas (asíncrono) — para habilitación
//   - GetStatus             → consulta estado de un documento por CUFE
//   - GetReferenceNotes     → consulta notas crédito/débito asociadas
//
// Autenticación (según Guía Herramienta Web Services DIAN):
//   - WS-Security Signature: firma XML con certificado digital (.p12/.pfx)
//   - WS-Security Timestamp: para prevenir replay attacks
//   - WS-A Addressing: wsa:To, wsa:Action
//
// NO se usa OAuth2, NO se usa token Bearer para la transmisión SOAP.
// La autenticación es 100% basada en certificado digital.
// ============================================================================

import { parseDerCertificate, pemToPrivateKey, uint8ArrayToBase64, base64ToUint8Array, computeSha256, exclusiveCanonicalize } from "./DianSigner.ts";

export type DianEnvironment = "habilantation" | "production";

export interface DianSoapConfig {
  environment: DianEnvironment;
  nit: string;
  softwareId: string;
  softwareCode: string;
  certPem: string;
  privateKeyPem: string;
  certPassword?: string;
  wsUsername?: string;
  wsPassword?: string;
}

interface DianSendBillSyncResponse {
  responseCode: string;
  responseMessage: string;
  cufe?: string;
  invoiceNumber?: string;
  status: "ACCEPTED" | "REJECTED" | "PENDING" | "ERROR";
  errors?: Array<{ code: string; message: string; field?: string }>;
  rawXml: string;
}

interface DianGetStatusResponse {
  status: "ACCEPTED" | "REJECTED" | "PENDING";
  responseCode: string;
  responseMessage: string;
  cufe?: string;
  errors?: Array<{ code: string; message: string; field?: string }>;
  rawXml: string;
}

function getSoapEndpoint(environment: DianEnvironment): string {
  if (environment === "production") {
    return "https://vpfe.dian.gov.co/WcfDianCustomerServices.svc";
  }
  return "https://vpfe-hab.dian.gov.co/WcfDianCustomerServices.svc";
}

const WS_NAMESPACE = "http://wcf.dian.colombia/";
const SOAP_NS = "http://schemas.xmlsoap.org/soap/envelope/";

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function buildTimestampElement(id: string): string {
  const wsU = "http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-utility-0.1.xsd";
  const created = new Date().toISOString();
  const expires = new Date(Date.now() + 300000).toISOString();
  return `<wsu:Timestamp xmlns:wsu="${wsU}" wsu:Id="${id}">
<wsu:Created>${created}</wsu:Created>
<wsu:Expires>${expires}</wsu:Expires>
</wsu:Timestamp>`;
}

function buildBinarySecurityToken(id: string, certPem: string): string {
  const wsse = "http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-secext-0.1.xsd";
  const wsu = "http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-utility-0.1.xsd";
  const certB64 = certPem
    .replace(/-----BEGIN CERTIFICATE-----/g, "")
    .replace(/-----END CERTIFICATE-----/g, "")
    .replace(/\s+/g, "");

  return `<wsse:BinarySecurityToken xmlns:wsse="${wsse}" xmlns:wsu="${wsu}"
  wsu:Id="${id}"
  EncodingType="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-base64binary-SSF-1.0"
  ValueType="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-x509v3-nslabel">${certB64}</wsse:BinarySecurityToken>`;
}

function buildSoapEnvelope(
  config: DianSoapConfig,
  operation: "SendBillSync" | "GetStatus" | "SendTestSetAsync" | "GetStatusZip" | "GetReferenceNotes",
  bodyContent: string,
  signature: { timestampId: string; signatureId: string; timestamp: string; bst: string; signedInfo: string; signatureValue: string; timestampDigest: string; certDigest: string; certThumbprint: string }
): string {
  const soapAction = `http://wcf.dian.colombia/IWcfDianCustomerServices/${operation}`;

  return `<?xml version="1.0" encoding="utf-8"?>
<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"
               xmlns:wsse="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-secext-0.1.xsd"
               xmlns:wsu="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-utility-0.1.xsd"
               xmlns:ds="http://www.w3.org/2000/09/xmldsig#"
               xmlns:wsa="http://www.w3.org/2005/08/addressing">
  <soap:Header>
    <wsa:To>${escapeXml(getSoapEndpoint(config.environment))}</wsa:To>
    <wsa:Action>${escapeXml(soapAction)}</wsa:Action>
    <wsa:ReplyTo>
      <wsa:Address>http://www.w3.org/2005/08/addressing/anonymous</wsa:Address>
    </wsa:ReplyTo>
    <wsa:MessageID>urn:uuid:${crypto.randomUUID()}</wsa:MessageID>
    <wsse:Security soap:mustUnderstand="1">
      ${signature.timestamp}
      ${signature.bst}
      <ds:Signature Id="${signature.signatureId}">
        ${signature.signedInfo}
        <ds:SignatureValue>${signature.signatureValue}</ds:SignatureValue>
        <ds:KeyInfo Id="KI">
          <ds:X509Data>
            <ds:X509Certificate>${config.certPem.replace(/-----BEGIN CERTIFICATE-----/g, "").replace(/-----END CERTIFICATE-----/g, "").replace(/\s+/g, "")}</ds:X509Certificate>
          </ds:X509Data>
        </ds:KeyInfo>
      </ds:Signature>
    </wsse:Security>
  </soap:Header>
  <soap:Body>
    ${bodyContent}
  </soap:Body>
</soap:Envelope>`;
}

async function buildSecuritySignature(
  config: DianSoapConfig,
  timestampId: string,
  signatureId: string
): Promise<{ timestampId: string; signatureId: string; timestamp: string; bst: string; signedInfo: string; timestampDigest: string; certDigest: string; signatureValue: string }> {
  const privateKey = await pemToPrivateKey(config.privateKeyPem);

  const timestamp = buildTimestampElement(timestampId);
  const bst = buildBinarySecurityToken(signatureId, config.certPem);

  // Compute digest of canonicalized Timestamp
  const canonTimestamp = exclusiveCanonicalize(timestamp);
  const timestampDigest = await computeSha256(new TextEncoder().encode(canonTimestamp));

  // Compute digest of canonicalized BinarySecurityToken
  const canonBst = exclusiveCanonicalize(bst);
  const certDigest = await computeSha256(new TextEncoder().encode(canonBst));

  // Build SignedInfo
  const certB64 = config.certPem
    .replace(/-----BEGIN CERTIFICATE-----/g, "")
    .replace(/-----END CERTIFICATE-----/g, "")
    .replace(/\s+/g, "");

  const signedInfo = `<ds:SignedInfo xmlns:ds="http://www.w3.org/2000/09/xmldsig#">
<ds:CanonicalizationMethod Algorithm="http://www.w3.org/2001/10/xml-exc-c14n#" />
<ds:SignatureMethod Algorithm="http://www.w3.org/2001/04/xmldsig-more#rsa-sha256" />
<ds:Reference URI="#${timestampId}">
<ds:Transforms>
<ds:Transform Algorithm="http://www.w3.org/2001/10/xml-exc-c14n#" />
</ds:Transforms>
<ds:DigestMethod Algorithm="http://www.w3.org/2001/04/xmldsig-more#sha256" />
<ds:DigestValue>${timestampDigest}</ds:DigestValue>
</ds:Reference>
<ds:Reference URI="#${signatureId}">
<ds:Transforms>
<ds:Transform Algorithm="http://www.w3.org/2001/10/xml-exc-c14n#" />
</ds:Transforms>
<ds:DigestMethod Algorithm="http://www.w3.org/2001/04/xmldsig-more#sha256" />
<ds:DigestValue>${certDigest}</ds:DigestValue>
</ds:Reference>
</ds:SignedInfo>`;

  // Canonicalize SignedInfo and sign it
  const canonicalSignedInfo = exclusiveCanonicalize(signedInfo);
  const signature = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    privateKey,
    new TextEncoder().encode(canonicalSignedInfo)
  );
  const signatureValue = uint8ArrayToBase64(new Uint8Array(signature));

  return { timestampId, signatureId, timestamp, bst, signedInfo, timestampDigest, certDigest, signatureValue };
}

function buildSendBillSyncBody(
  signedXml: string,
  documentKey: string
): string {
  const xmlContent = escapeXml(signedXml);

  return `<ms1:SendBillSync xmlns:ms1="${WS_NAMESPACE}">
  <ms1:request>
    <ms1:documentKey>${escapeXml(documentKey)}</ms1:documentKey>
    <ms1:xmlContent>${xmlContent}</ms1:xmlContent>
  </ms1:request>
</ms1:SendBillSync>`;
}

function buildGetStatusBody(documentKey: string): string {
  return `<ms1:GetStatus xmlns:ms1="${WS_NAMESPACE}">
  <ms1:documentKey>${escapeXml(documentKey)}</ms1:documentKey>
</ms1:GetStatus>`;
}

function parseSendBillSyncResponse(rawXml: string): DianSendBillSyncResponse {
  const statusMatch = rawXml.match(/<a:StatusCode[^>]*>([^<]*)<\/a:StatusCode>/);
  const messageMatch = rawXml.match(/<a:StatusMessage[^>]*>([^<]*)<\/a:StatusMessage>/);
  const cufeMatch = rawXml.match(/<a:Cufe[^>]*>([^<]*)<\/a:Cufe>/);
  const numberMatch = rawXml.match(/<a:Number[^>]*>([^<]*)<\/a:Number>/);

  const statusCode = statusMatch?.[1].trim() ?? "";
  const statusMessage = messageMatch?.[1].trim() ?? "";
  const cufe = cufeMatch?.[1].trim();
  const invoiceNumber = numberMatch?.[1].trim();

  const errorMatches = [...rawXml.matchAll(/<a:Error[^>]*>([\s\S]*?)<\/a:Error>/g)];
  const errors = errorMatches.map((m) => {
    const codeMatch = m[1].match(/<a:Code[^>]*>([^<]*)<\/a:Code>/);
    const msgMatch = m[1].match(/<a:Message[^>]*>([^<]*)<\/a:Message>/);
    const fieldMatch = m[1].match(/<a:Field[^>]*>([^<]*)<\/a:Field>/);
    return {
      code: codeMatch?.[1].trim() ?? "",
      message: msgMatch?.[1].trim() ?? "",
      field: fieldMatch?.[1].trim(),
    };
  });

  let status: DianSendBillSyncResponse["status"];
  if (statusCode === "0") {
    status = "ACCEPTED";
  } else if (errors.length > 0) {
    status = "REJECTED";
  } else {
    status = "ERROR";
  }

  return {
    responseCode: statusCode,
    responseMessage: statusMessage,
    cufe,
    invoiceNumber,
    status,
    errors,
    rawXml,
  };
}

function parseGetStatusResponse(rawXml: string): DianGetStatusResponse {
  const statusMatch = rawXml.match(/<a:StatusCode[^>]*>([^<]*)<\/a:StatusCode>/);
  const messageMatch = rawXml.match(/<a:StatusMessage[^>]*>([^<]*)<\/a:StatusMessage>/);
  const cufeMatch = rawXml.match(/<a:Cufe[^>]*>([^<]*)<\/a:Cufe>/);

  const statusCode = statusMatch?.[1].trim() ?? "";
  const statusMessage = messageMatch?.[1].trim() ?? "";
  const cufe = cufeMatch?.[1].trim();

  const errorMatches = [...rawXml.matchAll(/<a:Error[^>]*>([\s\S]*?)<\/a:Error>/g)];
  const errors = errorMatches.map((m) => {
    const codeMatch = m[1].match(/<a:Code[^>]*>([^<]*)<\/a:Code>/);
    const msgMatch = m[1].match(/<a:Message[^>]*>([^<]*)<\/a:Message>/);
    const fieldMatch = m[1].match(/<a:Field[^>]*>([^<]*)<\/a:Field>/);
    return {
      code: codeMatch?.[1].trim() ?? "",
      message: msgMatch?.[1].trim() ?? "",
      field: fieldMatch?.[1].trim(),
    };
  });

  let status: DianGetStatusResponse["status"];
  if (statusCode === "0" || statusCode === "ACCEPTED") {
    status = "ACCEPTED";
  } else if (errors.length > 0) {
    status = "REJECTED";
  } else {
    status = "PENDING";
  }

  return {
    status,
    responseCode: statusCode,
    responseMessage: statusMessage,
    cufe,
    errors,
    rawXml,
  };
}

const PERMANENT_ERROR_PATTERNS: RegExp[] = [
  /invalid xml/i,
  /invalid nit/i,
  /certificate expired/i,
  /numeraci[oó]n/i,
  /clave t[eé]cnica/i,
  /schema validation/i,
  /documento duplicado/i,
  /tipo de documento/i,
];

export function isRetryableError(message: string): boolean {
  const isPermanent = PERMANENT_ERROR_PATTERNS.some((p) => p.test(message));
  return !isPermanent;
}

export class DianSoapClient {
  private config: DianSoapConfig;

  constructor(config: DianSoapConfig) {
    this.config = config;

    if (!config.nit) {
      throw new Error("DIAN_CONFIG_MISSING: NIT del emisor es obligatorio.");
    }
    if (!config.softwareId) {
      throw new Error("DIAN_CONFIG_MISSING: softwareId es obligatorio.");
    }
    if (!config.softwareCode) {
      throw new Error("DIAN_CONFIG_MISSING: softwareCode es obligatorio.");
    }
    if (!config.certPem || !config.privateKeyPem) {
      throw new Error("DIAN_CONFIG_MISSING: certificado y clave privada son obligatorios.");
    }
  }

  async sendBill(signedXml: string, documentKey: string): Promise<DianSendBillSyncResponse> {
    const body = buildSendBillSyncBody(signedXml, documentKey);
    const envelope = await this.buildSignedSoapEnvelope("SendBillSync", body);

    const endpoint = getSoapEndpoint(this.config.environment);

    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/soap+xml; charset=utf-8",
        SOAPAction: `"http://wcf.dian.colombia/IWcfDianCustomerServices/SendBillSync"`,
        Accept: "text/xml",
        "User-Agent": "VIMDY-DIAN/1.0",
      },
      body: envelope,
    });

    if (!response.ok) {
      const text = await response.text().catch(() => "");
      return {
        responseCode: response.status.toString(),
        responseMessage: `HTTP ${response.status}: ${response.statusText}`,
        status: "ERROR",
        errors: [{ code: response.status.toString(), message: text }],
        rawXml: text,
      };
    }

    const rawXml = await response.text();
    return parseSendBillSyncResponse(rawXml);
  }

  async getStatus(documentKey: string): Promise<DianGetStatusResponse> {
    const body = buildGetStatusBody(documentKey);
    const envelope = await this.buildSignedSoapEnvelope("GetStatus", body);

    const endpoint = getSoapEndpoint(this.config.environment);

    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/soap+xml; charset=utf-8",
        SOAPAction: `"http://wcf.dian.colombia/IWcfDianCustomerServices/GetStatus"`,
        Accept: "text/xml",
        "User-Agent": "VIMDY-DIAN/1.0",
      },
      body: envelope,
    });

    if (!response.ok) {
      const text = await response.text().catch(() => "");
      return {
        status: "ERROR",
        responseCode: response.status.toString(),
        responseMessage: `HTTP ${response.status}: ${response.statusText}`,
        errors: [{ code: response.status.toString(), message: text }],
        rawXml: text,
      };
    }

    const rawXml = await response.text();
    return parseGetStatusResponse(rawXml);
  }

  async sendTestSet(
    signedXmls: Array<{ xml: string; documentKey: string }>,
    testSetId: string
  ): Promise<{ responseCode: string; responseMessage: string; rawXml: string }> {
    const documents = signedXmls
      .map(
        ({ xml, documentKey }) => `<ms1:Document>
  <ms1:documentKey>${escapeXml(documentKey)}</ms1:documentKey>
  <ms1:xmlContent>${escapeXml(xml)}</ms1:xmlContent>
</ms1:Document>`
      )
      .join("\n");

    const body = `<ms1:SendTestSetAsync xmlns:ms1="${WS_NAMESPACE}">
  <ms1:testSetId>${escapeXml(testSetId)}</ms1:testSetId>
  <ms1:documents>
    ${documents}
  </ms1:documents>
</ms1:SendTestSetAsync>`;

    const envelope = await this.buildSignedSoapEnvelope("SendTestSetAsync", body);
    const endpoint = getSoapEndpoint(this.config.environment);

    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/soap+xml; charset=utf-8",
        SOAPAction: `"http://wcf.dian.colombia/IWcfDianCustomerServices/SendTestSetAsync"`,
        Accept: "text/xml",
        "User-Agent": "VIMDY-DIAN/1.0",
      },
      body: envelope,
    });

    const rawXml = await response.text().catch(() => "");
    const codeMatch = rawXml.match(/<a:StatusCode[^>]*>([^<]*)<\/a:StatusCode>/);
    const msgMatch = rawXml.match(/<a:StatusMessage[^>]*>([^<]*)<\/a:StatusMessage>/);

    return {
      responseCode: codeMatch?.[1].trim() ?? response.status.toString(),
      responseMessage: msgMatch?.[1].trim() ?? `HTTP ${response.status}`,
      rawXml,
    };
  }

  async getReferenceNotes(documentKey: string): Promise<{
    notes: Array<{ cufe: string; documentType: "CREDIT_NOTE" | "DEBIT_NOTE"; status: string }>;
    rawXml: string;
  }> {
    const body = `<ms1:GetReferenceNotes xmlns:ms1="${WS_NAMESPACE}">
  <ms1:documentKey>${escapeXml(documentKey)}</ms1:documentKey>
</ms1:GetReferenceNotes>`;

    const envelope = await this.buildSignedSoapEnvelope("GetReferenceNotes", body);
    const endpoint = getSoapEndpoint(this.config.environment);

    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/soap+xml; charset=utf-8",
        SOAPAction: `"http://wcf.dian.colombia/IWcfDianCustomerServices/GetReferenceNotes"`,
        Accept: "text/xml",
        "User-Agent": "VIMDY-DIAN/1.0",
      },
      body: envelope,
    });

    const rawXml = await response.text().catch(() => "");
    const noteMatches = [...rawXml.matchAll(/<a:Note[^>]*>([\s\S]*?)<\/a:Note>/g)];

    const notes = noteMatches.map((m) => {
      const cufeMatch = m[1].match(/<a:Cufe[^>]*>([^<]*)<\/a:Cufe>/);
      const typeMatch = m[1].match(/<a:DocumentType[^>]*>([^<]*)<\/a:DocumentType>/);
      const statusMatch = m[1].match(/<a:Status[^>]*>([^<]*)<\/a:Status>/);

      const docType = typeMatch?.[1].trim() ?? "";
      return {
        cufe: cufeMatch?.[1].trim() ?? "",
        documentType: (docType === "02" ? "CREDIT_NOTE" : docType === "03" ? "DEBIT_NOTE" : "CREDIT_NOTE") as "CREDIT_NOTE" | "DEBIT_NOTE",
        status: statusMatch?.[1].trim() ?? "",
      };
    });

    return { notes, rawXml };
  }

  private async buildSignedSoapEnvelope(
    operation: "SendBillSync" | "GetStatus" | "SendTestSetAsync" | "GetStatusZip" | "GetReferenceNotes",
    bodyContent: string
  ): Promise<string> {
    const timestampId = `TS-${crypto.randomUUID()}`;
    const signatureId = `SIG-${crypto.randomUUID()}`;

    const signature = await buildSecuritySignature(
      this.config,
      timestampId,
      signatureId
    );

    return buildSoapEnvelope(
      this.config,
      operation,
      bodyContent,
      signature
    );
  }
}
