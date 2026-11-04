import { describe, expect, it } from "vitest";

import { classifyKitchenNote, splitOrigin } from "../../src/core/services/kitchenCardContent";

describe("splitOrigin", () => {
  it("separa la mesa en etiqueta y número", () => {
    expect(splitOrigin("Mesa 5", "Pedido")).toEqual({ label: "MESA", value: "5" });
    expect(splitOrigin("mesa Terraza 2", "Pedido")).toEqual({ label: "MESA", value: "Terraza 2" });
  });

  it("deja otros orígenes completos y sin etiqueta", () => {
    expect(splitOrigin("Mostrador", "Pedido")).toEqual({ value: "Mostrador" });
  });

  it("usa el texto de respaldo si no hay origen", () => {
    expect(splitOrigin(undefined, "Pedido")).toEqual({ value: "Pedido" });
    expect(splitOrigin("  ", "Pedido")).toEqual({ value: "Pedido" });
  });

  it("no confunde un origen que solo empieza parecido a 'mesa'", () => {
    expect(splitOrigin("Mesanine", "Pedido")).toEqual({ value: "Mesanine" });
  });
});

describe("classifyKitchenNote", () => {
  it("detecta alergias aunque tengan tildes o mayúsculas", () => {
    expect(classifyKitchenNote("ALÉRGICO al maní")).toBe("allergy");
    expect(classifyKitchenNote("alergia a mariscos")).toBe("allergy");
    expect(classifyKitchenNote("cliente celíaco")).toBe("allergy");
  });

  it("detecta restricciones tipo 'sin ...'", () => {
    expect(classifyKitchenNote("sin cebolla")).toBe("restriction");
    expect(classifyKitchenNote("Hamburguesa SIN tomate")).toBe("restriction");
  });

  it("la alergia gana sobre la restricción", () => {
    expect(classifyKitchenNote("sin maní, alergia severa")).toBe("allergy");
  });

  it("deja el resto como info", () => {
    expect(classifyKitchenNote("para llevar")).toBe("info");
    expect(classifyKitchenNote("bien cocido")).toBe("info");
  });
});