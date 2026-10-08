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

  console.log("1. Login y navegar a /caja...");
  await page.goto(BASE_URL + "/login", { waitUntil: "networkidle", timeout: 60000 });
  await page.waitForSelector("#email", { timeout: 60000 });
  await page.locator("#email").fill("test.restaurante.run_20260816002021_4egukk@vimdy.dev");
  await page.locator("#password").fill("Test123456!");
  await page.getByRole("button", { name: "Iniciar sesión" }).click();
  await page.waitForURL("**/dashboard", { timeout: 60000 });

  console.log("2. URL dashboard:", page.url());
  await page.goto(BASE_URL + "/caja", { waitUntil: "networkidle", timeout: 60000 });
  console.log("3. URL caja:", page.url());

  await page.waitForTimeout(3000);

  const html = await page.content();
  const bodyMatch = html.match(/<body[^>]*>([\s\S]*)<\/body>/);
  if (bodyMatch) {
    console.log("4. Body primeros 1500 chars:", bodyMatch[1].slice(0, 1500));
  }

  const bodyText = await page.locator("body").innerText();
  console.log("5. Body text:", bodyText.slice(0, 1500));

  const buttons = await page.locator("button").allTextContents();
  console.log("6. Buttons:", buttons.slice(0, 30));

  await browser.close();
})().catch((err) => {
  console.error("Error:", err);
  process.exit(1);
});
