import { describe, expect, it } from "vitest";
import { isChunkLoadError } from "../../src/core/utils/lazyWithRetry";

describe("isChunkLoadError", () => {
  it("reconoce errores de chunk de Chrome, Firefox, Safari y Webpack", () => {
    expect(isChunkLoadError(new TypeError("Failed to fetch dynamically imported module: https://x/assets/KitchenPage-NXMVi0y3.js"))).toBe(true);
    expect(isChunkLoadError(new TypeError("error loading dynamically imported module"))).toBe(true);
    expect(isChunkLoadError(new TypeError("Importing a module script failed."))).toBe(true);
    expect(isChunkLoadError(new Error("Loading chunk 12 failed."))).toBe(true);
  });
  it("no confunde errores normales de la app", () => {
    expect(isChunkLoadError(new Error("Cannot read properties of undefined"))).toBe(false);
    expect(isChunkLoadError(null)).toBe(false);
  });
});