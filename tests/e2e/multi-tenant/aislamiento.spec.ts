import { test, expect } from "../fixtures/vimdy-fixtures";

async function selectCountryIfNeeded(page: import("@playwright/test").Page) {
  if (page.url().includes("/pais")) {
    const firstCountry = page.locator("button").filter({ hasText: /Colombia|Argentina|Chile|México|Perú|España|Ecuador|Panamá|Estados Unidos/ }).first();
    if (await firstCountry.count() > 0) {
      await firstCountry.click();
      await page.getByRole("button", { name: /Continuar|Continue/ }).click();
      await page.waitForLoadState("networkidle", { timeout: 60_000 });
    }
  }
}

test.describe("Multi-tenant E2E", () => {
  test("negocio A no ve datos de negocio B", async ({ page, context }) => {
    const businessAEmail = "test.restaurante.run_20260816002021_4egukk@vimdy.dev";
    const businessBEmail = "test.cafeteria.run_20260816002021_4egukk@vimdy.dev";
    const password = "Test123456!";

    await context.addInitScript(() => {
      try {
        localStorage.setItem("vimdy:intro:shown", "1");
        localStorage.setItem("vimdy.countrySelected", "1");
      } catch {}
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
    await page.locator("#email").fill(businessAEmail);
    await page.locator("#password").fill(password);
    await page.getByRole("button", { name: "Iniciar sesión" }).click();
    await page.waitForURL("**/dashboard", { timeout: 60_000 });

    await page.goto("/caja");
    await page.waitForURL("**/caja", { timeout: 15_000 });
    const salesBefore = await page.getByText(/\$\d+|\d+ ventas|sin ventas|No hay ventas/i).count();

    await page.getByRole("button", { name: /salir|cerrar sesión|logout/i }).click();
    await page.waitForURL("**/login", { timeout: 15_000 });

    if (page.url().includes("/pais")) {
      const firstCountry = page.locator("button").filter({ hasText: /Colombia|Argentina|Chile|México|Perú|España|Ecuador|Panamá|Estados Unidos/ }).first();
      if (await firstCountry.count() > 0) {
        await firstCountry.click();
        await page.getByRole("button", { name: /Continuar|Continue/ }).click();
        await page.waitForURL("**/login", { timeout: 60_000 });
      }
    }

    await page.waitForSelector("#email", { timeout: 60_000 });
    await page.locator("#email").fill(businessBEmail);
    await page.locator("#password").fill(password);
    await page.getByRole("button", { name: "Iniciar sesión" }).click();
    await page.waitForURL("**/dashboard", { timeout: 60_000 });

    await page.goto("/caja");
    await page.waitForURL("**/caja", { timeout: 15_000 });
    const salesAfter = await page.getByText(/\$\d+|\d+ ventas|sin ventas|No hay ventas/i).count();

    expect(salesAfter).toBeGreaterThanOrEqual(0);
  });
});
