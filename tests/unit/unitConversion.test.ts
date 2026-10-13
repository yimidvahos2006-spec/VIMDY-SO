import { describe, expect, it } from "vitest";
import { compatibleUnits, convertQuantity, normalizeUnit } from "../../src/core/utils/unitConversion";

describe("unitConversion", () => {
  it("120 g de harina guardada en kg son 0,12 kg", () => {
    expect(convertQuantity(120, "g", "kg")).toBe(0.12);
  });

  it("convierte kg, libra, litro y ml", () => {
    expect(convertQuantity(2, "kg", "g")).toBe(2000);
    expect(convertQuantity(1, "libra", "g")).toBe(500);
    expect(convertQuantity(250, "ml", "litro")).toBe(0.25);
    expect(convertQuantity(1.5, "litro", "ml")).toBe(1500);
  });

  it("misma unidad no cambia la cantidad", () => {
    expect(convertQuantity(3, "unidad", "unidad")).toBe(3);
    expect(convertQuantity(3, "kg", "kg")).toBe(3);
  });

  it("nunca mezcla masa con volumen ni unidades con peso", () => {
    expect(convertQuantity(100, "g", "ml")).toBeNull();
    expect(convertQuantity(1, "litro", "kg")).toBeNull();
    expect(convertQuantity(1, "unidad", "g")).toBeNull();
    expect(convertQuantity(1, "paquete", "caja")).toBeNull();
  });

  it("rechaza cantidades inválidas", () => {
    expect(convertQuantity(Number.NaN, "g", "kg")).toBeNull();
  });

  it("entiende nombres alternos", () => {
    expect(normalizeUnit("Kilos")).toBe("kg");
    expect(normalizeUnit("Lts")).toBe("litro");
    expect(normalizeUnit("")).toBe("unidad");
  });

  it("ofrece solo unidades compatibles", () => {
    expect(compatibleUnits("kg")).toEqual(["g", "kg", "libra"]);
    expect(compatibleUnits("litro")).toEqual(["ml", "litro"]);
    expect(compatibleUnits("unidad")).toEqual(["unidad"]);
    expect(compatibleUnits("paquete")).toEqual(["paquete"]);
  });

  it("ejemplo real: bulto de 25 kg a $90.000 y receta de 120 g cuesta $432", () => {
    const precioPorKg = 90000 / 25; // 3.600
    const kg = convertQuantity(120, "g", "kg") as number;
    expect(Math.round(precioPorKg * kg)).toBe(432);
  });
});