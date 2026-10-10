
import { deflateRawSync } from "node:zlib";
import {
  lstatSync,
  mkdirSync,
  readFileSync,
  rmSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import { extname, join, relative, sep } from "node:path";
import process from "node:process";

const root = process.cwd();
const outputDirectory = join(root, ".release");
const outputFile = join(outputDirectory, "vimdy-os-source.zip");

// Evitar que quede un paquete antiguo disponible si falla la validación.
rmSync(outputFile, { force: true });

const excludedDirectoryNames = new Set([
  ".git",
  ".vercel",
  ".playwright-mcp",
  "node_modules",
  "dist",
  "coverage",
  "playwright-report",
  "playwright-screenshots",
  "test-results",
  "tests",
  ".cache",
  ".temp",
  ".release",
  "caja_repair_temp",
  "vimdy-audit",
]);

const blockedExtensions = new Set([
  ".pem",
  ".key",
  ".p12",
  ".pfx",
]);

const allowedEnvFiles = new Set([
  ".env.example",
  ".env.template",
]);

const secretPatterns = [
  // Posibles tokens JWT.
  /\beyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/,

  // Claves de proveedores conocidos.
  /\b(?:sb_secret_[A-Za-z0-9_-]{15,}|sk_(?:live|prod)_[A-Za-z0-9]{16,}|re_[A-Za-z0-9_-]{20,})\b/,

  // Variables de entorno con valores que podrían ser secretos.
  /(?:^|\n)\s*(?:RESEND_API_KEY|RESEND_SMTP_PASS|SUPABASE_SERVICE_ROLE_KEY|VERCEL_OIDC_TOKEN|SUPABASE_INTERNAL_JWT_SECRET)\s*=\s*["\']?(?!REPLACE_|YOUR_|<|["\'\s#]|$)[A-Za-z0-9_./+=:-]{12,}/im,

  // Claves privadas.
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----\s*[A-Za-z0-9+/=\r\n]{40,}?-----END (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
];

function isExcluded(relativePath) {
  const normalized = relativePath.split(sep).join("/");
  const parts = normalized.split("/");
  const basename = parts.at(-1) ?? "";

  if (parts.some((part) => excludedDirectoryNames.has(part))) {
    return true;
  }

  if (
    parts.some(
      (part) =>
        part.startsWith("vimdy_migration_cleanup_") ||
        part.startsWith(".release-"),
    )
  ) {
    return true;
  }

  if (basename === "env.example.txt") return true;
  if (basename === "docker.env") return true;

  if (
    (basename === ".env" || basename.startsWith(".env.")) &&
    !allowedEnvFiles.has(basename)
  ) {
    return true;
  }

  if (blockedExtensions.has(extname(basename).toLowerCase())) {
    return true;
  }

  if (
    basename.endsWith(".log") ||
    basename.endsWith(".tsbuildinfo")
  ) {
    return true;
  }

  if ([".DS_Store", "Thumbs.db"].includes(basename)) {
    return true;
  }

  if (
    parts.some(
      (part) => part === ".vscode" || part === ".idea",
    )
  ) {
    return true;
  }

  if (normalized.startsWith("%SystemDrive%/")) {
    return true;
  }

  return false;
}

function walk(directory) {
  const out = [];

  for (const entry of readdirSync(directory, {
    withFileTypes: true,
  })) {
    const absolute = join(directory, entry.name);
    const relativePath = relative(root, absolute);

    if (isExcluded(relativePath)) continue;

    const stat = lstatSync(absolute);

    if (stat.isSymbolicLink()) {
      throw new Error(
        `Refusing to package symbolic link: ${relativePath}`,
      );
    }

    if (entry.isDirectory()) {
      out.push(...walk(absolute));
    } else if (entry.isFile()) {
      out.push({
        absolute,
        relativePath,
        size: stat.size,
      });
    }
  }

  return out;
}

function findSecret(contents) {
  const text = contents.toString("utf8");
  return secretPatterns.some((pattern) => pattern.test(text));
}

function crc32(buffer) {
  let crc = 0xffffffff;

  for (const byte of buffer) {
    crc ^= byte;

    for (let i = 0; i < 8; i += 1) {
      crc =
        (crc >>> 1) ^
        ((crc & 1) ? 0xedb88320 : 0);
    }
  }

  return (crc ^ 0xffffffff) >>> 0;
}

function dosDateTime(date = new Date()) {
  const year = Math.max(1980, date.getFullYear());

  const time =
    (date.getHours() << 11) |
    (date.getMinutes() << 5) |
    Math.floor(date.getSeconds() / 2);

  const day =
    ((year - 1980) << 9) |
    ((date.getMonth() + 1) << 5) |
    date.getDate();

  return { time, day };
}

function makeZip(files) {
  const localParts = [];
  const centralParts = [];
  let localOffset = 0;

  const dt = dosDateTime();

  for (const file of files) {
    const name = Buffer.from(
      file.relativePath.split(sep).join("/"),
      "utf8",
    );

    const raw = readFileSync(file.absolute);
    const compressed = deflateRawSync(raw, {
      level: 9,
    });

    const crc = crc32(raw);

    const local = Buffer.alloc(30);

    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6);
    local.writeUInt16LE(8, 8);
    local.writeUInt16LE(dt.time, 10);
    local.writeUInt16LE(dt.day, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);

    localParts.push(local, name, compressed);

    const central = Buffer.alloc(46);

    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(8, 10);
    central.writeUInt16LE(dt.time, 12);
    central.writeUInt16LE(dt.day, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(compressed.length, 20);
    central.writeUInt32LE(raw.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36);

    central.writeUInt32LE(
      (0o100644 * 0x10000) >>> 0,
      38,
    );

    central.writeUInt32LE(localOffset, 42);

    centralParts.push(central, name);

    localOffset +=
      local.length + name.length + compressed.length;
  }

  const centralDirectory = Buffer.concat(centralParts);
  const end = Buffer.alloc(22);

  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(centralDirectory.length, 12);
  end.writeUInt32LE(localOffset, 16);
  end.writeUInt16LE(0, 20);

  return Buffer.concat([
    ...localParts,
    centralDirectory,
    end,
  ]);
}

try {
  // Recopilar únicamente los archivos permitidos.
  const files = walk(root).sort((a, b) =>
    a.relativePath.localeCompare(b.relativePath),
  );

  // Protección adicional contra archivos de entorno.
  const forbidden = files.filter(({ relativePath }) => {
    const base = relativePath.split(sep).at(-1) ?? "";

    return (
      base === ".env" ||
      (base.startsWith(".env.") &&
        !allowedEnvFiles.has(base)) ||
      base === "docker.env"
    );
  });

  if (forbidden.length) {
    throw new Error(
      `Forbidden environment files present: ${forbidden
        .map((file) => file.relativePath)
        .join(", ")}`,
    );
  }

  // Revisar posibles credenciales en los archivos incluidos.
  const secretHits = [];

  for (const file of files) {
    // Evitar cargar archivos enormes completos en memoria.
    if (file.size > 20 * 1024 * 1024) continue;

    const data = readFileSync(file.absolute);

    if (findSecret(data)) {
      secretHits.push(file.relativePath);
    }
  }

  if (secretHits.length) {
    throw new Error(
      `Possible secret material detected in: ${secretHits.join(", ")}. No archive was written.`,
    );
  }

  // Exigir documentación de configuración.
  if (
    !files.some(
      (file) => file.relativePath === ".env.example",
    )
  ) {
    throw new Error(
      ".env.example is missing; release package must document required configuration.",
    );
  }

  mkdirSync(outputDirectory, {
    recursive: true,
  });

  const archive = makeZip(files);

  writeFileSync(outputFile, archive, {
    mode: 0o600,
  });

  console.log(
    `Release source package created: ${relative(root, outputFile)}`,
  );

  console.log(`Included files: ${files.length}`);

  console.log(
    "Local env files, Supabase temp state, Vercel state, Playwright logs, build output, test suites/fixtures, and private-key files were excluded.",
  );
} catch (error) {
  console.error(
    `Release packaging blocked: ${
      error instanceof Error
        ? error.message
        : "unknown error"
    }`,
  );

  process.exitCode = 1;
}