// tests/unit/customerQuickCreateDraft.test.ts
/* Crear cliente desde el buscador de Caja: qué va en Nombre y qué en Teléfono. */

import { describe, it, expect } from "vitest";

import { splitNameAndPhone } from "../../src/core/domain/customers/search";

describe("splitNameAndPhone", () => {
  it("solo números incompletos van al teléfono, no al nombre (caso real: «313»)", () => {
    expect(splitNameAndPhone("313")).toEqual({ name: "", phone: "313" });
  });

  it("número completo con espacios o guiones va al teléfono", () => {
    expect(splitNameAndPhone("300 123 4567")).toEqual({ name: "", phone: "300 123 4567" });
    expect(splitNameAndPhone("+57 300-123-4567")).toEqual({ name: "", phone: "+57 300-123-4567" });
  });

  it("nombre y teléfono juntos se separan", () => {
    expect(splitNameAndPhone("Ana 300 123 4567")).toEqual({ name: "Ana", phone: "300 123 4567" });
  });

  it("solo nombre queda como nombre", () => {
    expect(splitNameAndPhone("Ana Pérez")).toEqual({ name: "Ana Pérez", phone: "" });
  });

  it("nombre con pocos dígitos sigue siendo nombre", () => {
    expect(splitNameAndPhone("Mesa 12")).toEqual({ name: "Mesa 12", phone: "" });
  });

  it("vacío o solo espacios no inventa nada", () => {
    expect(splitNameAndPhone("")).toEqual({ name: "", phone: "" });
    expect(splitNameAndPhone("   ")).toEqual({ name: "", phone: "" });
  });

  it("solo signos sin dígitos no se toma como teléfono", () => {
    expect(splitNameAndPhone("+-")).toEqual({ name: "+-", phone: "" });
  });
});