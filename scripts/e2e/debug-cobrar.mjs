import { chromium } from "playwright";

const BASE_URL = "http://localhost:5173";

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  await context.addInitScript(() => {
    try {
      localStorage.setItem("vimdy:intro:shown", "1");
      localStorage.setItem("vimdy.countrySelected", "1");
    } catch {}
  });

  page.on("console", (msg) => console.log("[console]", msg.type(), msg.text()));
  page.on("pageerror", (err) => console.log("[pageerror]", err.message));

  console.log("1. Login...");
  await page.goto(BASE_URL + "/login", { waitUntil: "networkidle", timeout: 60000 });
  await page.waitForSelector("#email", { timeout: 60000 });
  await page.locator("#email").fill("test.restaurante.run_20260816002021_4egukk@vimdy.dev");
  await page.locator("#password").fill("Test123456!");
  await page.getByRole("button", { name: "Iniciar sesión" }).click();
  await page.waitForURL("**/dashboard", { timeout: 60000 });

  console.log("2. Ir a /caja...");
  await page.goto(BASE_URL + "/caja", { waitUntil: "networkidle", timeout: 60000 });
  await page.waitForTimeout(2000);

  console.log("3. Click Venta rápida...");
  await page.getByRole("button", { name: /Venta rápida/i }).click();
  await page.waitForTimeout(1000);

  console.log("4. Click producto...");
  const firstProduct = page.getByRole("button", { name: /Hamburguesa TEST/i }).first();
  if (await firstProduct.count() > 0) {
    await firstProduct.click();
    await page.waitForTimeout(500);
  }

  console.log("5. Click COBRAR...");
  await page.getByRole("button", { name: /COBRAR/i }).click();
  await page.waitForTimeout(2000);

  const html = await page.content();
  const bodyMatch = html.match(/<body[^>]*>([\s\S]*)<\/body>/);
  if (bodyMatch) {
    console.log("6. Body después de COBRAR:", bodyMatch[1].slice(0, 2000));
  }

  const bodyText = await page.locator("body").innerText();
  console.log("7. Body text:", bodyText.slice(0, 2000));

  // Verificar overlays/modales
  const overlays = await page.locator("[class*='z-\\[999\\]'], [class*='fixed inset-0'], [role='dialog'], [role='alertdialog']").allTextContents();
  console.log("8. Overlays/modales:", overlays);

  await browser.close();
})().catch((err) => {
  console.error("Error:", err);
  process.exit(1);
});
