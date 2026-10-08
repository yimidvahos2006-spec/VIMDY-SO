import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { X509Certificate, webcrypto } from "node:crypto";

const opensslPath =
  process.env.OPENSSL_PATH?.trim() ||
  (process.platform === "win32"
    ? "C:\\Program Files\\Git\\usr\\bin\\openssl.exe"
    : "openssl");

function runOpenSsl(args, input) {
  const result = execFileSync(opensslPath, args, {
    encoding: "utf8",
    input,
    stdio: ["pipe", "pipe", "pipe"],
  });
  return result;
}

function extractPemBlock(pem, type) {
  const pattern = new RegExp(
    `-----BEGIN ${type}-----([\\s\\S]*?)-----END ${type}-----`
  );
  const match = pem.match(pattern);

  if (!match) {
    throw new Error(`PEM_BLOCK_NOT_FOUND: ${type}`);
  }

  return `-----BEGIN ${type}-----\n${match[1].trim()}\n-----END ${type}-----`;
}

async function aesGcmEncrypt(plainText, key) {
  const encoder = new TextEncoder();
  const keyData = encoder.encode(key.padEnd(32).slice(0, 32));

  const cryptoKey = await webcrypto.subtle.importKey(
    "raw",
    keyData,
    { name: "AES-GCM" },
    false,
    ["encrypt"]
  );

  const iv = webcrypto.getRandomValues(new Uint8Array(12));

  const encrypted = await webcrypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    cryptoKey,
    encoder.encode(plainText)
  );

  const combined = new Uint8Array(iv.length + encrypted.byteLength);
  combined.set(iv);
  combined.set(new Uint8Array(encrypted), iv.length);

  return Buffer.from(combined).toString("base64");
}

async function aesGcmDecrypt(encryptedB64, key) {
  const keyData = new TextEncoder().encode(key.padEnd(32).slice(0, 32));

  const cryptoKey = await webcrypto.subtle.importKey(
    "raw",
    keyData,
    { name: "AES-GCM" },
    false,
    ["decrypt"]
  );

  const combined = Uint8Array.from(
    Buffer.from(encryptedB64, "base64")
  );

  const iv = combined.slice(0, 12);
  const data = combined.slice(12);

  const decrypted = await webcrypto.subtle.decrypt(
    { name: "AES-GCM", iv },
    cryptoKey,
    data
  );

  return new TextDecoder().decode(decrypted);
}

async function extractP12Info(p12Path, password) {
  const tmpDir = path.join(
    path.dirname(p12Path),
    "_p12_extract_" + Date.now()
  );

  fs.mkdirSync(tmpDir, { recursive: true });

  try {
    const keyPem = runOpenSsl(
      [
        "pkcs12",
        "-in",
        p12Path,
        "-passin",
        "stdin",
        "-nocerts",
        "-nodes",
        "-out",
        path.join(tmpDir, "key.pem"),
      ],
      `${password}\n`
    );

    const privateKeyPem = fs.readFileSync(
      path.join(tmpDir, "key.pem"),
      "utf8"
    );

    let pkcs8Key = privateKeyPem;

    if (privateKeyPem.includes("BEGIN RSA PRIVATE KEY")) {
      const pkcs8 = runOpenSsl([
        "pkcs8",
        "-topk8",
        "-inform",
        "PEM",
        "-in",
        path.join(tmpDir, "key.pem"),
        "-outform",
        "PEM",
        "-nocrypt",
      ]);

      pkcs8Key = pkcs8;
    }

    const certPem = runOpenSsl(
      [
        "pkcs12",
        "-in",
        p12Path,
        "-passin",
        "stdin",
        "-clcerts",
        "-nokeys",
      ],
      `${password}\n`
    );

    const normalizedCertPem = extractPemBlock(
      certPem,
      "CERTIFICATE"
    );

    const cert = new X509Certificate(normalizedCertPem);
    const parsed = cert;

    const keyObj = await webcrypto.subtle.importKey(
      "pkcs8",
      await exportKeyToDer(pkcs8Key),
      {
        name: "RSASSA-PKCS1-v1_5",
        hash: "SHA-256",
      },
      false,
      ["sign"]
    );

    const certSpkiDer = cert.publicKey.export({
      type: "spki",
      format: "der",
    });

    const certKeyObj = await webcrypto.subtle.importKey(
      "spki",
      certSpkiDer,
      {
        name: "RSASSA-PKCS1-v1_5",
        hash: "SHA-256",
      },
      false,
      ["verify"]
    );

    const testMessage = new TextEncoder().encode("test");

    const signature = await webcrypto.subtle.sign(
      "RSASSA-PKCS1-v1_5",
      keyObj,
      testMessage
    );

    const matches = await webcrypto.subtle.verify(
      {
        name: "RSASSA-PKCS1-v1_5",
      },
      certKeyObj,
      signature,
      testMessage
    );

    if (!matches) {
      throw new Error(
        "CERT_KEY_MISMATCH: la clave privada no corresponde al certificado"
      );
    }

    const normalizedPrivateKeyPem = extractPemBlock(
      pkcs8Key,
      "PRIVATE KEY"
    );

    const thumbprintSHA1 = cert.fingerprint;
    const thumbprintSHA256 = cert.fingerprint256;

    return {
      certPem: normalizedCertPem,
      privateKeyPem: normalizedPrivateKeyPem,
      serialNumber: parsed.serialNumber,
      issuer: parsed.issuer,
      subject: parsed.subject,
      validFrom: new Date(parsed.validFrom),
      validTo: new Date(parsed.validTo),
      thumbprintSHA1,
      thumbprintSHA256,
    };
  } finally {
    try {
      fs.rmSync(tmpDir, {
        recursive: true,
        force: true,
      });
    } catch {}
  }
}

async function exportKeyToDer(pemKey) {
  const normalized = extractPemBlock(
    pemKey,
    "PRIVATE KEY"
  );

  const base64 = normalized
    .replace("-----BEGIN PRIVATE KEY-----", "")
    .replace("-----END PRIVATE KEY-----", "")
    .replace(/\s+/g, "");

  return Uint8Array.from(
    Buffer.from(base64, "base64")
  );
}

async function main() {
  const args = process.argv.slice(2);

  if (args.length < 4) {
    console.error(
      "Usage: node prepare-certificate.mjs <p12_path> <p12_password> <encryption_key> <business_id>"
    );

    console.error("");

    console.error("Steps:");
    console.error("1. Validates P12/PFX");
    console.error("2. Validates private key matches certificate");
    console.error("3. Extracts PEM (PKCS#8 private key + X509 cert)");
    console.error("4. Encrypts both with AES-256-GCM");
    console.error("5. Outputs SQL INSERT for dian_certificates");
    console.error("6. Validates certificate expiration");
    console.error("7. Cleans up all temporary files");

    process.exit(1);
  }

  const p12Path = args[0];
  const password = args[1];
  const encryptionKey = args[2];
  const businessId = args[3];

  if (!/^[0-9a-fA-F-]{36}$/.test(businessId)) {
    console.error(
      "ERROR: business_id must be a UUID"
    );
    process.exit(1);
  }

  if (!fs.existsSync(p12Path)) {
    console.error(
      "ERROR: P12 file not found:",
      p12Path
    );
    process.exit(1);
  }

  console.log(
    "=== DIAN Certificate Preparation ===\n"
  );

  console.log(
    "[1] Validating P12/PFX and extracting PEM..."
  );

  let certInfo;

  try {
    certInfo = await extractP12Info(
      p12Path,
      password
    );

    console.log(
      "  OK - Certificate extracted and validated"
    );
  } catch (e) {
    console.error(
      "  FAIL -",
      e instanceof Error ? e.message : String(e)
    );

    process.exit(1);
  }

  console.log(
    "\n[2] Checking certificate expiration..."
  );

  const now = new Date();

  if (certInfo.validTo < now) {
    console.error(
      "  FAIL - Certificate expired on",
      certInfo.validTo.toISOString()
    );

    process.exit(1);
  }

  console.log(
    "  OK - Valid until",
    certInfo.validTo.toISOString()
  );

  console.log(
    "\n[3] Encrypting with AES-256-GCM..."
  );

  const encryptedKey = await aesGcmEncrypt(
    certInfo.privateKeyPem,
    encryptionKey
  );

  const encryptedCert = await aesGcmEncrypt(
    certInfo.certPem,
    encryptionKey
  );

  console.log(
    "  OK - Private key and certificate encrypted"
  );

  console.log(
    "\n[4] Verifying decryption roundtrip..."
  );

  const decryptedKey = await aesGcmDecrypt(
    encryptedKey,
    encryptionKey
  );

  const decryptedCert = await aesGcmDecrypt(
    encryptedCert,
    encryptionKey
  );

  if (
    decryptedKey !== certInfo.privateKeyPem ||
    decryptedCert !== certInfo.certPem
  ) {
    console.error(
      "  FAIL - Decryption roundtrip mismatch"
    );

    process.exit(1);
  }

  console.log(
    "  OK - Decryption verified"
  );

  console.log(
    "\n[5] Certificate metadata:"
  );

  console.log(
    "  Serial:",
    certInfo.serialNumber
  );

  console.log(
    "  Subject:",
    certInfo.subject
  );

  console.log(
    "  Issuer:",
    certInfo.issuer
  );

  console.log(
    "  SHA1:",
    certInfo.thumbprintSHA1
  );

  console.log(
    "  SHA256:",
    certInfo.thumbprintSHA256
  );

  console.log(
    "  Valid:",
    certInfo.validFrom.toISOString(),
    "→",
    certInfo.validTo.toISOString()
  );

  const encryptedKeySQL =
    encryptedKey.replace(/'/g, "''");

  const encryptedCertSQL =
    encryptedCert.replace(/'/g, "''");

  const serialSQL =
    certInfo.serialNumber.replace(/'/g, "''");

  const issuerSQL =
    certInfo.issuer.replace(/'/g, "''");

  const expDate =
    certInfo.validTo.toISOString();

  const sql = `
-- ONLY RUN THIS AFTER DIAN_CERT_ENCRYPTION_KEY IS SET TO THE REAL VALUE
-- The encrypted values are for business_id: ${businessId}
-- Certificate serial: ${certInfo.serialNumber}
-- Certificate expires: ${expDate}
-- Do NOT run if a certificate with the same serial already exists

INSERT INTO dian_certificates (
  business_id,
  certificate_name,
  certificate_serial,
  certificate_expiration,
  certificate_issuer,
  cert_type,
  software_id,
  software_code,
  pin,
  private_key_encrypted,
  cert_pem_encrypted,
  active
) VALUES (
  '${businessId}'::uuid,
  'DIAN Habilitacion Certificate',
  '${serialSQL}',
  '${expDate}'::timestamptz,
  '${issuerSQL}',
  'XAdES',
  NULL,
  NULL,
  NULL,
  '${encryptedKeySQL}',
  '${encryptedCertSQL}',
  true
)
ON CONFLICT DO NOTHING
RETURNING id;

-- Update business with DIAN credentials (SENSITIVE - run separately)
-- UPDATE businesses
-- SET
--   tax_identification_number = 'NIT_AQUI',
--   dian_software_id = 'SOFTWARE_ID_AQUI',
--   dian_software_code = 'SOFTWARE_CODE_AQUI',
--   dian_clave_tecnica = 'CLAVE_TECNICA_AQUI'
-- WHERE id = '${businessId}'::uuid;
  `;

  console.log(
    "\n[6] SQL for dian_certificates insert:"
  );

  console.log(
    "  (run via: supabase db query --linked)"
  );

  console.log(
    "  (encrypted values are safe to pipe to SQL)"
  );

  console.log("\n" + sql);

  console.log(
    "\n[7] All temp files cleaned up."
  );

  console.log(
    "\n=== Preparación completada ==="
  );
}

main().catch((err) => {
  console.error(
    "Fatal error:",
    err
  );

  process.exit(1);
});