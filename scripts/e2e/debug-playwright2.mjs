import { chromium } from "playwright";

const BASE_URL = "http://localhost:5173";

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  page.on("console", (msg) => console.log("[console]", msg.type(), msg.text()));
  page.on("pageerror", (err) => console.log("[pageerror]", err.message));
  page.on("requestfailed", (req) => console.log("[requestfailed]", req.url(), req.failure()?.errorText));

  console.log("1. Yendo a /login...");
  await page.goto(BASE_URL + "/login", { waitUntil: "networkidle", timeout: 60000 });

  const url1 = page.url();
  console.log("2. URL actual:", url1);

  // Esperar un poco para que React hidrate
  await page.waitForTimeout(3000);

  const html = await page.content();
  console.log("3. HTML length:", html.length);

  // Buscar el contenido del body
  const bodyMatch = html.match(/<body[^>]*>([\s\S]*)<\/body>/);
  if (bodyMatch) {
    console.log("4. Body primeros 1000 chars:", bodyMatch[1].slice(0, 1000));
  }

  const hasEmail = await page.locator("#email").count();
  console.log("5. Count #email:", hasEmail);

  const bodyText = await page.locator("body").innerText();
  console.log("6. Body text length:", bodyText.length);
  console.log("7. Body text:", bodyText.slice(0, 1000));

  // Verificar si hay redirección a /pais
  if (url1.includes("/pais")) {
    console.log("8. Redirigido a /pais");

    // Seleccionar primer país
    const firstCountry = page.locator("button").filter({ hasText: /Colombia/ }).first();
    if (await firstCountry.count() > 0) {
      await firstCountry.click();
      await page.getByRole("button", { name: /Continuar/ }).click();
      await page.waitForURL("**/login", { timeout: 60000 });
      console.log("9. Después de seleccionar país, URL:", page.url());

      await page.waitForTimeout(3000);
      const hasEmailAfter = await page.locator("#email").count();
      console.log("10. Count #email después de /pais:", hasEmailAfter);

      const bodyTextAfter = await page.locator("body").innerText();
      console.log("11. Body text después:", bodyTextAfter.slice(0, 500));
    }
  }

  await browser.close();
})().catch((err) => {
  console.error("Error:", err);
  process.exit(1);
});
