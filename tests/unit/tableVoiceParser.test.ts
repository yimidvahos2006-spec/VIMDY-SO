import { describe, it, expect } from "vitest";
import { parseTableCommand, parseVoiceCommand } from "../../src/core/voice/tableVoiceParser";
import { findTablesByNumber } from "../../src/core/voice/tableVoiceResolver";
import type { Table } from "../../src/core/entities/Entities";

const cmd = (text: string) => {
  const { tableNumber, peopleCount } = parseTableCommand(text);
  return { tableNumber, peopleCount };
};

describe("parseTableCommand", () => {
  it.each([
    ["Mesa 3, 4 personas", 3, 4],
    ["mesa 3 4 personas", 3, 4],
    ["Mesa tres, cuatro personas", 3, 4],
    ["mesa 3 para 4", 3, 4],
    ["mesa tres para cuatro", 3, 4],
    ["mesa 12 somos 6", 12, 6],
    ["mesa 5 con 2 comensales", 5, 2],
    ["mesa 8, 10 pax", 8, 10],
    ["Mesa veintiuno, treinta y cinco personas", 21, 35],
    ["mesa 3, una persona", 3, 1],
    ["MESA 7 — 3 PERSONAS", 7, 3],
    ["3 4", 3, 4],
    ["3, 4", 3, 4],
    ["mesa 7", 7, null],
    ["mesa siete", 7, null],
    ["4 personas mesa 3", 3, 4],
    ["mesa 3 para 3", 3, 3]
  ])("%s → mesa %s, %s personas", (text, mesa, personas) => {
    expect(cmd(text as string)).toEqual({ tableNumber: mesa, peopleCount: personas });
  });

  it("no inventa nada con ruido o frases sin números", () => {
    expect(cmd("")).toEqual({ tableNumber: null, peopleCount: null });
    expect(cmd("buenas tardes")).toEqual({ tableNumber: null, peopleCount: null });
  });

  it("descarta valores absurdos", () => {
    expect(cmd("mesa 4000 5 personas").tableNumber).toBeNull();
    expect(cmd("mesa 3 500 personas").peopleCount).toBeNull();
    expect(cmd("mesa 0").tableNumber).toBeNull();
  });
});

describe("parseTableCommand — filtro estricto (voz)", () => {
  const strict = (text: string) => {
    const { tableNumber, peopleCount } = parseTableCommand(text, { strict: true });
    return { tableNumber, peopleCount };
  };

  it.each([
    ["Mesa 3, 4 personas", 3, 4],
    ["mesa tres para cuatro", 3, 4],
    ["mesa 12 somos 6", 12, 6],
    ["Mesa veintiuno, treinta y cinco personas", 21, 35],
    ["mesa 7", 7, null],
    ["4 personas mesa 3", 3, 4],
    ["meza 3, 4 personas", 3, 4],
    ["mesa número 5 para 2", 5, 2]
  ])("%s → mesa %s, %s personas", (text, mesa, personas) => {
    expect(strict(text as string)).toEqual({ tableNumber: mesa, peopleCount: personas });
  });

  it.each([
    "3 4",
    "tengo 2 hijos",
    "son cinco mil quinientos pesos",
    "buenas tardes",
    "para 4 personas",
    "",
    "oye la mesa 5 está sucia desde hace rato y nadie la limpia por favor avisa"
  ])("ignora el ruido: “%s”", (text) => {
    expect(strict(text)).toEqual({ tableNumber: null, peopleCount: null });
  });

  it("el modo normal (texto escrito) sigue aceptando números sueltos", () => {
    expect(cmd("3 4")).toEqual({ tableNumber: 3, peopleCount: 4 });
  });
});

describe("findTablesByNumber", () => {
  const t = (id: string, name: string, zone?: string) =>
    ({ id, name, zone, capacity: 4, peopleCount: 0, status: "FREE", items: [] } as unknown as Table);

  const tables = [
    t("1", "Mesa 1"),
    t("2", "Mesa 1 · Terraza", "Terraza"),
    t("3", "Mesa 3"),
    t("4", "Mesa 12")
  ];

  it("encuentra una mesa única", () => {
    expect(findTablesByNumber(tables, 3).map(x => x.id)).toEqual(["3"]);
    expect(findTablesByNumber(tables, 12).map(x => x.id)).toEqual(["4"]);
  });

  it("devuelve todas las zonas cuando el número se repite", () => {
    expect(findTablesByNumber(tables, 1).map(x => x.id)).toEqual(["1", "2"]);
  });

  it("no confunde 1 con 12 ni encuentra mesas inexistentes", () => {
    expect(findTablesByNumber(tables, 2)).toEqual([]);
  });
});

describe("parseVoiceCommand — abrir / ocupar mesa", () => {
  const open = (text: string, strict = true) => {
    const c = parseVoiceCommand(text, { strict });
    return c.kind === "open" ? { mesa: c.tableNumber, personas: c.peopleCount } : c.kind;
  };

  it.each([
    ["Mesa 4, 3 personas", 4, 3],
    ["Mesa 4 con 3 comensales", 4, 3],
    ["Mesa 4 para 3", 4, 3],
    ["Llenar mesa 4 tres personas", 4, 3],
    ["Ocupar mesa cuatro, tres personas", 4, 3],
    ["mesa cinco para seis", 5, 6],
    ["meza 4 somos 3", 4, 3]
  ])("%s → mesa %s, %s personas", (text, mesa, personas) => {
    expect(open(text as string)).toEqual({ mesa, personas });
  });
});

describe("parseVoiceCommand — unir mesas", () => {
  const merge = (text: string, strict = true) => {
    const c = parseVoiceCommand(text, { strict });
    return c.kind === "merge" ? { mesas: c.tableNumbers, personas: c.peopleCount } : c.kind;
  };

  it.each([
    ["Unir mesa 5 y 4, 6 personas", [5, 4], 6],
    ["Mesa 5 y 4, 6 personas", [5, 4], 6],
    ["Juntar la 5 con la 4 seis personas", [5, 4], 6],
    ["Fusionar mesa 5 y 4", [5, 4], null],
    ["unir mesa cinco y cuatro seis personas", [5, 4], 6],
    ["Unir las mesas 2 y 3 para 8", [2, 3], 8],
    ["mesas 7 y 8", [7, 8], null],
    ["junta la mesa 1 con la 2", [1, 2], null]
  ])("%s", (text, mesas, personas) => {
    expect(merge(text as string)).toEqual({ mesas, personas });
  });

  it("también funciona con texto escrito (no estricto)", () => {
    expect(merge("unir 5 y 4", false)).toEqual({ mesas: [5, 4], personas: null });
  });

  it("no confunde 'con N comensales' ni 'mesa 3 y 4 personas' con unir", () => {
    expect(parseVoiceCommand("Mesa 4 con 3 comensales", { strict: true }).kind).toBe("open");
    const c = parseVoiceCommand("mesa 3 y 4 personas", { strict: true });
    expect(c.kind).toBe("open");
    if (c.kind === "open") expect(c).toMatchObject({ tableNumber: 3, peopleCount: 4 });
  });

  it("no une una mesa consigo misma ni con una sola mesa", () => {
    expect(parseVoiceCommand("unir mesa 5 y 5", { strict: true }).kind).toBe("none");
    expect(parseVoiceCommand("unir mesa 5", { strict: true }).kind).toBe("none");
  });

  it("ignora charla de fondo larga y ruido", () => {
    expect(parseVoiceCommand("oye nos pueden traer la cuenta que ya nos vamos y hay que juntar las mesas 5 y 4 por favor", { strict: true }).kind).toBe("none");
    expect(parseVoiceCommand("buenas tardes", { strict: true }).kind).toBe("none");
  });
});