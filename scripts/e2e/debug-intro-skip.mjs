import { chromium } from "playwright";

const BASE_URL = "http://localhost:5173";

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  // Simulate what the test does: set localStorage before navigation
  await context.addInitScript(() => {
    try {
      localStorage.setItem("vimdy:intro:shown", "1");
      localStorage.setItem("vimdy.countrySelected", "1");
    } catch {}
  });

  page.on("console", (msg) => console.log("[console]", msg.type(), msg.text()));
  page.on("pageerror", (err) => console.log("[pageerror]", err.message));

  console.log("1. Yendo a /login...");
  await page.goto(BASE_URL + "/login", { waitUntil: "networkidle", timeout: 60000 });

  const url = page.url();
  console.log("2. URL:", url);

  await page.waitForTimeout(3000);

  const html = await page.content();
  const bodyMatch = html.match(/<body[^>]*>([\s\S]*)<\/body>/);
  if (bodyMatch) {
    console.log("3. Body:", bodyMatch[1].slice(0, 1000));
  }

  const hasEmail = await page.locator("#email").count();
  console.log("4. Has #email:", hasEmail);

  const bodyText = await page.locator("body").innerText();
  console.log("5. Body text:", bodyText.slice(0, 500));

  await browser.close();
})().catch((err) => {
  console.error("Error:", err);
  process.exit(1);
});
