import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { loadEnv } from "vite";
import { test as base, expect, type Page } from "@playwright/test";

const PROJECT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

// Vite's e2e mode loads .env, .env.local, .env.e2e and .env.e2e.local.
// process.env wins so CI/explicit shell variables can override local files.
const env = {
  ...loadEnv("e2e", PROJECT_ROOT, ""),
  ...process.env
};

const SUPABASE_URL = env.VITE_SUPABASE_URL || env.SUPABASE_URL;
const ANON_KEY = env.VITE_SUPABASE_ANON_KEY || env.SUPABASE_ANON_KEY;
const SERVICE_ROLE_KEY = env.SUPABASE_SERVICE_ROLE_KEY;

const TEST_PASSWORD = "Test123456!";

const E2E_ACCOUNTS = [
  {
    email: "test.restaurante.run_20260816002021_4egukk@vimdy.dev",
    businessName: "TEST Restaurante TEST run_20260816002021_4egukk",
    businessType: "restaurante",
    enabledModules: ["mesas", "cocina", "pedidos", "caja", "inventario", "clientes", "ia"]
  },
  {
    email: "test.cafeteria.run_20260816002021_4egukk@vimdy.dev",
    businessName: "TEST Cafeteria TEST run_20260816002021_4egukk",
    businessType: "cafeteria",
    enabledModules: ["mesas", "cocina", "pedidos", "caja", "inventario", "clientes", "ia"]
  }
] as const;

export interface VimdyFixtures {
  authenticatedPage: Page;
  testBusinessName: string;
}

type WorkerFixtures = {
  e2eEnvironmentReady: void;
};

type E2EAccount = (typeof E2E_ACCOUNTS)[number];

function requireConfig(): void {
  const missing: string[] = [];
  if (!SUPABASE_URL) missing.push("VITE_SUPABASE_URL/SUPABASE_URL");
  if (!ANON_KEY) missing.push("VITE_SUPABASE_ANON_KEY/SUPABASE_ANON_KEY");
  if (!SERVICE_ROLE_KEY) missing.push("SUPABASE_SERVICE_ROLE_KEY");

  if (missing.length > 0) {
    throw new Error(
      `E2E_SEED_CONFIG_MISSING: define ${missing.join(", ")} in .env.e2e.local or the test environment.`
    );
  }
}

function createAdminClient(): SupabaseClient {
  requireConfig();
  return createClient(SUPABASE_URL!, SERVICE_ROLE_KEY!, {
    auth: { autoRefreshToken: false, persistSession: false }
  });
}

async function ensureAuthUser(admin: SupabaseClient, account: E2EAccount): Promise<string> {
  const { data, error } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
  if (error) throw new Error(`E2E_SEED_LIST_USERS_FAILED: ${error.message}`);

  const existing = data.users.find(
    (user) => user.email?.toLowerCase() === account.email.toLowerCase()
  );

  if (existing) {
    const { error: updateError } = await admin.auth.admin.updateUserById(existing.id, {
      password: TEST_PASSWORD,
      email_confirm: true,
      user_metadata: {
        ...(existing.user_metadata ?? {}),
        name: `E2E ${account.businessType}`,
        full_name: `E2E ${account.businessType}`
      }
    });
    if (updateError) throw new Error(`E2E_SEED_UPDATE_USER_FAILED: ${updateError.message}`);
    return existing.id;
  }

  const { data: created, error: createError } = await admin.auth.admin.createUser({
    email: account.email,
    password: TEST_PASSWORD,
    email_confirm: true,
    user_metadata: {
      name: `E2E ${account.businessType}`,
      full_name: `E2E ${account.businessType}`
    }
  });

  if (createError || !created.user) {
    throw new Error(`E2E_SEED_CREATE_USER_FAILED: ${createError?.message ?? "user missing"}`);
  }

  return created.user.id;
}

async function ensureBusiness(admin: SupabaseClient, account: E2EAccount): Promise<string> {
  const { data: existing, error: findError } = await admin
    .from("businesses")
    .select("id")
    .eq("name", account.businessName)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (findError) throw new Error(`E2E_SEED_FIND_BUSINESS_FAILED: ${findError.message}`);

  const businessPayload = {
    name: account.businessName,
    plan: "trial",
    trial_ends_at: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString(),
    country: "CO",
    currency: "COP",
    language: "es",
    timezone: "America/Bogota",
    tax_rate: 19,
    onboarding_completed: true,
    business_type: account.businessType,
    enabled_modules: account.enabledModules,
    salida_cocina: "pantalla"
  };

  if (existing?.id) {
    const { error: updateError } = await admin
      .from("businesses")
      .update(businessPayload)
      .eq("id", existing.id);
    if (updateError) throw new Error(`E2E_SEED_UPDATE_BUSINESS_FAILED: ${updateError.message}`);
    return existing.id;
  }

  const { data: created, error: createError } = await admin
    .from("businesses")
    .insert(businessPayload)
    .select("id")
    .single();

  if (createError || !created?.id) {
    throw new Error(`E2E_SEED_CREATE_BUSINESS_FAILED: ${createError?.message ?? "business missing"}`);
  }

  return created.id;
}

async function ensureMainBranch(admin: SupabaseClient, businessId: string): Promise<string> {
  const { data: existing, error: findError } = await admin
    .from("branches")
    .select("id")
    .eq("business_id", businessId)
    .eq("is_main", true)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (findError) throw new Error(`E2E_SEED_FIND_BRANCH_FAILED: ${findError.message}`);

  if (existing?.id) {
    const { error: demoteError } = await admin
      .from("branches")
      .update({ is_main: false })
      .eq("business_id", businessId)
      .neq("id", existing.id);
    if (demoteError) throw new Error(`E2E_SEED_DEMOTE_BRANCHES_FAILED: ${demoteError.message}`);

    const { error: updateError } = await admin
      .from("branches")
      .update({ name: "Sucursal principal E2E", active: true, is_main: true })
      .eq("id", existing.id);
    if (updateError) throw new Error(`E2E_SEED_UPDATE_BRANCH_FAILED: ${updateError.message}`);

    return existing.id;
  }

  const { data: created, error: createError } = await admin
    .from("branches")
    .insert({
      business_id: businessId,
      name: "Sucursal principal E2E",
      is_main: true,
      active: true
    })
    .select("id")
    .single();

  if (createError || !created?.id) {
    throw new Error(`E2E_SEED_CREATE_BRANCH_FAILED: ${createError?.message ?? "branch missing"}`);
  }

  return created.id;
}

async function ensureMembershipAndProfile(
  admin: SupabaseClient,
  userId: string,
  businessId: string,
  branchId: string,
  account: E2EAccount
): Promise<void> {
  // E2E accounts are deterministic test identities. Keep each one attached
  // to exactly one business so login cannot fall through to business-selector.
  const { error: membershipCleanupError } = await admin
    .from("business_members")
    .delete()
    .eq("user_id", userId)
    .neq("business_id", businessId);

  if (membershipCleanupError) {
    throw new Error(`E2E_SEED_CLEAN_MEMBERSHIPS_FAILED: ${membershipCleanupError.message}`);
  }

  const { error: membershipError } = await admin.from("business_members").upsert(
    {
      user_id: userId,
      business_id: businessId,
      role: "ADMIN"
    },
    { onConflict: "user_id,business_id" }
  );

  if (membershipError) {
    throw new Error(`E2E_SEED_MEMBERSHIP_FAILED: ${membershipError.message}`);
  }

  const now = new Date().toISOString();
  const { error: profileError } = await admin.from("app_users").upsert(
    {
      id: userId,
      business_id: businessId,
      branch_id: branchId,
      version: 1,
      data: {
        id: userId,
        name: `E2E ${account.businessType}`,
        email: account.email,
        roleId: "ADMIN",
        status: "ACTIVE",
        createdAt: now,
        updatedAt: now,
        businessId,
        branchId
      }
    },
    { onConflict: "id" }
  );

  if (profileError) {
    throw new Error(`E2E_SEED_PROFILE_FAILED: ${profileError.message}`);
  }
}

async function ensureE2EEnvironment(): Promise<void> {
  const admin = createAdminClient();

  for (const account of E2E_ACCOUNTS) {
    const userId = await ensureAuthUser(admin, account);
    const businessId = await ensureBusiness(admin, account);
    const branchId = await ensureMainBranch(admin, businessId);
    await ensureMembershipAndProfile(admin, userId, businessId, branchId, account);
  }
}

async function seedWaitersAndTables(page: Page): Promise<void> {
  // This part intentionally runs after the browser session exists so it can
  // respect the same RLS path used by the application. It uses the configured
  // public project values; no secret is embedded in source code.
  const accessToken = await page.evaluate(() => {
    const key = Object.keys(localStorage).find((name) => name.startsWith("sb-") && name.endsWith("-auth-token"));
    if (!key) return null;
    try {
      const session = JSON.parse(localStorage.getItem(key) ?? "{}");
      return session?.access_token || session?.currentSession?.access_token || null;
    } catch {
      return null;
    }
  });

  if (!accessToken || !SUPABASE_URL || !ANON_KEY) return;

  const headers = {
    apikey: ANON_KEY,
    Authorization: `Bearer ${accessToken}`,
    "Content-Type": "application/json",
    Prefer: "resolution=merge-duplicates"
  };

  try {
    const businessName = "TEST Restaurante TEST run_20260816002021_4egukk";
    const bizRes = await page.request.get(
      `${SUPABASE_URL}/rest/v1/businesses?select=id&name=eq.${encodeURIComponent(businessName)}`,
      { headers }
    );
    if (!bizRes.ok()) return;

    const businesses = await bizRes.json();
    if (!Array.isArray(businesses) || businesses.length === 0) return;

    const businessId = businesses[0].id;
    let branchId: string | undefined;

    const branchRes = await page.request.get(
        `${SUPABASE_URL}/rest/v1/branches?select=id&business_id=eq.${businessId}&is_main=eq.true&limit=1`,
        { headers }
      );
      if (branchRes.ok()) {
        const branches = await branchRes.json();
        if (Array.isArray(branches) && branches[0]?.id) branchId = branches[0].id;
      }

    if (!branchId) return;

    const waiterId = `waiter_${businessId}_e2e`;
    await page.request.post(`${SUPABASE_URL}/rest/v1/waiters`, {
      headers,
      data: {
        id: waiterId,
        business_id: businessId,
        branch_id: branchId,
        version: 1,
        data: { id: waiterId, name: "TEST Mesero", active: true, businessId, branchId }
      }
    });

    const noKitchenProductId = `prod_${businessId}_no_kitchen_e2e`;
    await page.request.post(`${SUPABASE_URL}/rest/v1/products`, {
      headers,
      data: {
        id: noKitchenProductId,
        business_id: businessId,
        branch_id: branchId,
        version: 1,
        data: {
          id: noKitchenProductId,
          name: "Gaseosa TEST No Cocina",
          price: 4000,
          stock: 100,
          active: true,
          requiresKitchen: false,
          businessId,
          branchId
        }
      }
    });

    for (let i = 0; i < 4; i += 1) {
      const tableId = `table_${businessId}_${i}_e2e`;
      await page.request.post(`${SUPABASE_URL}/rest/v1/tables`, {
        headers,
        data: {
          id: tableId,
          business_id: businessId,
          branch_id: branchId,
          version: 1,
          data: {
            id: tableId,
            name: `Mesa ${i + 1}`,
            capacity: 4,
            peopleCount: 0,
            status: "FREE",
            waiterId: null,
            customerId: null,
            items: [],
            subtotal: 0,
            tax: 0,
            discount: 0,
            total: 0,
            notes: null,
            zone: "Salón",
            mergedInto: null,
            openedAt: null,
            openOperationId: null,
            orderId: null,
            businessId,
            branchId
          }
        }
      });
    }
  } catch {
    // Auxiliary seed failures must not hide the auth result. Individual E2E
    // tests will surface any missing operational data they actually require.
  }
}

export const test = base.extend<VimdyFixtures, WorkerFixtures>({
  // Runs once per Playwright worker, including tests that do NOT request the
  // authenticatedPage fixture (e.g. the direct login test).
  e2eEnvironmentReady: [
    async ({}, use) => {
      await ensureE2EEnvironment();
      await use();
    },
    { scope: "worker", auto: true }
  ],

  authenticatedPage: async ({ page, context, e2eEnvironmentReady }, use) => {
    void e2eEnvironmentReady;

    await context.addInitScript(() => {
      try {
        localStorage.setItem("vimdy:intro:shown", "1");
        localStorage.setItem("vimdy.countrySelected", "1");
      } catch {
        // localStorage can be unavailable in unusual browser contexts.
      }
    });

    await page.goto("/login");
    await page.waitForURL(/\/login|\/pais/, { timeout: 60_000 });

    if (page.url().includes("/pais")) {
      const firstCountry = page
        .locator("button")
        .filter({ hasText: /Colombia|Argentina|Chile|México|Perú|España|Ecuador|Panamá|Estados Unidos/ })
        .first();
      if ((await firstCountry.count()) > 0) {
        await firstCountry.click();
        await page.getByRole("button", { name: /Continuar|Continue/ }).click();
        await page.waitForURL("**/login", { timeout: 60_000 });
      }
    }

    await page.waitForSelector("#email", { timeout: 60_000 });
    await page.locator("#email").fill(E2E_ACCOUNTS[0].email);
    await page.locator("#password").fill(TEST_PASSWORD);
    await page.getByRole("button", { name: "Iniciar sesión" }).click();
    await page.waitForURL("**/dashboard", { timeout: 60_000 });

    await seedWaitersAndTables(page);

    await use(page);
  },

  testBusinessName: ["TEST Restaurante TEST run_20260816002021_4egukk", { option: false }]
});

export { expect };
