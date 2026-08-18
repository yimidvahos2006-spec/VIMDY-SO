import { test, expect } from "../fixtures/vimdy-fixtures";

async function selectCountryIfNeeded(page: import("@playwright/test").Page) {
  await page.waitForURL(/\/login|\/pais/, { timeout: 60_000 });
  if (page.url().includes("/pais")) {
    const firstCountry = page.locator("button").filter({ hasText: /Colombia|Argentina|Chile|México|Perú|España|Ecuador|Panamá|Estados Unidos/ }).first();
    if (await firstCountry.count() > 0) {
      await firstCountry.click();
      await page.getByRole("button", { name: /Continuar|Continue/ }).click();
      await page.waitForURL("**/login", { timeout: 60_000 });
    }
  }
}

test.describe("Auth E2E", () => {
  test("login exitoso redirige al dashboard", async ({ page, context }) => {
    await context.addInitScript(() => {
      try {
        localStorage.setItem("vimdy:intro:shown", "1");
        localStorage.setItem("vimdy.countrySelected", "1");
      } catch {}
    });
    await page.goto("/login");
    await selectCountryIfNeeded(page);
    await page.getByLabel("Correo electrónico").fill("test.restaurante.run_20260816002021_4egukk@vimdy.dev");
    await page.locator("#password").fill("Test123456!");
    await page.getByRole("button", { name: "Iniciar sesión" }).click();
    await page.waitForURL("**/dashboard", { timeout: 30_000 });
    await expect(page.getByText("Indicadores principales")).toBeVisible();
  });

  test("logout funciona y vuelve al login", async ({ authenticatedPage: page }) => {
    await page.getByRole("button", { name: /salir|cerrar sesión|logout/i }).click();
    await page.waitForURL("**/login", { timeout: 15_000 });
    await expect(page.getByRole("heading", { name: /bienvenido|iniciar sesión/i })).toBeVisible();
  });

  test("recargar dashboard mantiene la sesión", async ({ authenticatedPage: page }) => {
    await page.waitForURL("**/dashboard");
    await page.reload();
    await expect(page.getByText("Indicadores principales")).toBeVisible();
  });
});
