import { defineConfig } from "vitest/config";

/**
 * Config de las pruebas de integración (Gate 1). Corren contra un Supabase
 * real y requieren las variables VIMDY_GATE1_* (ver
 * tests/integration/saleFulfillment.concurrent.test.ts). Sin ellas la suite
 * falla cerrada con BLOCKED_ENVIRONMENT, a propósito.
 */
export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/integration/**/*.test.ts"],
    globals: false,
    testTimeout: 60_000,
    hookTimeout: 60_000
  }
});