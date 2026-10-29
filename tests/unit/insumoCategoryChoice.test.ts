// tests/unit/insumoCategoryChoice.test.ts
/* ===========================================================================
   PRUEBAS — Categoría de un insumo NUEVO (modal de insumos y receta)
   ---------------------------------------------------------------------------
   Sin React ni red: se prueba qué categoría se elige y cuándo se crea una.
=========================================================================== */

import { describe, expect, it } from "vitest";

import type { Category } from "../../src/core/entities/Entities";
import {
  autoCategoryValue,
  buildCategoryPickerOptions,
  describeCategoryTarget,
  resolveInsumoCategory
} from "../../src/core/utils/insumoCategoryChoice";

const cat = (id: string, name: string): Category =>
  ({ id, name, active: true, createdAt: new Date(), requiresKitchenByDefault: false, kind: "INSUMO" }) as Category;

/** createCategory de mentira: guarda lo que le piden y puede rechazar nombres. */
function fakeCreator(rejected: string[] = []) {
  const calls: string[] = [];
  return {
    calls,
    create: async (name: string) => {
      calls.push(name);
      return rejected.includes(name) ? null : cat(`new-${calls.length}`, name);
    }
  };
}

describe("resolveInsumoCategory", () => {
  it("reutiliza la categoría que ya existe sin crear nada", async () => {
    const carnes = cat("c1", "Carnes");
    const creator = fakeCreator();
    const r = await resolveInsumoCategory({ name: "Carne molida", manualChoice: null, categories: [carnes], createCategory: creator.create });
    expect(r).toEqual({ ok: true, categoryId: "c1" });
    expect(creator.calls).toEqual([]);
  });

  it("crea la sugerida cuando el negocio no la tiene", async () => {
    const creator = fakeCreator();
    const r = await resolveInsumoCategory({ name: "Plátano", manualChoice: null, categories: [cat("c1", "Carnes")], createCategory: creator.create });
    expect(r.ok && r.created?.name).toBe("Verduras");
    expect(creator.calls).toEqual(["Verduras"]);
  });

  it("respeta lo que el dueño eligió a mano, aunque el nombre sugiera otra", async () => {
    const lacteos = cat("c2", "Lácteos");
    const creator = fakeCreator();
    const r = await resolveInsumoCategory({
      name: "Carne molida",
      manualChoice: "c2",
      categories: [cat("c1", "Carnes"), lacteos],
      createCategory: creator.create
    });
    expect(r).toEqual({ ok: true, categoryId: "c2" });
    expect(creator.calls).toEqual([]);
  });

  it("si eligió una sugerida que no existe, la crea", async () => {
    const creator = fakeCreator();
    const r = await resolveInsumoCategory({ name: "Algo raro", manualChoice: "new:Despensa", categories: [], createCategory: creator.create });
    expect(r.ok && r.created?.name).toBe("Despensa");
  });

  it("sin pista clara usa 'Otros' (existente o nueva), no la primera de la lista", async () => {
    const otros = cat("c9", "Otros");
    const withOtros = await resolveInsumoCategory({
      name: "Producto raro XYZ",
      manualChoice: null,
      categories: [cat("c1", "Aseo"), otros],
      createCategory: fakeCreator().create
    });
    expect(withOtros).toEqual({ ok: true, categoryId: "c9" });

    const creator = fakeCreator();
    const without = await resolveInsumoCategory({ name: "Producto raro XYZ", manualChoice: null, categories: [cat("c1", "Aseo")], createCategory: creator.create });
    expect(without.ok && without.created?.name).toBe("Otros");
  });

  it("si el nombre ya lo usa una categoría de productos, crea 'X (insumos)'", async () => {
    const creator = fakeCreator(["Bebidas"]);
    const r = await resolveInsumoCategory({ name: "Gaseosa", manualChoice: null, categories: [], createCategory: creator.create });
    expect(r.ok && r.created?.name).toBe("Bebidas (insumos)");
    expect(creator.calls).toEqual(["Bebidas", "Bebidas (insumos)"]);
  });

  it("avisa con un mensaje claro si no pudo crear ninguna", async () => {
    const creator = fakeCreator(["Carnes", "Carnes (insumos)"]);
    const r = await resolveInsumoCategory({ name: "Pollo", manualChoice: null, categories: [], createCategory: creator.create });
    expect(r.ok).toBe(false);
    expect(!r.ok && r.reason).toContain("Carnes");
  });
});

describe("selector de categoría", () => {
  const existing = [cat("c1", "Carne"), cat("c2", "Verduras")];

  it("autoCategoryValue apunta a la existente o a 'new:'", () => {
    expect(autoCategoryValue("Carne de res", existing)).toBe("c1");
    expect(autoCategoryValue("Leche", existing)).toBe("new:Lácteos");
    expect(autoCategoryValue("Producto raro XYZ", existing)).toBe("new:Otros");
  });

  it("las opciones traen las existentes y solo las sugeridas que faltan", () => {
    const labels = buildCategoryPickerOptions(existing).map((o) => o.label);
    expect(labels).toContain("Carne");
    expect(labels).not.toContain("Carnes (nueva)");
    expect(labels).toContain("Lácteos (nueva)");
  });

  it("describeCategoryTarget muestra el nombre que se va a usar", () => {
    expect(describeCategoryTarget("Leche", null, existing)).toBe("Lácteos");
    expect(describeCategoryTarget("Leche", "c2", existing)).toBe("Verduras");
    expect(describeCategoryTarget("Leche", "new:Despensa", existing)).toBe("Despensa");
  });
});