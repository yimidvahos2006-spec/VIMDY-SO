import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

const SCHEMA_PATH = join(process.cwd(), "supabase", "schema.sql");
const rawSchema = readFileSync(SCHEMA_PATH, "utf-8");

describe("P0 — Seguridad: business_members role escalation", () => {
  it("la policy business_members_self_insert exige que el rol coincida con la invitación", () => {
    // Buscar la política y verificar que incluye la validación de rol
    const policyStart = rawSchema.indexOf("create policy business_members_self_insert");
    expect(policyStart).toBeGreaterThan(-1);

    // Extraer un chunk razonable después del inicio de la política
    const policyChunk = rawSchema.substring(policyStart, policyStart + 800);

    // La policy debe verificar que el role insertado coincida con el role de la invitación
    expect(policyChunk).toMatch(/role = business_members\.role/);
    expect(policyChunk).toMatch(/business_invitations/);
    expect(policyChunk).toMatch(/accepted_at is null/);
    expect(policyChunk).toMatch(/expires_at > now\(\)/);
  });

  it("la migración 20260901_fix_business_members_role_escalation.sql existe y aplica el fix", () => {
    const migrationPath = join(
      process.cwd(),
      "supabase",
      "migrations",
      "20260901_fix_business_members_role_escalation.sql"
    );
    const migration = readFileSync(migrationPath, "utf-8");

    expect(migration).toMatch(/drop policy if exists business_members_self_insert/);
    expect(migration).toMatch(/role = business_members\.role/);
    expect(migration).toMatch(/is_business_subscription_active/);
  });
});
