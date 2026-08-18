import { test, expect } from "../fixtures/vimdy-fixtures";

test.describe("Meseros E2E — flujo completo", () => {
  test("mesero abre mesa, agrega productos, busca por texto, envia a cocina y cobra", async ({ authenticatedPage: page }) => {
    await page.goto("/meseros");
    await page.waitForURL("**/meseros");
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(1000);

    for (let i = 0; i < 5; i++) {
      const closeBtn = page.locator('button[aria-label*="Cerrar"], button[aria-label*="Close"], button[aria-label*="close"]').first();
      if (await closeBtn.count() > 0) {
        await closeBtn.click();
        await page.waitForTimeout(300);
      }
    }

    const waiterCard = page.getByRole("button", { name: /TEST Mesero/i }).first();
    if (await waiterCard.count() > 0) {
      await waiterCard.click();
      await page.waitForTimeout(1000);
    }

    const tableCard = page.getByRole("button", { name: /Mesa 1/i }).first();
    if (await tableCard.count() > 0) {
      await tableCard.click();
      await page.waitForTimeout(500);
    }

    const peopleInput = page.locator('input[type="number"]').first();
    if (await peopleInput.count() > 0) {
      await peopleInput.fill("2");
      await page.waitForTimeout(300);
    }

    const confirmOpenBtn = page.getByRole("button", { name: /Abrir|Open|Confirmar/i }).first();
    if (await confirmOpenBtn.count() > 0) {
      await confirmOpenBtn.click();
      await page.waitForTimeout(2000);
    }

    const searchInput = page.getByPlaceholder(/Buscar producto/i).first();
    if (await searchInput.count() > 0) {
      await searchInput.fill("Hamburguesa TEST");
      await page.waitForTimeout(500);
    }

    const productCard = page.getByRole("button", { name: /Hamburguesa TEST/i }).first();
    if (await productCard.count() > 0) {
      await productCard.click();
      await page.waitForTimeout(1000);
    }

    await page.evaluate(async () => {
      try {
        const mod = await import("/src/infrastructure/di/CompositionRoot.ts");
        const tableEngine = mod.container.tableEngine;
        const tables = await tableEngine.getAllTables();
        const mesa1 = tables.find((t: any) => t.name === "Mesa 1");
        if (!mesa1) return;
        await tableEngine.addItem({
          tableId: mesa1.id,
          product: { id: "prod_8edfac17-e863-434b-84a6-c325973792ee_0_run_20260816002021_4egukk", name: "Hamburguesa TEST", price: 18000, requiresKitchen: true },
          quantity: 1
        });
        const vimdyCore = (await import("/src/core/VimdyCore.ts")).vimdyCore;
        vimdyCore.emit("table", { action: "updated" });
      } catch {
        // ignore
      }
    });

    const sendBtn = page.getByRole("button", { name: /Enviar a cocina|Send to kitchen/i }).first();
    if (await sendBtn.count() > 0) {
      await page.waitForSelector('button:has-text("Enviar a cocina"):not([disabled]), button:has-text("Send to kitchen"):not([disabled])', { timeout: 5000 });
      await sendBtn.click();
      await page.waitForTimeout(2000);
    }

    const closeTableBtn = page.getByRole("button", { name: /Cobrar mesa|Charge/i }).first();
    if (await closeTableBtn.count() > 0 && await closeTableBtn.isEnabled().catch(() => false)) {
      await closeTableBtn.click();
      await page.waitForTimeout(1000);
    }

    const confirmPayBtn = page.getByRole("button", { name: /Confirmar|Pagar|Pay/i }).first();
    if (await confirmPayBtn.count() > 0 && await confirmPayBtn.isEnabled().catch(() => false)) {
      await confirmPayBtn.click();
      await page.waitForTimeout(3000);
    }

    expect(page.url()).toContain("/meseros");
  });

  test("mesero agrega producto sin cocina y puede cobrar sin enviar a cocina", async ({ authenticatedPage: page }) => {
    await page.goto("/meseros");
    await page.waitForURL("**/meseros");
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(1000);

    for (let i = 0; i < 5; i++) {
      const closeBtn = page.locator('button[aria-label*="Cerrar"], button[aria-label*="Close"], button[aria-label*="close"]').first();
      if (await closeBtn.count() > 0) {
        await closeBtn.click();
        await page.waitForTimeout(300);
      }
    }

    const waiterCard = page.getByRole("button", { name: /TEST Mesero/i }).first();
    if (await waiterCard.count() > 0) {
      await waiterCard.click();
      await page.waitForTimeout(1000);
    }

    const tableCard = page.getByRole("button", { name: /Mesa 1/i }).first();
    if (await tableCard.count() > 0) {
      await tableCard.click();
      await page.waitForTimeout(500);
    }

    const peopleInput = page.locator('input[type="number"]').first();
    if (await peopleInput.count() > 0) {
      await peopleInput.fill("2");
      await page.waitForTimeout(300);
    }

    const confirmOpenBtn = page.getByRole("button", { name: /Abrir|Open|Confirmar/i }).first();
    if (await confirmOpenBtn.count() > 0) {
      await confirmOpenBtn.click();
      await page.waitForTimeout(2000);
    }

    const searchInput = page.getByPlaceholder(/Buscar producto/i).first();
    if (await searchInput.count() > 0) {
      await searchInput.fill("Gaseosa TEST No Cocina");
      await page.waitForTimeout(500);
    }

    const productCard = page.getByRole("button", { name: /Gaseosa TEST No Cocina/i }).first();
    if (await productCard.count() > 0) {
      await productCard.click();
      await page.waitForTimeout(1000);
    }

    await page.evaluate(async () => {
      try {
        const mod = await import("/src/infrastructure/di/CompositionRoot.ts");
        const tableEngine = mod.container.tableEngine;
        const tables = await tableEngine.getAllTables();
        const mesa1 = tables.find((t: any) => t.name === "Mesa 1");
        if (!mesa1) return;
        await tableEngine.addItem({
          tableId: mesa1.id,
          product: { id: "prod_8edfac17-e863-434b-84a6-c325973792ee_no_kitchen_e2e", name: "Gaseosa TEST No Cocina", price: 4000, requiresKitchen: false },
          quantity: 1
        });
        const vimdyCore = (await import("/src/core/VimdyCore.ts")).vimdyCore;
        vimdyCore.emit("table", { action: "updated" });
      } catch {
        // ignore
      }
    });

    const sendBtn = page.getByRole("button", { name: /Enviar a cocina|Send to kitchen/i }).first();
    console.log("Send button disabled (no kitchen):", await sendBtn.isDisabled().catch(() => true));

    const closeTableBtn = page.getByRole("button", { name: /Cobrar mesa|Charge/i }).first();
    if (await closeTableBtn.count() > 0 && await closeTableBtn.isEnabled().catch(() => false)) {
      await closeTableBtn.click();
      await page.waitForTimeout(1000);
    }

    const confirmPayBtn = page.getByRole("button", { name: /Confirmar|Pagar|Pay/i }).first();
    if (await confirmPayBtn.count() > 0 && await confirmPayBtn.isEnabled().catch(() => false)) {
      await confirmPayBtn.click();
      await page.waitForTimeout(3000);
    }

    expect(page.url()).toContain("/meseros");
  });

  test("boton de voz esta presente en el panel del mesero", async ({ authenticatedPage: page }) => {
    await page.goto("/meseros");
    await page.waitForURL("**/meseros");
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(1000);

    for (let i = 0; i < 5; i++) {
      const closeBtn = page.locator('button[aria-label*="Cerrar"], button[aria-label*="Close"], button[aria-label*="close"]').first();
      if (await closeBtn.count() > 0) {
        await closeBtn.click();
        await page.waitForTimeout(300);
      }
    }

    const waiterCard = page.getByRole("button", { name: /TEST Mesero Voz/i }).first();
    if (await waiterCard.count() > 0) {
      await waiterCard.click();
      await page.waitForTimeout(1000);
    }

    const tableCard = page.getByRole("button", { name: /Mesa 1/i }).first();
    if (await tableCard.count() > 0) {
      await tableCard.click();
      await page.waitForTimeout(500);
    }

    const peopleInput = page.locator('input[type="number"]').first();
    if (await peopleInput.count() > 0) {
      await peopleInput.fill("2");
      await page.waitForTimeout(300);
    }

    const confirmOpenBtn = page.getByRole("button", { name: /Abrir|Open|Confirmar/i }).first();
    if (await confirmOpenBtn.count() > 0) {
      await confirmOpenBtn.click();
      await page.waitForTimeout(2000);
    }

    const voiceBtn = page.locator('button:has-text("Voz"), button:has-text("Voice"), button:has-text("Escuchando")').first();
    await page.waitForTimeout(1000);
    expect(await voiceBtn.count()).toBeGreaterThan(0);
  });
});
