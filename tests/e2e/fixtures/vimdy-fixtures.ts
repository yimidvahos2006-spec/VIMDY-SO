import { test as base, expect, type Page } from "@playwright/test";

const TEST_EMAIL = "test.restaurante.run_20260816002021_4egukk@vimdy.dev";
const TEST_PASSWORD = "Test123456!";

export interface VimdyFixtures {
  authenticatedPage: Page;
  testBusinessName: string;
}

async function seedWaitersAndTables(page: Page) {
  const accessToken = await page.evaluate(() => {
    const sessionStr = localStorage.getItem("sb-upoztxlcudrqhnjwjgho-auth-token");
    if (!sessionStr) return null;
    try {
      const session = JSON.parse(sessionStr);
      return session?.access_token || session?.currentSession?.access_token || null;
    } catch {
      return null;
    }
  });

  if (!accessToken) return;

  const ANON_KEY = "sb_publishable_zUHiDR00FbET1qisM11DCw_iWJ82nDT";
  const SUPABASE_URL = "https://upoztxlcudrqhnjwjgho.supabase.co";

  const headers = {
    apikey: ANON_KEY,
    Authorization: `Bearer ${accessToken}`,
    "Content-Type": "application/json",
    Prefer: "resolution=merge-duplicates"
  };

  try {
    const bizRes = await page.request.get(
      `${SUPABASE_URL}/rest/v1/businesses?select=id&name=eq.TEST%20Restaurante%20TEST%20run_20260816002021_4egukk`,
      { headers }
    );
    const businesses = await bizRes.json();
    if (!Array.isArray(businesses) || businesses.length === 0) return;
    const businessId = businesses[0].id;

    let branchId: string | undefined;
    try {
      const mod = await page.evaluate(async () => {
        try {
          const mod = await import("/src/infrastructure/supabase/supabaseClient.ts");
          return { branchId: mod.getCurrentBranchId?.(), businessId: mod.getCurrentBusinessId?.() };
        } catch {
          return {};
        }
      });
      branchId = mod.branchId;
    } catch {
      // ignore
    }

    if (!branchId) {
      const prodRes = await page.request.get(
        `${SUPABASE_URL}/rest/v1/products?select=branch_id&business_id=eq.${businessId}&limit=1`,
        { headers }
      );
      const products = await prodRes.json();
      if (Array.isArray(products) && products.length > 0 && products[0].branch_id) {
        branchId = products[0].branch_id;
      }
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

    for (let i = 0; i < 4; i++) {
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
    // ignore seed errors
  }
}

export const test = base.extend<VimdyFixtures>({
  authenticatedPage: async ({ page, context }, use) => {
    await context.addInitScript(() => {
      try {
        localStorage.setItem("vimdy:intro:shown", "1");
        localStorage.setItem("vimdy.countrySelected", "1");
      } catch {
        // localStorage puede no estar disponible en algunos contextos.
      }
    });

    await page.goto("/login");
    await page.waitForURL(/\/login|\/pais/, { timeout: 60_000 });

    if (page.url().includes("/pais")) {
      const firstCountry = page.locator("button").filter({ hasText: /Colombia|Argentina|Chile|México|Perú|España|Ecuador|Panamá|Estados Unidos/ }).first();
      if (await firstCountry.count() > 0) {
        await firstCountry.click();
        await page.getByRole("button", { name: /Continuar|Continue/ }).click();
        await page.waitForURL("**/login", { timeout: 60_000 });
      }
    }

    await page.waitForSelector("#email", { timeout: 60_000 });
    await page.locator("#email").fill(TEST_EMAIL);
    await page.locator("#password").fill(TEST_PASSWORD);
    await page.getByRole("button", { name: "Iniciar sesión" }).click();
    await page.waitForURL("**/dashboard", { timeout: 60_000 });

    await seedWaitersAndTables(page);

    await use(page);
  },
  testBusinessName: ["TEST Restaurante TEST run_20260816002021_4egukk", { option: false }]
});

export { expect };
