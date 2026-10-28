import { test } from '@playwright/test';

test.use({
  headless: false,
  launchOptions: {
    slowMo: 1000, // Pausa de 1 segundo en cada clic/escritura
  },
  viewport: { width: 1280, height: 720 },
});

test('Demostración visual continua para YouTube', async ({ page }) => {
  // 1. Abrir la página de Login
  await page.goto('http://localhost:5173/login');
  await page.waitForTimeout(1500);

  // 2. Llenar los campos de entrada que encuentre
  const inputs = page.locator('input');
  await inputs.nth(0).fill('yimidvahos2006@gmail.com');
  await inputs.nth(1).fill('Yimid09@@@');
  await page.waitForTimeout(1000);

  // 3. Hacer clic en el botón de Iniciar Sesión
  await page.locator('button[type="submit"], button:has-text("Iniciar"), button:has-text("Entrar")').first().click();

  // 4. Esperar a que entre al Dashboard
  await page.waitForTimeout(3000);

  // 5. Recorrido por las secciones si existen en el menú
  const irASeccion = async (nombre: string) => {
    const enlace = page.locator(`text=${nombre}`).first();
    if (await enlace.isVisible({ timeout: 2000 }).catch(() => false)) {
      await enlace.click();
      await page.waitForTimeout(2500);
    }
  };

  await irASeccion('Inventario');
  await irASeccion('Productos');
  await irASeccion('Caja');

  // 6. MANTENER EL NAVEGADOR ABIERTO PARA QUE GRABES
  console.log('--- NAVEGADOR LISTO Y CONGELADO PARA TU GRABACIÓN ---');
  await page.pause(); // Esta línea impide que la ventana se cierre sola
});