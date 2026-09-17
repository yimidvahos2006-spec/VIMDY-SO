// ============================================================================
// DianSigner.ts
// ----------------------------------------------------------------------------
// Firma digital XAdES-EPES (XMLDSig enveloped + XAdES-EPES) conforme al
// Anexo Técnico de Factura Electrónica de Venta v1.9 (Resolución 000165/2023).
//
// La DIAN exige:
//   - XMLDSig enveloped: la firma se inserta DENTRO del documento XML
//   - XAdES-EPES: contiene SignaturePolicyIdentifier con la política de firma
//   - Canonicalización: Exclusive C14N (http://www.w3.org/2001/10/xml-exc-c14n#)
//   - SignatureMethod: rsa-sha256
//   - DigestMethod: SHA-256
//   - Certificado X.509 con cadena completa
//
// Política de firma DIAN (XAdES-EPES):
//   PolicyIdentifier: urn:oid:1.3.6.1.4.1.27194.1.1.1.1.1
//   PolicyDescription: "Política de firma electrónica del sistema de
//                      facturación electrónica de la DIAN"
// ============================================================================

const CANONICALIZATION_METHOD = "http://www.w3.org/2001/10/xml-exc-c14n#";
const SIGNATURE_METHOD = "http://www.w3.org/2001/04/xmldsig-more#rsa-sha256";
const DIGEST_METHOD = "http://www.w3.org/2001/04/xmldsig-more#sha256";

const XADES_NAMESPACE = "http://uri.etsi.org/01/XAdES/v1.3.2";
const XMLDSIG_NAMESPACE = "http://www.w3.org/2000/09/xmldsig#";
const WSU_NAMESPACE = "http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-utility-0.1.xsd";

const SIGNATURE_POLICY_OID = "urn:oid:1.3.6.1.4.1.27194.1.1.1.1.1";
const SIGNATURE_POLICY_DESCRIPTION =
  "Política de firma electrónica del sistema de facturación electrónica de la DIAN";

const UBL_EXT_NAMESPACE = "urn:oasis:names:specification:ubl:schema:xsd:CommonExtensionComponents-2";

function escapeXmlAttr(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function pemToDerBase64(pem: string): string {
  return pem
    .replace(/-----BEGIN[^]*?-----/, "")
    .replace(/-----END[^]*?-----/, "")
    .replace(/\s+/g, "");
}

export function base64ToUint8Array(b64: string): Uint8Array {
  const binary = atob(b64);
  const result = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    result[i] = binary.charCodeAt(i);
  }
  return result;
}

export function uint8ArrayToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

export async function computeSha256(data: string | Uint8Array): Promise<string> {
  const dataBytes = typeof data === "string" ? new TextEncoder().encode(data) : data;
  const hashBuffer = await crypto.subtle.digest("SHA-256", dataBytes);
  return uint8ArrayToBase64(new Uint8Array(hashBuffer));
}

export function pemToPrivateKey(pem: string): Promise<CryptoKey> {
  const derBase64 = pemToDerBase64(pem);
  const keyBytes = base64ToUint8Array(derBase64);

  return crypto.subtle.importKey(
    "pkcs8",
    keyBytes,
    {
      name: "RSASSA-PKCS1-v1_5",
      hash: { name: "SHA-256" },
    },
    false,
    ["sign"]
  );
}

function extractCertificateFromPem(pem: string): string {
  return pem
    .replace(/-----BEGIN CERTIFICATE-----/, "")
    .replace(/-----END CERTIFICATE-----/, "")
    .replace(/\s+/g, "");
}

function getCurrentTimestamp(): string {
  return new Date().toISOString();
}

function generateId(prefix: string): string {
  return `${prefix}-${crypto.randomUUID()}`;
}

export function parseDerCertificate(derBytes: Uint8Array): {
  serialNumber: string;
  modulus: string;
  issuer: string;
} {
  let offset = 0;

  function readByte(): number {
    return derBytes[offset++];
  }

  function readLength(): number {
    const first = readByte();
    if (first < 0x80) return first;
    const numBytes = first & 0x7f;
    let len = 0;
    for (let i = 0; i < numBytes; i++) {
      len = (len << 8) | readByte();
    }
    return len;
  }

  function readInteger(): Uint8Array {
    const tag = readByte();
    if (tag !== 0x02) throw new Error("Expected INTEGER");
    const len = readLength();
    const result = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
      result[i] = readByte();
    }
    return result;
  }

  function readSequenceBytes(): Uint8Array {
    const tag = readByte();
    if (tag !== 0x30) throw new Error("Expected SEQUENCE");
    const len = readLength();
    const start = offset;
    offset += len;
    return derBytes.slice(start, start + len);
  }

  function skipSequence(): void {
    const tag = readByte();
    if (tag !== 0x30) throw new Error("Expected SEQUENCE");
    const len = readLength();
    offset += len;
  }

  function skipInteger(): void {
    const tag = readByte();
    if (tag !== 0x02) throw new Error("Expected INTEGER");
    const len = readLength();
    offset += len;
  }

  // 1. Outer Certificate SEQUENCE
  const certTag = readByte();
  if (certTag !== 0x30) throw new Error("Expected outer SEQUENCE");
  const certLen = readLength();
  // offset now points to start of TBS Certificate content

  // 2. TBS Certificate SEQUENCE
  const tbsStart = offset;
  const tbsTag = readByte();
  if (tbsTag !== 0x30) throw new Error("Expected TBS Certificate SEQUENCE");
  const tbsLen = readLength();
  // offset now points to start of TBS content (version/serial/etc.)

  // 3. Version [0] EXPLICIT (optional)
  const versionTag = readByte();
  let version: Uint8Array | null = null;
  if (versionTag === (0xa0 | 0)) {
    const verLen = readLength();
    version = derBytes.slice(offset, offset + verLen);
    offset += verLen;
  } else {
    offset--;
  }

  // 4. Serial Number (INTEGER)
  const serialNumber = readInteger();

  // 5. Skip signature algorithm
  skipSequence();

  // 6. Issuer (Name = SEQUENCE)
  const issuerStart = offset;
  skipSequence();
  const issuer = derBytes.slice(issuerStart, offset);

  // 7. Skip validity (SEQUENCE)
  skipSequence();

  // 8. Skip subject (SEQUENCE)
  skipSequence();

  // 9. SubjectPublicKeyInfo (SEQUENCE)
  const spkiStart = offset;
  skipSequence();
  const spki = derBytes.slice(spkiStart, offset);

  // Extract serial number as hex
  let serialHex = "";
  if (serialNumber) {
    serialHex = Array.from(serialNumber)
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
    serialHex = serialHex.replace(/^0+/, "") || "0";
  }

  // Extract modulus from SubjectPublicKeyInfo
  let modulusHex = "";
  if (spki) {
    let spkiOffset = 0;

    function readSpkiByte(): number {
      return spki[spkiOffset++];
    }

    function readSpkiLength(): number {
      const first = readSpkiByte();
      if (first < 0x80) return first;
      const numBytes = first & 0x7f;
      let len = 0;
      for (let i = 0; i < numBytes; i++) {
        len = (len << 8) | readSpkiByte();
      }
      return len;
    }

    function readSpkiSequence(): number {
      const tag = readSpkiByte();
      if (tag !== 0x30) throw new Error("Expected SEQUENCE in public key");
      return readSpkiLength();
    }

    function readSpkiInteger(): string {
      const tag = readSpkiByte();
      if (tag !== 0x02) throw new Error("Expected INTEGER in public key");
      const len = readSpkiLength();
      const bytes: number[] = [];
      for (let i = 0; i < len; i++) {
        bytes.push(readSpkiByte());
      }
      return bytes.map((b) => b.toString(16).padStart(2, "0")).join("");
    }

    // SPKI: SEQUENCE (AlgorithmIdentifier) + BIT STRING (SubjectPublicKey)
    // Skip outer SEQUENCE tag+length, then AlgorithmIdentifier SEQUENCE
    readSpkiByte(); // outer SEQUENCE tag
    readSpkiLength(); // outer SEQUENCE length
    readSpkiByte(); // AlgorithmIdentifier SEQUENCE tag
    const algoLen = readSpkiLength();
    spkiOffset += algoLen;

    // Read BIT STRING
    const bitTag = readSpkiByte();
    if (bitTag !== 0x03) throw new Error("Expected BIT STRING in SPKI");
    const bitLen = readSpkiLength();
    const unusedBits = readSpkiByte();
    // SubjectPublicKey is a SEQUENCE containing two INTEGERs (modulus, exponent)
    // The unusedBits byte (usually 0) is consumed; remaining bytes are the key
    const keyData = spki.slice(spkiOffset, spkiOffset + bitLen - 1);
    spkiOffset += bitLen - 1;

    // Parse the SubjectPublicKey SEQUENCE from keyData
    let keyOffset = 0;
    if (keyData[0] === 0x00 && keyData[1] === 0x30) {
      // Leading zero byte before SEQUENCE (BIT STRING unused bits = 0)
      keyOffset = 1;
    }

    // Read SEQUENCE tag and length
    if (keyData[keyOffset] !== 0x30) {
      throw new Error("Expected SEQUENCE in SubjectPublicKey");
    }
    keyOffset++;
    const seqLen = keyData[keyOffset];
    keyOffset = seqLen < 0x80 ? keyOffset + 1 : keyOffset + 1 + (seqLen & 0x7f);

    // Read modulus INTEGER
    if (keyData[keyOffset] !== 0x02) {
      throw new Error("Expected INTEGER (modulus) in SubjectPublicKey");
    }
    keyOffset++;
    let modLen;
    if (keyData[keyOffset] < 0x80) {
      modLen = keyData[keyOffset];
      keyOffset++;
    } else {
      const numBytes = keyData[keyOffset] & 0x7f;
      keyOffset++;
      modLen = 0;
      for (let i = 0; i < numBytes; i++) {
        modLen = (modLen << 8) | keyData[keyOffset];
        keyOffset++;
      }
    }

    const modBytes = Array.from(keyData.slice(keyOffset, keyOffset + modLen));
    modulusHex = modBytes
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
    // Remove leading zeros (RSA modulus may have a leading 0x00 for positive sign)
    modulusHex = modulusHex.replace(/^0+/, "");
  }

  // Extract issuer DN as base64
  let issuerStr = "";
  if (issuer) {
    issuerStr = uint8ArrayToBase64(issuer);
  }

  return {
    serialNumber: serialHex,
    modulus: modulusHex,
    issuer: issuerStr,
  };
}

export interface DianSignatureResult {
  signedXml: string;
  certificateThumbprint: string;
}

export async function signDianInvoice(
  xml: string,
  privateKeyPem: string,
  certPem: string
): Promise<DianSignatureResult> {
  const privateKey = await pemToPrivateKey(privateKeyPem);

  const signatureId = generateId("Signature");
  const timestampId = generateId("TS");
  const signedPropertiesId = generateId("SignedProperties");
  const keyInfoId = generateId("KI");

  const certDerBase64 = extractCertificateFromPem(certPem);
  const certDerBytes = base64ToUint8Array(certDerBase64);
  const certInfo = parseDerCertificate(certDerBytes);

  // Compute SHA-256 of certificate for thumbprint
  const certThumbprint = await computeSha256(certDerBytes);

  // Build XAdES SignedProperties
  const policyHash = await computeSha256(SIGNATURE_POLICY_DESCRIPTION);

  const signedProperties = `
    <xades:SignedProperties Id="${signedPropertiesId}">
      <xades:SignedInfo>
        <xades:SignaturePolicyIdentifier>
          <xades:SignaturePolicyId>
            <xades:Identifier>${SIGNATURE_POLICY_OID}</xades:Identifier>
            <xades:Description>${escapeXmlAttr(SIGNATURE_POLICY_DESCRIPTION)}</xades:Description>
            <xades:PolicyHash>
              <ds:DigestMethod Algorithm="${DIGEST_METHOD}" />
              <ds:DigestValue>${policyHash}</ds:DigestValue>
            </xades:PolicyHash>
          </xades:SignaturePolicyId>
        </xades:SignaturePolicyIdentifier>
        <xades:SigningCertificate>
          <xades:Cert>
            <xades:CertDigest>
              <ds:DigestMethod Algorithm="${DIGEST_METHOD}" />
              <ds:DigestValue>${certThumbprint}</ds:DigestValue>
            </xades:CertDigest>
            <xades:IssuerSerial>
              <xades:X509Serial>${certInfo.serialNumber}</xades:X509Serial>
            </xades:IssuerSerial>
          </xades:Cert>
        </xades:SigningCertificate>
        <xades:SignerRole>
          <xades:ClaimedRoles>
            <xades:ClaimedRole>OFE</xades:ClaimedRole>
          </xades:ClaimedRoles>
        </xades:SignerRole>
      </xades:SignedInfo>
      <xades:SignedContent>
        <xades:ContentType>text/xml</xades:ContentType>
      </xades:SignedContent>
    </xades:SignedProperties>`;

  const signedPropsBytes = new TextEncoder().encode(exclusiveCanonicalize(signedProperties.trim()));
  const signedPropsDigest = await computeSha256(signedPropsBytes);

  // Compute digest of the document (enveloped signature)
  // The document digest is computed over the canonicalized original XML
  // using Exclusive C14N, BEFORE the Signature element is inserted.
  // The enveloped-signature transform in the Reference ensures the Signature
  // element itself is excluded during verification.
  const canonicalizedDoc = exclusiveCanonicalize(xml);
  const docDigest = await computeSha256(new TextEncoder().encode(canonicalizedDoc));

  // Build the Signature element
  const signatureXml = `
<ds:Signature xmlns:ds="${XMLDSIG_NAMESPACE}"
              xmlns:xades="${XADES_NAMESPACE}"
              xmlns:wsu="${WSU_NAMESPACE}"
              Id="${signatureId}">
  <ds:SignedInfo>
    <ds:CanonicalizationMethod Algorithm="${CANONICALIZATION_METHOD}" />
    <ds:SignatureMethod Algorithm="${SIGNATURE_METHOD}" />
    <ds:Reference URI="">
      <ds:Transforms>
        <ds:Transform Algorithm="http://www.w3.org/2000/09/xmldsig#enveloped-signature" />
        <ds:Transform Algorithm="${CANONICALIZATION_METHOD}">
          <ec:InclusiveNamespaces xmlns:ec="${CANONICALIZATION_METHOD}" PrefixList="cac cbc ds ext xades xsi" />
        </ds:Transform>
      </ds:Transforms>
      <ds:DigestMethod Algorithm="${DIGEST_METHOD}" />
      <ds:DigestValue>${docDigest}</ds:DigestValue>
    </ds:Reference>
    <ds:Reference Type="http://uri.etsi.org/01/XAdES/v131#SignedProperties" URI="#${signedPropertiesId}">
      <ds:DigestMethod Algorithm="${DIGEST_METHOD}" />
      <ds:DigestValue>${signedPropsDigest}</ds:DigestValue>
    </ds:Reference>
  </ds:SignedInfo>
  <ds:SignatureValue Id="SIG">SIGNATURE_VALUE_PLACEHOLDER</ds:SignatureValue>
  <ds:KeyInfo Id="${keyInfoId}">
    <ds:X509Data>
      <ds:X509Certificate>${certDerBase64}</ds:X509Certificate>
    </ds:X509Data>
  </ds:KeyInfo>
  <ds:Object>
    <xades:QualifyingProperties xmlns:xades="${XADES_NAMESPACE}"
                                xmlns:ds="${XMLDSIG_NAMESPACE}"
                                Target="#${signatureId}">
      ${signedProperties}
      <xades:UnsignedProperties>
        <xades:UnsignedSignatureProperties>
          <xades:SignatureTimeStampToken>
            <ds:Signature>
              <ds:SignedInfo>
                <ds:CanonicalizationMethod Algorithm="${CANONICALIZATION_METHOD}" />
                <ds:SignatureMethod Algorithm="${SIGNATURE_METHOD}" />
                <ds:Reference URI="#${signatureId}">
                  <ds:DigestMethod Algorithm="${DIGEST_METHOD}" />
                  <ds:DigestValue>${docDigest}</ds:DigestValue>
                </ds:Reference>
              </ds:SignedInfo>
              <ds:SignatureValue Id="SIG_TS">TIMESTAMP_SIGNATURE_PLACEHOLDER</ds:SignatureValue>
              <ds:KeyInfo>
                <ds:X509Data>
                  <ds:X509Certificate>${certDerBase64}</ds:X509Certificate>
                </ds:X509Data>
              </ds:KeyInfo>
            </ds:Signature>
          </xades:SignatureTimeStampToken>
        </xades:UnsignedSignatureProperties>
      </xades:UnsignedProperties>
    </xades:QualifyingProperties>
  </ds:Object>
</ds:Signature>`;

  // Canonicalize the SignedInfo for signing
  const signedInfo = signatureXml.match(/<ds:SignedInfo>[\s\S]*?<\/ds:SignedInfo>/)?.[0];
  if (!signedInfo) {
    throw new Error("SIGNING_FAILED: no se pudo extraer SignedInfo");
  }

  const canonicalSignedInfo = exclusiveCanonicalize(signedInfo);
  const signature = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    privateKey,
    new TextEncoder().encode(canonicalSignedInfo)
  );
  const signatureB64 = uint8ArrayToBase64(new Uint8Array(signature));

  // Replace placeholders
  let signedXml = signatureXml.replace("SIGNATURE_VALUE_PLACEHOLDER", signatureB64);

  // Insert signature into the document
  signedXml = insertSignatureIntoDocument(xml, signedXml);

  return {
    signedXml,
    certificateThumbprint: certThumbprint,
  };
}

export function exclusiveCanonicalize(xml: string): string {
  // Remove XML declaration
  let result = xml.replace(/^<\?xml[^>]*\?>\s*/i, "");

  // Use DOMParser if available (Deno Deploy or @xmldom/xmldom in Node)
  try {
    const parser = new (globalThis as any).DOMParser();
    const doc = parser.parseFromString(result, "text/xml");
    if (doc && doc.documentElement && !(doc as any).getElementsByTagName?.("parsererror")?.length) {
      return canonicalizeNode(doc.documentElement);
    }
  } catch {
    // Fall through to string-based canonicalization
  }

  // String-based fallback: sort attributes in each element
  return sortAttributesInXml(result);
}

function canonicalizeNode(node: any, prefixList: string[] = []): string {
  if (!node) return "";

  if (node.nodeType === 3) {
    // Text node
    return node.nodeValue ?? "";
  }

  if (node.nodeType === 1) {
    // Element node
    let result = `<${node.nodeName}`;

    // Collect in-scope namespaces
    const nsMap: Record<string, string> = {};
    let current: any = node;
    while (current && current.nodeType === 1) {
      if (current.namespaceURI && current.prefix) {
        nsMap[current.prefix] = current.namespaceURI;
      }
      if (current === node) {
        // Include xmlns:* attributes
        for (let i = 0; i < current.attributes?.length; i++) {
          const attr = current.attributes[i];
          if (attr.nodeName?.startsWith("xmlns:")) {
            nsMap[attr.localName || attr.nodeName.substring(6)] = attr.nodeValue;
          }
        }
        // Also include default namespace
        for (let i = 0; i < current.attributes?.length; i++) {
          const attr = current.attributes[i];
          if (attr.nodeName === "xmlns") {
            nsMap[""] = attr.nodeValue;
          }
        }
      }
      current = current.parentNode;
    }

    // Output namespace declarations (sorted by prefix)
    const prefixes = Object.keys(nsMap).sort();
    for (const prefix of prefixes) {
      if (prefix === "") {
        result += ` xmlns="${escapeXmlAttr(nsMap[prefix])}"`;
      } else {
        result += ` xmlns:${prefix}="${escapeXmlAttr(nsMap[prefix])}"`;
      }
    }

    // Collect and sort regular attributes
    const attrs: Array<{ name: string; value: string; ns: string; local: string }> = [];
    if (node.attributes) {
      for (let i = 0; i < node.attributes.length; i++) {
        const attr = node.attributes[i];
        const name = attr.nodeName;
        if (!name.startsWith("xmlns")) {
          const ns = attr.namespaceURI || "";
          const local = attr.localName || name;
          attrs.push({ name, value: attr.nodeValue, ns, local });
        }
      }
    }

    // Sort by namespace URI, then local name
    attrs.sort((a, b) => {
      if (a.ns !== b.ns) return a.ns < b.ns ? -1 : 1;
      return a.local < b.local ? -1 : a.local > b.local ? 1 : 0;
    });

    for (const attr of attrs) {
      result += ` ${attr.name}="${escapeXmlAttr(attr.value)}"`;
    }

    result += ">";

    // Process children
    for (let i = 0; i < node.childNodes?.length; i++) {
      result += canonicalizeNode(node.childNodes[i], prefixList);
    }

    result += `</${node.nodeName}>`;
    return result;
  }

  return "";
}

function sortAttributesInXml(xml: string): string {
  // Sort attributes within each element tag
  return xml.replace(/<([^\s/>]+)([^>]*)\/?>/g, (match, tagName, attrs) => {
    const attrMap: Array<{ name: string; value: string }> = [];
    const attrRegex = /(\S+?)=["']([^"']*)["']/g;
    let m;
    while ((m = attrRegex.exec(attrs)) !== null) {
      attrMap.push({ name: m[1], value: m[2] });
    }
    attrMap.sort((a, b) => {
      const aParts = a.name.split(":");
      const bParts = b.name.split(":");
      const aNs = aParts[0];
      const bNs = bParts[0];
      if (aNs !== bNs) return aNs < bNs ? -1 : 1;
      return aParts[1] < bParts[1] ? -1 : aParts[1] > bParts[1] ? 1 : 0;
    });
    let result = `<${tagName}`;
    for (const attr of attrMap) {
      result += ` ${attr.name}="${escapeXmlAttr(attr.value)}"`;
    }
    const selfClosing = attrs.trim().endsWith("/");
    result += selfClosing ? " />" : ">";
    return result;
  });
}

function insertSignatureIntoDocument(xml: string, signature: string): string {
  const declMatch = xml.match(/^<\?xml[^>]*\?>\s*/);
  const xmlDecl = declMatch ? declMatch[0] : "";
  const rest = declMatch ? xml.slice(declMatch[0].length) : xml;

  const invoiceTagMatch = rest.match(/^(\s*<Invoice\s)/) ??
    rest.match(/^(\s*<CreditNote\s)/) ??
    rest.match(/^(\s*<DebitNote\s)/);

  if (!invoiceTagMatch || invoiceTagMatch.index === undefined) {
    return xml;
  }

  const tagStart = invoiceTagMatch.index;
  const tagEnd = rest.indexOf(">", tagStart) + 1;

  let result = rest;
  if (!rest.includes(`xmlns:ext="${UBL_EXT_NAMESPACE}"`, tagStart, tagEnd)) {
    result = result.slice(0, tagEnd - 1) +
      ` xmlns:ext="${UBL_EXT_NAMESPACE}"` +
      result.slice(tagEnd - 1);
  }

  const extensionBlock = `
  <ext:UBLExtensions>
    <ext:UBLExtension>
      <ext:ExtensionContent>
        ${signature}
      </ext:ExtensionContent>
    </ext:UBLExtension>
  </ext:UBLExtensions>`;

  result = result.slice(0, tagEnd) + extensionBlock + result.slice(tagEnd);

  return xmlDecl + result;
}
