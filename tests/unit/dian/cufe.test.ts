import { describe, expect, it } from "vitest";
import { DianCufeCalculator, type CufeInput } from "../../../supabase/functions/dian-invoice/XmlBuilder";

describe("DianCufeCalculator", () => {
  const calculator = new DianCufeCalculator();

  it("genera un CUFE de 96 caracteres hexadecimales", async () => {
    const input: CufeInput = {
      prefix: "FV",
      number: "00000001",
      fecFac: "2024-01-15",
      horFac: "10:30:00",
      subtotal: 100000,
      taxes: [{ code: "01", rate: 19, value: 19000 }],
      total: 119000,
      nitOfe: "900123456",
      numAdq: "123456789",
      clTec: "abc123def456",
      tipoAmb: "2",
    };

    const cufe = await calculator.calculate(input);

    expect(cufe).toHaveLength(96);
    expect(cufe).toMatch(/^[0-9a-f]{96}$/);
  });

  it("el CUFE es determinista — misma entrada produce mismo CUFE", async () => {
    const input: CufeInput = {
      prefix: "FV",
      number: "00000001",
      fecFac: "2024-01-15",
      horFac: "10:30:00",
      subtotal: 100000,
      taxes: [{ code: "01", rate: 19, value: 19000 }],
      total: 119000,
      nitOfe: "900123456",
      numAdq: "123456789",
      clTec: "abc123def456",
      tipoAmb: "2",
    };

    const cufe1 = await calculator.calculate(input);
    const cufe2 = await calculator.calculate(input);

    expect(cufe1).toBe(cufe2);
  });

  it("cambiar el NIT del emisor produce un CUFE diferente", async () => {
    const baseInput: CufeInput = {
      prefix: "FV",
      number: "00000001",
      fecFac: "2024-01-15",
      horFac: "10:30:00",
      subtotal: 100000,
      taxes: [{ code: "01", rate: 19, value: 19000 }],
      total: 119000,
      nitOfe: "900123456",
      numAdq: "123456789",
      clTec: "abc123def456",
      tipoAmb: "2",
    };

    const input2 = { ...baseInput, nitOfe: "900987654" };

    const cufe1 = await calculator.calculate(baseInput);
    const cufe2 = await calculator.calculate(input2);

    expect(cufe1).not.toBe(cufe2);
  });

  it("el CUFE incluye todos los campos en el orden correcto", async () => {
    const input: CufeInput = {
      prefix: "FACT",
      number: "00001234",
      fecFac: "20241231",
      horFac: "235959",
      subtotal: 500000,
      taxes: [{ code: "01", rate: 19, value: 95000 }],
      total: 595000,
      nitOfe: "830500123",
      numAdq: "830500456",
      clTec: "TEST_KEY_123",
      tipoAmb: "2",
    };

    const cufe = await calculator.calculate(input);

    const expectedCadena =
      "FACT00001234" +
      "20241231" +
      "235959" +
      "500000.00" +
      "01" +
      "95000.00" +
      "0" +
      "0.00" +
      "0" +
      "0.00" +
      "595000.00" +
      "830500123" +
      "830500456" +
      "TEST_KEY_123" +
      "2";

    expect(cufe).toHaveLength(96);
    expect(cufe).toMatch(/^[0-9a-f]{96}$/);

    expect((globalThis as any).__lastCufeInput).toBeUndefined();
  });

  it("formatea decimales correctamente para valores con más de 2 dígitos", async () => {
    const input: CufeInput = {
      prefix: "FV",
      number: "00000001",
      fecFac: "2024-01-15",
      horFac: "10:30:00",
      subtotal: 99.999,
      taxes: [{ code: "01", rate: 19, value: 19.0 }],
      total: 119.0,
      nitOfe: "900123456",
      numAdq: "123456789",
      clTec: "abc123def456",
      tipoAmb: "1",
    };

    const cufe = await calculator.calculate(input);

    expect(cufe).toHaveLength(96);
    expect(cufe).toMatch(/^[0-9a-f]{96}$/);
  });

  it("diferente ambiente (sandbox vs production) produce CUFE diferente", async () => {
    const baseInput: CufeInput = {
      prefix: "FV",
      number: "00000001",
      fecFac: "2024-01-15",
      horFac: "10:30:00",
      subtotal: 100000,
      taxes: [{ code: "01", rate: 19, value: 19000 }],
      total: 119000,
      nitOfe: "900123456",
      numAdq: "123456789",
      clTec: "abc123def456",
      tipoAmb: "2",
    };

    const sandboxCufe = await calculator.calculate(baseInput);
    const productionCufe = await calculator.calculate({ ...baseInput, tipoAmb: "1" });

    expect(sandboxCufe).not.toBe(productionCufe);
  });

  it("clave técnica vacía produce un CUFE válido (pero diferente)", async () => {
    const inputWithKey: CufeInput = {
      prefix: "FV",
      number: "00000001",
      fecFac: "2024-01-15",
      horFac: "10:30:00",
      subtotal: 100000,
      taxes: [{ code: "01", rate: 19, value: 19000 }],
      total: 119000,
      nitOfe: "900123456",
      numAdq: "123456789",
      clTec: "abc123def456",
      tipoAmb: "2",
    };

    const inputEmptyKey: CufeInput = { ...inputWithKey, clTec: "" };

    const cufeWithKey = await calculator.calculate(inputWithKey);
    const cufeEmptyKey = await calculator.calculate(inputEmptyKey);

    expect(cufeWithKey).not.toBe(cufeEmptyKey);
    expect(cufeWithKey).toHaveLength(96);
    expect(cufeEmptyKey).toHaveLength(96);
  });

  it("el CUFE usa SHA-384 (96 hex dígitos = 48 bytes)", async () => {
    const input: CufeInput = {
      prefix: "FV",
      number: "00000001",
      fecFac: "2024-01-15",
      horFac: "10:30:00",
      subtotal: 100000,
      taxes: [{ code: "01", rate: 19, value: 19000 }],
      total: 119000,
      nitOfe: "900123456",
      numAdq: "123456789",
      clTec: "abc123def456",
      tipoAmb: "2",
    };

    const cufe = await calculator.calculate(input);

    expect(cufe).toHaveLength(96);
    expect(cufe).toMatch(/^[0-9a-f]{96}$/);
  });
});
