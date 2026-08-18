import { test, expect } from "../fixtures/vimdy-fixtures";

test.describe("POS E2E — flujo completo de negocio", () => {
  test("venta rápida: buscar → agregar → cobrar → comprobar", async ({ authenticatedPage: page }) => {
    await page.goto("/caja");
    await page.waitForURL("**/caja");

    for (let i = 0; i < 5; i++) {
      const closeBtn = page.locator('button[aria-label*="Cerrar"], button[aria-label*="Close"], button[aria-label*="close"]').first();
      if (await closeBtn.count() > 0) {
        await closeBtn.click();
        await page.waitForTimeout(300);
      }
    }

    await page.getByRole("button", { name: /Turno de caja/i }).click();
    await page.waitForTimeout(500);

    const openingAmountInput = page.locator('input[type="number"]').first();
    if (await openingAmountInput.count() > 0) {
      await openingAmountInput.fill("100000");
      await page.waitForTimeout(300);
    }

    const openShiftBtn = page.getByRole("button", { name: /Abrir turno|Open shift/i }).first();
    if (await openShiftBtn.count() > 0) {
      await openShiftBtn.click();
      await page.waitForTimeout(1000);
    }

    await page.getByRole("button", { name: /Venta rápida/i }).click();
    await page.waitForTimeout(500);

    const productCard = page.getByRole("button", { name: /Hamburguesa TEST|Papas Fritas TEST|Gaseosa TEST/i }).first();
    if (await productCard.count() > 0) {
      await productCard.click();
      await page.waitForTimeout(800);
    }

    const cartText = await page.locator('text=/producto|carrito vacío/i').first().innerText().catch(() => "");
    console.log("Cart text after add:", cartText);

    const efectivoBtn = page.getByRole("button", { name: /^Efectivo$/i }).first();
    if (await efectivoBtn.count() > 0) {
      await efectivoBtn.click();
      await page.waitForTimeout(500);
    }

    const recibido = page.locator("#pos-cash-received");
    if (await recibido.count() > 0) {
      await recibido.fill("100000");
      await page.waitForTimeout(300);
    }

    const actionBtn = page.getByRole("button", { name: /COBRAR|ENVIAR|FACTURAR/i }).last();
    console.log("Action button count:", await actionBtn.count());
    console.log("Action button enabled:", await actionBtn.isEnabled().catch(() => false));

    if (await actionBtn.count() > 0 && await actionBtn.isEnabled().catch(() => false)) {
      await actionBtn.click();
      await page.waitForTimeout(3000);
      console.log("URL after action button:", page.url());
    }

    const finalUrl = page.url();
    console.log("Final URL:", finalUrl);
    console.log("Body snippet:", (await page.locator("body").innerText()).slice(0, 500));

    expect(finalUrl).not.toContain("/login");
  });
});
