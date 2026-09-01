import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

const MIGRATIONS_DIR = join(process.cwd(), "supabase", "migrations");
const FNS_DIR = join(process.cwd(), "supabase", "functions");

describe("FASE 4-BIS: Seguridad del trial — migrations consolidadas", () => {
  describe("Migrations nuevas existen", () => {
    it("20260829_consolidate_subscription_functions.sql existe", () => {
      const content = readFileSync(
        join(MIGRATIONS_DIR, "20260829_consolidate_subscription_functions.sql"),
        "utf-8"
      );
      expect(content).toMatch(/CREATE OR REPLACE FUNCTION public\.is_business_subscription_active/);
      expect(content).toMatch(/CREATE OR REPLACE FUNCTION public\.has_user_used_trial/);
      expect(content).toMatch(/CREATE OR REPLACE FUNCTION public\.record_trial_usage/);
    });

    it("20260829_fix_businesses_insert_policies.sql existe", () => {
      const content = readFileSync(
        join(MIGRATIONS_DIR, "20260829_fix_businesses_insert_policies.sql"),
        "utf-8"
      );
      expect(content).toMatch(/DROP POLICY IF EXISTS businesses_insert_owner/);
      expect(content).toMatch(/businesses_insert_own/);
      expect(content).toMatch(/NOT public.has_user_used_trial/);
    });

    it("20260829_revoke_trial_usage_grants.sql existe", () => {
      const content = readFileSync(
        join(MIGRATIONS_DIR, "20260829_revoke_trial_usage_grants.sql"),
        "utf-8"
      );
      expect(content).toMatch(/REVOKE ALL ON FUNCTION public\.record_trial_usage/u);
      expect(content).toMatch(/FROM authenticated/);
      expect(content).toMatch(/GRANT EXECUTE ON FUNCTION public\.record_trial_usage/u);
      expect(content).toMatch(/TO service_role/);
    });
  });

  describe("is_business_subscription_active usa fechas reales", () => {
    let content: string;
    beforeAll(() => {
      content = readFileSync(
        join(MIGRATIONS_DIR, "20260829_consolidate_subscription_functions.sql"),
        "utf-8"
      );
    });

    it("verifica trial_ends_at > CURRENT_TIMESTAMP", () => {
      expect(content).toMatch(/trial_ends_at.*CURRENT_TIMESTAMP/);
    });

    it("verifica renewal_date > CURRENT_TIMESTAMP", () => {
      expect(content).toMatch(/renewal_date.*CURRENT_TIMESTAMP/);
    });

    it("NO usa payment_status = approved", () => {
      // Solo verifica el cuerpo de la función SQL, no los comentarios explicativos
      const match = content.match(/CREATE OR REPLACE FUNCTION public\.is_business_subscription_active[\s\S]*?$$/);
      expect(match).toBeTruthy();
      const fnBody = match![0];
      expect(fnBody).not.toMatch(/payment_status\s*=\s*'approved'/);
    });
  });

  describe("record_trial_usage usa DO NOTHING", () => {
    it("migration usa ON CONFLICT DO NOTHING", () => {
      const content = readFileSync(
        join(MIGRATIONS_DIR, "20260829_consolidate_subscription_functions.sql"),
        "utf-8"
      );
      expect(content).toMatch(/ON CONFLICT \(user_id\) DO NOTHING/);
    });

    it("trial_user_migration.sql usa DO NOTHING", () => {
      const content = readFileSync(
        join(process.cwd(), "supabase", "trial_user_migration.sql"),
        "utf-8"
      );
      expect(content).toMatch(/on conflict.*do nothing/);
      expect(content).not.toMatch(/do update.*business_id.*excluded/);
    });
  });

  describe("APPLY_PERMISSIONS.sql corregido", () => {
    let content: string;
    beforeAll(() => {
      content = readFileSync(
        join(process.cwd(), "supabase", "APPLY_PERMISSIONS.sql"),
        "utf-8"
      );
    });

    it("NO otorga GRANT ALL ON app_users TO authenticated", () => {
      expect(content).not.toMatch(/GRANT ALL ON app_users TO authenticated/);
      expect(content).toMatch(/GRANT SELECT.*INSERT.*UPDATE.*DELETE ON app_users TO authenticated/);
    });

    it("NO define businesses_insert_owner", () => {
      expect(content).not.toMatch(/CREATE POLICY businesses_insert_owner/);
    });

    it("REVOKE record_trial_usage de authenticated", () => {
      expect(content).toMatch(/REVOKE.*record_trial_usage.*FROM authenticated/);
    });

    it("is_business_subscription_active usa trial_ends_at", () => {
      expect(content).toMatch(/trial_ends_at.*CURRENT_TIMESTAMP/);
    });
  });

  describe("fix_permissions.sql corregido", () => {
    let content: string;
    beforeAll(() => {
      content = readFileSync(
        join(process.cwd(), "supabase", "fix_permissions.sql"),
        "utf-8"
      );
    });

    it("NO otorga GRANT ALL ON app_users", () => {
      expect(content).not.toMatch(/grant all on app_users to authenticated/);
      expect(content).toMatch(/grant select, insert, update, delete on app_users to authenticated/);
    });

    it("NO define businesses_insert_owner", () => {
      expect(content).not.toMatch(/create policy businesses_insert_owner/);
    });
  });

  describe("Edge Function register-business valida JWT", () => {
    let content: string;
    beforeAll(() => {
      content = readFileSync(
        join(FNS_DIR, "register-business", "index.ts"),
        "utf-8"
      );
    });

    it("RequestPayload del body NO incluye p_user_id", () => {
      const match = content.match(/interface RequestPayload\s*{([\s\S]*?)}/);
      expect(match).toBeTruthy();
      const payloadBody = match![1];
      expect(payloadBody).not.toMatch(/p_user_id/);
    });

    it("NO lee p_user_id del body parsed", () => {
      expect(content).not.toMatch(/\.p_user_id/);
      expect(content).not.toMatch(/payload\.p_user_id/);
    });

    it("valida JWT con admin.auth.getUser", () => {
      expect(content).toMatch(/admin\.auth\.getUser\(accessToken\)/);
    });

    it("usa authUser.id (del JWT) para has_user_used_trial", () => {
      expect(content).toMatch(/has_user_used_trial.*authUser\.id/);
    });

    it("usa authUser.id para record_trial_usage", () => {
      expect(content).toMatch(/record_trial_usage[\s\S]*authUser\.id/);
    });
  });

  describe("authBusinessContext — createAdditionalBusiness delegado", () => {
    let fnBody: string;
    beforeAll(() => {
      const content = readFileSync(
        join(process.cwd(), "src", "infrastructure", "supabase", "authBusinessContext.ts"),
        "utf-8"
      );
      const start = content.indexOf("export async function createAdditionalBusiness");
      const end = content.indexOf("\n}", start) + 1;
      fnBody = content.substring(start, end);
    });

    it("NO llama rpc record_trial_usage desde el cliente", () => {
      expect(fnBody).not.toMatch(/\.rpc\(.record_trial_usage./);
    });

    it("NO llama rpc has_user_used_trial desde el cliente", () => {
      expect(fnBody).not.toMatch(/supabase\.rpc\(.has_user_used_trial/);
    });

    it("invoca register-business Edge Function", () => {
      expect(fnBody).toMatch(/supabase\.functions\.invoke\(.register-business./);
    });

    it("NO inserta directamente en businesses desde el cliente", () => {
      expect(fnBody).not.toMatch(/from\(.businesses.\).insert/);
    });
  });

  describe("subscriptionService — recordTrialUsage obsoleto", () => {
    it("retorna error TRIAL_USAGE_RECORD_FORBIDDEN", () => {
      const content = readFileSync(
        join(process.cwd(), "src", "infrastructure", "supabase", "subscriptionService.ts"),
        "utf-8"
      );
      const start = content.indexOf("async recordTrialUsage");
      const end = content.indexOf("\n  }", start) + 1;
      const fnBody = content.substring(start, end);
      expect(fnBody).toMatch(/TRIAL_USAGE_RECORD_FORBIDDEN/);
      expect(fnBody).not.toMatch(/\.rpc\(/);
    });
  });

  describe("CreateBusinessPage — ownerName corregido", () => {
    it("usa user?.name como ownerName", () => {
      const content = readFileSync(
        join(process.cwd(), "src", "presentation", "pages", "CreateBusinessPage.tsx"),
        "utf-8"
      );
      expect(content).toMatch(/ownerName: user\?\.name/);
      expect(content).not.toMatch(/ownerName: ""/);
    });

    it("extrae user del useAuth() hook", () => {
      const content = readFileSync(
        join(process.cwd(), "src", "presentation", "pages", "CreateBusinessPage.tsx"),
        "utf-8"
      );
      expect(content).toMatch(/const.*\{.*user.*\}.*= useAuth\(\)/);
    });
  });
});
