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
  await page.waitForTimeout(500);

  console.log("4. Click producto...");
  await page.getByRole("button", { name: /Hamburguesa TEST/i }).first().click();
  await page.waitForTimeout(500);

  console.log("5. Click COBRAR...");
  await page.getByRole("button", { name: /COBRAR/i }).click();
  await page.waitForTimeout(2000);

  // Buscar botones de cerrar/escape en el modal
  const closeButtons = await page.locator("button[aria-label*='close' i], button[aria-label*='cerrar' i], [class*='close' i], [class*='x' i]").allTextContents();
  console.log("6. Close buttons:", closeButtons);

  const modalText = await page.locator("[class*='z-\\[999\\]'], [class*='backdrop']").allTextContents();
  console.log("7. Modal text:", modalText);

  // Intentar presionar Escape
  await page.keyboard.press("Escape");
  await page.waitForTimeout(1000);

  const afterEscape = await page.locator("body").innerText();
  console.log("8. After Escape:", afterEscape.slice(0, 500));

  await browser.close();
})().catch((err) => {
  console.error("Error:", err);
  process.exit(1);
});
