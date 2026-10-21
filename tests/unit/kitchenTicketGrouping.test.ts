import { describe, it, expect } from "vitest";
import { groupOrderItemsByStation } from "../../src/core/services/kitchenTicketGrouping";
import { collectKnownStations } from "../../src/presentation/components/inventory/InventoryWidgets";

const item = (productName: string, station?: string) => ({ productName, quantity: 1, station }) as any;

describe("groupOrderItemsByStation", () => {
  it("sin estación todo cae en un único ticket Cocina", () => {
    const g = groupOrderItemsByStation([item("Tamal"), item("Sopa")]);
    expect([...g.keys()]).toEqual(["Cocina"]);
  });

  it("agrupa 'Barra' y 'barra ' como la misma estación", () => {
    const g = groupOrderItemsByStation([item("Jugo", "Barra"), item("Café", "barra "), item("Tamal")]);
    expect([...g.keys()]).toEqual(["Barra", "Cocina"]);
    expect(g.get("Barra")).toHaveLength(2);
  });
});

describe("collectKnownStations", () => {
  it("une estaciones de categorías y productos sin duplicar por mayúsculas", () => {
    const r = collectKnownStations([{ printStation: "Barra" }, { printStation: "barra" }], [{ printStationOverride: "Parrilla" }]);
    expect(r).toEqual(["Barra", "Cocina", "Parrilla"]);
  });
});
