import { describe, expect, it } from "vitest";
import { compareTables, sortTables, tableDisplayName, tableNumber } from "../../src/core/services/tableOrdering";

const t = (name: string, zone?: string) => ({ name, zone });
const names = (list: { name: string }[]) => list.map((x) => x.name);

describe("orden natural de mesas", () => {
  it("ordena 1,4,2,4,3 como 1,2,3,4", () => {
    const sorted = sortTables([t("Mesa 4"), t("Mesa 1"), t("Mesa 3"), t("Mesa 2")]);
    expect(names(sorted)).toEqual(["Mesa 1", "Mesa 2", "Mesa 3", "Mesa 4"]);
  });

  it("10 va después de 9 (no después de 1)", () => {
    const sorted = sortTables([t("Mesa 10"), t("Mesa 2"), t("Mesa 1"), t("Mesa 11"), t("Mesa 9")]);
    expect(names(sorted)).toEqual(["Mesa 1", "Mesa 2", "Mesa 9", "Mesa 10", "Mesa 11"]);
  });

  it("ignora el sufijo ' · Zona' al ordenar y al mostrar", () => {
    const sorted = sortTables([t("Mesa 3 · Terraza", "Terraza"), t("Mesa 1 · Terraza", "Terraza"), t("Mesa 2", "Terraza")]);
    expect(names(sorted)).toEqual(["Mesa 1 · Terraza", "Mesa 2", "Mesa 3 · Terraza"]);
    expect(tableDisplayName(t("Mesa 1 · Terraza", "Terraza"))).toBe("Mesa 1");
    expect(tableNumber(t("Mesa 12 · Bar", "Bar"))).toBe(12);
  });

  it("sin número: al final y en orden alfabético", () => {
    const sorted = sortTables([t("Barra"), t("Mesa 2"), t("Alta"), t("Mesa 1")]);
    expect(names(sorted)).toEqual(["Mesa 1", "Mesa 2", "Alta", "Barra"]);
  });

  it("mismo número: desempata alfabéticamente", () => {
    expect(compareTables(t("Barra 1"), t("Mesa 1"))).toBeLessThan(0);
  });

  it("no modifica el arreglo original", () => {
    const original = [t("Mesa 2"), t("Mesa 1")];
    sortTables(original);
    expect(names(original)).toEqual(["Mesa 2", "Mesa 1"]);
  });
});