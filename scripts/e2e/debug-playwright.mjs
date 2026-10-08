import { chromium } from "playwright";

const BASE_URL = "http://localhost:5173";

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  // Capturar requests y console
  page.on("console", (msg) => console.log("[console]", msg.type(), msg.text()));
  page.on("pageerror", (err) => console.log("[pageerror]", err.message));
  page.on("requestfailed", (req) => console.log("[requestfailed]", req.url(), req.failure()?.errorText));

  console.log("1. Yendo a /login...");
  await page.goto(BASE_URL + "/login", { waitUntil: "networkidle", timeout: 60000 });

  const url1 = page.url();
  console.log("2. URL actual:", url1);

  const html1 = await page.content();
  console.log("3. HTML length:", html1.length);
  console.log("4. HTML primeros 500 chars:", html1.slice(0, 500));

  const hasEmail = await page.locator("#email").count();
  console.log("5. Count #email:", hasEmail);

  const bodyText = await page.locator("body").innerText();
  console.log("6. Body text:", bodyText.slice(0, 500));

  await browser.close();
})().catch((err) => {
  console.error("Error:", err);
  process.exit(1);
});
