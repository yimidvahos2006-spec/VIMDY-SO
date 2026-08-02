// vitest.config.ts
import { defineConfig } from "vitest/config";

/**
 * Config de vitest — CRÍTICO #7 del checklist de lanzamiento.
 * `environment: "node"` porque los smoke tests corren contra los engines
 * de `src/core` con dobles de prueba en memoria (ver tests/fakes/), sin
 * necesidad de un DOM real. El único test que toca algo "de browser"
 * (login) mockea el módulo de Supabase en vez de depender de uno.
 */
export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    globals: false
  }
});