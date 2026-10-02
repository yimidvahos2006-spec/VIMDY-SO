import { describe, expect, it } from "vitest";
import {
  BUSINESS_TYPES,
  isBusinessTypeId,
  isStoredBusinessTypeId
} from "../../src/core/config/businessTypes";

describe("F&B onboarding business types", () => {
  it("offers only the approved food-and-beverage categories", () => {
    expect(BUSINESS_TYPES.map(({ id }) => id)).toEqual([
      "restaurante",
      "comida_rapida",
      "cafeteria",
      "pizzeria",
      "asadero",
      "bar",
      "panaderia",
      "pasteleria",
      "reposteria",
      "heladeria",
      "food_truck",
      "negocio_bebidas",
      "jugueria",
      "catering",
      "comedor",
      "cadena"
    ]);
    expect(BUSINESS_TYPES.some(({ id }) =>
      ["tienda", "hotel", "minimercado", "pequeno_supermercado", "negocio_productos", "negocio_servicios", "otro"].includes(id)
    )).toBe(false);
  });

  it("keeps legacy persisted labels readable without allowing them for new onboarding", () => {
    expect(isBusinessTypeId("hotel")).toBe(false);
    expect(isBusinessTypeId("tienda")).toBe(false);
    expect(isStoredBusinessTypeId("hotel")).toBe(true);
    expect(isStoredBusinessTypeId("restaurante")).toBe(true);
  });
});
