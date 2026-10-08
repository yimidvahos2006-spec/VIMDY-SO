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

  console.log("2. URL:", page.url());

  await page.waitForTimeout(3000);

  // Obtener todos los headings
  const headings = await page.locator("h1, h2, h3, h4, h5, h6").allTextContents();
  console.log("3. Headings:", headings.slice(0, 20));

  // Obtener todos los links
  const links = await page.locator("a, [role='link'], button").allTextContents();
  console.log("4. Links/buttons:", links.slice(0, 30));

  // Obtener texto del sidebar
  const sidebarText = await page.locator("aside, nav").allTextContents();
  console.log("5. Sidebar/nav text:", sidebarText.slice(0, 50));

  await browser.close();
})().catch((err) => {
  console.error("Error:", err);
  process.exit(1);
});
