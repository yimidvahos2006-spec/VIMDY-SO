import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import process from "node:process";

const root = process.cwd();
const failures = [];

function fail(message) {
  failures.push(message);
}

function walk(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? walk(path) : [path];
  });
}

function read(path) {
  return readFileSync(join(root, path), "utf8");
}

const migrationsDirectory = join(root, "supabase", "migrations");
const migrationFiles = readdirSync(migrationsDirectory)
  .filter((name) => name.endsWith(".sql"))
  .sort();
const versions = new Map();

for (const file of migrationFiles) {
  const match = /^(\d{8,14})_.+\.sql$/.exec(file);
  if (!match) {
    fail(`Migration name has an invalid numeric version: ${file}`);
    continue;
  }
  const [, version] = match;
  const previous = versions.get(version);
  if (previous) fail(`Duplicate migration version ${version}: ${previous}, ${file}`);
  else versions.set(version, file);
}

const trackedFiles = execFileSync("git", ["ls-files", "-z"], { encoding: "utf8" })
  .split("\0")
  .filter(Boolean);
for (const file of trackedFiles) {
  const name = file.split(/[\\/]/).at(-1);
  if (name === ".env" || (/^\.env\./.test(name) && !/\.example$|\.template$/.test(name))) {
    fail(`Environment/secret file is tracked: ${file}`);
  }
}

const secretPatterns = [
  /\beyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/,
  /\b(?:sk|rk)_(?:live|prod)_[A-Za-z0-9]{16,}\b/,
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/
];
const sourceFiles = execFileSync(
  "git",
  ["ls-files", "--cached", "--others", "--exclude-standard", "-z"],
  { encoding: "utf8" }
).split("\0").filter(Boolean);
for (const file of sourceFiles.filter((path) =>
  /^(?:src|supabase|scripts|tests|\.github)[\\/]/.test(path) ||
  !/[\\/]/.test(path)
).filter((path) =>
  !/^(?:node_modules|dist|coverage)[\\/]/.test(path) &&
  !/(?:^|[\\/])[^\\/]*lock[^\\/]*$/.test(path) &&
  /\.(?:[cm]?[jt]sx?|json|ya?ml|sql|toml)$/.test(path)
)) {
  const contents = readFileSync(join(root, file), "utf8");
  if (secretPatterns.some((pattern) => pattern.test(contents))) {
    fail(`Possible credential material found in tracked file: ${file}`);
  }
}

const supportedTypesSource = read("src/core/config/businessTypes.ts");
const typeCatalog = /export const BUSINESS_TYPES:[\s\S]*?=\s*\[([\s\S]*?)\];/.exec(supportedTypesSource);
if (!typeCatalog) {
  fail("Could not read the selectable business type catalog.");
} else {
  const ids = [...typeCatalog[1].matchAll(/\bid:\s*"([^"]+)"/g)].map((match) => match[1]);
  const forbidden = new Set([
    "tienda", "hotel", "minimercado", "pequeno_supermercado",
    "negocio_productos", "negocio_servicios", "otro"
  ]);
  for (const id of ids) {
    if (forbidden.has(id)) fail(`Non-F&B or generic business type is selectable: ${id}`);
  }
  for (const required of ["restaurante", "cafeteria", "pizzeria", "asadero", "bar", "panaderia",
    "heladeria", "food_truck", "comida_rapida", "negocio_bebidas"]) {
    if (!ids.includes(required)) fail(`Required F&B onboarding type is missing: ${required}`);
  }
}

const runtimeFiles = walk(join(root, "src")).filter((path) => /\.(ts|tsx|js|jsx)$/.test(path));
for (const path of runtimeFiles) {
  if (readFileSync(path, "utf8").includes("NOT_IMPLEMENTED")) {
    fail(`Unimplemented runtime marker found: ${relative(root, path)}`);
  }
}

const paymentSessions = read("src/core/payments/PaymentSessionManager.ts");
if (/new Map<string,\s*PaymentSession>/.test(paymentSessions) || /window\.localStorage/.test(paymentSessions)) {
  fail("PaymentSessionManager uses browser/process memory as session persistence.");
}

const paymentEngine = read("src/core/engines/PaymentEngine.ts");
for (const [method, nextMethod] of [["refund", "refundAmount"], ["refundAmount", "cancelPayment"]]) {
  const methodBody = new RegExp(`public ${method}\\([\\s\\S]*?public ${nextMethod}\\(`).exec(paymentEngine)?.[0] ?? "";
  if (/success:\s*true/.test(methodBody)) {
    fail(`PaymentEngine.${method} reports success before a persistence/provider confirmation.`);
  }
}

const gateE2e = read("tests/e2e/pos/venta-fulfillment-atomic.spec.ts");
if (/test\.skip|describe\.skip/.test(gateE2e)) {
  fail("Gate 1 persisted POS E2E is skipped.");
}

const releaseBaseRef = process.env.RELEASE_BASE_REF;
if (!releaseBaseRef) {
  fail("RELEASE_BASE_REF is required; use the verified PR base or origin/main commit.");
} else {
  let baseCommit;
  try {
    baseCommit = execFileSync(
      "git",
      ["rev-parse", "--verify", `${releaseBaseRef}^{commit}`],
      { encoding: "utf8" }
    ).trim();
  } catch {
    fail(`RELEASE_BASE_REF does not resolve to a Git commit: ${releaseBaseRef}`);
  }

  if (baseCommit) {
    const baselineFiles = execFileSync(
      "git",
      ["ls-tree", "-r", "--name-only", baseCommit, "--", "supabase/migrations"],
      { encoding: "utf8" }
    ).split(/\r?\n/).filter(Boolean);
    const currentFiles = new Set([
      ...execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard", "--", "supabase/migrations"], {
        encoding: "utf8"
      }).split(/\r?\n/).filter(Boolean)
    ]);
    const currentMigrationNames = new Set(migrationFiles.map((file) => `supabase/migrations/${file}`));
    const baselineVersions = baselineFiles
      .map((file) => /^supabase\/migrations\/(\d{8,14})_.+\.sql$/.exec(file)?.[1])
      .filter(Boolean)
      .map(Number);
    const latestBaselineVersion = Math.max(0, ...baselineVersions);

    for (const file of baselineFiles) {
      if (!currentMigrationNames.has(file)) {
        fail(`Historical migration removed from working tree: ${file}`);
      }
    }

    const changedMigrations = execFileSync(
      "git",
      ["diff", "--name-status", baseCommit, "--", "supabase/migrations"],
      { encoding: "utf8" }
    );
    for (const line of changedMigrations.split(/\r?\n/).filter(Boolean)) {
      const [status, ...paths] = line.split(/\s+/);
      if (status !== "A") {
        fail(`Existing migration changed or removed; add a new migration instead: ${paths.join(" ")}`);
      }
    }

    for (const file of currentFiles) {
      if (baselineFiles.includes(file)) continue;
      const name = file.split(/[\\/]/).at(-1);
      const match = /^(\d{8,14})_.+\.sql$/.exec(name);
      if (match && Number(match[1]) <= latestBaselineVersion) {
        fail(`New migration version must be later than baseline ${latestBaselineVersion}: ${file}`);
      }
    }
  }
}

for (const failure of failures) console.error(`FAIL: ${failure}`);
if (failures.length) {
  console.error(`Release guards failed with ${failures.length} finding(s).`);
  process.exitCode = 1;
} else {
  console.log("Release guards passed.");
}
