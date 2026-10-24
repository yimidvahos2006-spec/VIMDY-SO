import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Guarda estática (P0 snapshot del conteo): ningún archivo del conteo puede leer el
 * catálogo por las rutas que pueden devolver CACHÉ local (`listAll` / `findAll`).
 * Desde que el conteo vive en el servidor, el motor no lee stock: solo habla con el gateway.
 */
const DIR = join(process.cwd(), "src", "core", "inventoryCount");
const stripComments = (code: string) => code.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

describe("conteo de inventario: nunca lee stock del caché", () => {
  const files = readdirSync(DIR).filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"));

  it("hay archivos del conteo que revisar", () => {
    expect(files).toContain("InventoryCountEngine.ts");
  });

  for (const file of files) {
    it(`${file} no usa listAll()/findAll() del catálogo`, () => {
      const code = stripComments(readFileSync(join(DIR, file), "utf-8"));
      expect(code).not.toMatch(/\.listAll\s*\(/);
      expect(code).not.toMatch(/products?\w*\.findAll\s*\(/i);
    });
  }

  it("el motor no lee stock: todo pasa por el gateway del servidor", () => {
    const code = stripComments(readFileSync(join(DIR, "InventoryCountEngine.ts"), "utf-8"));
    expect(code).toMatch(/this\.gateway\./);
    expect(code).not.toMatch(/listAllAuthoritative\s*\(/);
  });
});