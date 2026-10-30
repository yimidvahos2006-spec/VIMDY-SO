import { describe, expect, it } from "vitest";
import {
  CSV_BOM,
  buildCsv,
  csvMoney,
  csvNumber,
  csvToBlob,
  formatCsvNumber,
  sanitizeCsvText,
  serializeCsvCell,
  withCsvBom
} from "../../src/core/utils/csv";

describe("csv — anti-inyección de fórmulas", () => {
  it.each([
    ["=1+1", "'=1+1"],
    ["+57 300 123 4567", "'+57 300 123 4567"],
    ["-2+3", "'-2+3"],
    ["@SUM(A1:A9)", "'@SUM(A1:A9)"],
    ["\t=1+1", "'\t=1+1"],
    ["\r=1+1", "'\n=1+1"],
    ["  =1+1", "'  =1+1"],
    [" =1+1", "' =1+1"],
    ["​=1+1", "'​=1+1"],
    ["＝1+1", "'＝1+1"],
    ["=cmd|' /C calc'!A0", "'=cmd|' /C calc'!A0"],
    ['=HYPERLINK("http://evil","x")', `'=HYPERLINK("http://evil","x")`]
  ])("neutraliza %j", (input, expected) => {
    expect(sanitizeCsvText(input)).toBe(expected);
  });

  it.each(["Hamburguesa", "Café con leche", "Mesa 5 = VIP", "a=b", "100%", "", "Total - IVA"])(
    "no toca texto normal %j",
    (input) => {
      expect(sanitizeCsvText(input)).toBe(input);
    }
  );

  it("quita caracteres de control y normaliza saltos de línea", () => {
    expect(sanitizeCsvText("a\u0000b\u0007c\r\nd\re")).toBe("abc\nd\ne");
  });

  it("un string numérico es TEXTO: '-5000' se protege (los montos van como number)", () => {
    expect(serializeCsvCell("-5000")).toBe(`"'-5000"`);
    expect(serializeCsvCell(-5000)).toBe("-5000");
  });

  it("en el CSV final ninguna celda de texto empieza con un disparador", () => {
    const csv = buildCsv([["=1+1", "+1", "-1", "@x"]], { sepHint: false });
    expect(csv).toBe(`"'=1+1";"'+1";"'-1";"'@x"`);
  });

  it("escapa comillas, separadores y saltos de línea dentro del texto", () => {
    expect(serializeCsvCell('Dijo "hola"; adiós\nfin')).toBe(`"Dijo ""hola""; adiós\nfin"`);
  });
});

describe("csv — números y moneda", () => {
  it("COP (0 decimales): entero sin separador de miles", () => {
    expect(serializeCsvCell(csvMoney(1234567, 0))).toBe("1234567");
    expect(serializeCsvCell(csvMoney(1234567.6, 0))).toBe("1234568");
    expect(serializeCsvCell(csvMoney(-35000, 0))).toBe("-35000");
  });

  it("moneda con 2 decimales: coma decimal y decimales fijos", () => {
    expect(formatCsvNumber(1250.5, 2)).toBe("1250,50");
    expect(formatCsvNumber(1250, 2)).toBe("1250,00");
    expect(formatCsvNumber(1250.5, 2, ".")).toBe("1250.50");
  });

  it("redondea sin el error de coma flotante", () => {
    expect(formatCsvNumber(1.005, 2)).toBe("1,01");
    expect(formatCsvNumber(2.675, 2)).toBe("2,68");
    expect(formatCsvNumber(-1.005, 2)).toBe("-1,01");
    expect(formatCsvNumber(0.1 + 0.2, 2)).toBe("0,30");
  });

  it("-0 y valores que redondean a cero no llevan signo", () => {
    expect(formatCsvNumber(-0, 0)).toBe("0");
    expect(formatCsvNumber(-0.004, 2)).toBe("0,00");
    expect(formatCsvNumber(-0.4, 0)).toBe("0");
  });

  it("number suelto: enteros tal cual, decimales sin ceros sobrantes", () => {
    expect(serializeCsvCell(42)).toBe("42");
    expect(serializeCsvCell(0.5)).toBe("0,5");
    expect(serializeCsvCell(12.3456789)).toBe("12,345679");
    expect(serializeCsvCell(csvNumber(12.5, 1))).toBe("12,5");
  });

  it("NaN e Infinity -> celda vacía, nunca 'NaN'", () => {
    expect(serializeCsvCell(NaN)).toBe("");
    expect(serializeCsvCell(Infinity)).toBe("");
    expect(serializeCsvCell(csvMoney(NaN, 0))).toBe("");
  });

  it("montos muy chicos o grandes no salen en notación científica", () => {
    expect(formatCsvNumber(0.0000001, 2)).toBe("0,00");
    expect(formatCsvNumber(123456789012, 0)).toBe("123456789012");
  });
});

describe("csv — documento", () => {
  it("separador ';', saltos CRLF, 'sep=;' y celdas vacías", () => {
    const csv = buildCsv([
      ["Producto", "Unidades", "Vendido"],
      [],
      ["Café", 3, csvMoney(9000, 0)],
      ["Nota", null, undefined, true]
    ]);
    expect(csv).toBe(
      ["sep=;", `"Producto";"Unidades";"Vendido"`, "", `"Café";3;9000`, `"Nota";;;"Sí"`].join("\r\n")
    );
  });

  it("sepHint:false omite la línea 'sep=;'", () => {
    expect(buildCsv([["a"]], { sepHint: false })).toBe(`"a"`);
  });

  it("buildCsv no agrega BOM; withCsvBom lo agrega una sola vez", () => {
    const csv = buildCsv([["a"]]);
    expect(csv.startsWith(CSV_BOM)).toBe(false);
    expect(withCsvBom(csv).startsWith(CSV_BOM)).toBe(true);
    expect(withCsvBom(withCsvBom(csv))).toBe(withCsvBom(csv));
  });

  it("el Blob lleva BOM UTF-8 al inicio (bytes EF BB BF) y tildes intactas", async () => {
    const blob = csvToBlob(buildCsv([["Piña colada"]]));
    const bytes = new Uint8Array(await blob.arrayBuffer());
    expect([...bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    expect(new TextDecoder().decode(bytes.slice(3))).toContain("Piña colada");
    expect(blob.type).toContain("text/csv");
  });
});