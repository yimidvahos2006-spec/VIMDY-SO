import { describe, it, expect } from "vitest";
import {
  WAITER_NAME_MAX_LENGTH,
  WAITER_PHOTO_MAX_CHARS,
  normalizeWaiterName,
  waiterNameKey,
  waiterPhotoProblem,
} from "../../src/core/utils/waiterProfile";

describe("límites del nombre del mesero", () => {
  it("el máximo es 40 caracteres", () => {
    expect(WAITER_NAME_MAX_LENGTH).toBe(40);
  });

  it("normaliza espacios repetidos y de los extremos, y conserva cómo lo escribió el dueño", () => {
    expect(normalizeWaiterName("   Juan    Pérez  ")).toBe("Juan Pérez");
    expect(normalizeWaiterName("\tAna\n María ")).toBe("Ana María");
  });

  it("un nombre de exactamente 40 caracteres cabe y uno de 41 no", () => {
    expect(normalizeWaiterName("a".repeat(40)).length).toBeLessThanOrEqual(WAITER_NAME_MAX_LENGTH);
    expect(normalizeWaiterName("a".repeat(41)).length).toBeGreaterThan(WAITER_NAME_MAX_LENGTH);
  });

  it("los espacios sobrantes no cuentan para el límite", () => {
    const padded = `  ${"a".repeat(40)}   `;
    expect(normalizeWaiterName(padded).length).toBe(40);
  });
});

describe("llave de comparación de nombres (sin tildes ni mayúsculas)", () => {
  it("José, jose y JOSÉ son el mismo nombre", () => {
    const keys = ["José", "jose", "JOSÉ", "  Jose  "].map(waiterNameKey);
    expect(new Set(keys).size).toBe(1);
  });

  it("quita todas las tildes y la diéresis, pero no confunde nombres distintos", () => {
    expect(waiterNameKey("Ángela Pérez-Ñúñez")).toBe(waiterNameKey("angela perez-nunez"));
    expect(waiterNameKey("Ana María")).not.toBe(waiterNameKey("Ana Marta"));
  });

  it("los espacios internos repetidos no crean un nombre distinto", () => {
    expect(waiterNameKey("Juan   David")).toBe(waiterNameKey("juan david"));
  });
});

describe("validación de la foto del mesero", () => {
  const png = "data:image/png;base64,iVBORw0KGgo=";

  it("acepta imágenes embebidas (png, jpg, webp, gif) y enlaces https", () => {
    for (const url of [png, "data:image/jpeg;base64,/9j/AAAA", "data:image/webp;base64,UklGRg==", "data:image/gif;base64,R0lGOD==", "https://ejemplo.com/f.jpg"]) {
      expect(waiterPhotoProblem(url), url).toBeNull();
    }
  });

  it("rechaza vacío, javascript:, http plano, html embebido y svg", () => {
    for (const url of ["", "   ", "javascript:alert(1)", "http://ejemplo.com/f.jpg", "data:text/html;base64,PGgxPg==", "data:image/svg+xml;base64,PHN2Zz4="]) {
      expect(waiterPhotoProblem(url), url).not.toBeNull();
    }
  });

  it("rechaza fotos demasiado pesadas y acepta justo el límite", () => {
    const prefix = "data:image/png;base64,";
    const atLimit = prefix + "A".repeat(WAITER_PHOTO_MAX_CHARS - prefix.length);
    expect(waiterPhotoProblem(atLimit)).toBeNull();
    expect(waiterPhotoProblem(atLimit + "A")).toMatch(/demasiado pesada/);
  });

  it("una foto de 256 px comprimida cabe con mucho margen", () => {
    expect(WAITER_PHOTO_MAX_CHARS).toBeGreaterThanOrEqual(100_000);
  });
});