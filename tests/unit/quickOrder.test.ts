// tests/unit/quickOrder.test.ts
/* ===========================================================================
   Toma de pedido ágil desde la mesa (vista táctil).

   1. Precio de línea = base + tamaño + extras (nunca negativo).
   2. Nota de cocina: arma y vuelve a separar [tamaño/extras] · [rápidas] · [libre].
   3. Las notas rápidas se resaltan como "restricción" en la tarjeta de cocina.
   4. Contra el TableEngine REAL: las líneas con tamaño/extras se agregan con
      su precio final, no se mezclan con la versión simple, y "+/−", quitar y
      editar nota actúan SOLO sobre su línea cuando se manda la referencia
      completa (producto + nota + tamaño + extras).
   =========================================================================== */

import { describe, it, expect } from "vitest";
import type { Product, Table } from "../../src/core/entities/Entities";
import { TableEngine } from "../../src/core/engines/TableEngine";
import { classifyKitchenNote } from "../../src/core/services/kitchenCardContent";
import { InMemoryRepository } from "../fakes/InMemoryRepository";
import {
  NOTE_SEPARATOR,
  QUICK_NOTE_PRESETS,
  buildLineNote,
  buildVariantLabel,
  computeUnitPrice,
  lineDisplayKey,
  lineRefFromItem,
  needsOptions,
  parseLineNote,
  resolveLineVariant
} from "../../src/presentation/components/waiter/quickOrder/quickOrderLogic";

const SIZE_GRANDE = { id: "grande", name: "Grande", priceDelta: 3000 };
const SIZE_PEQUENA = { id: "pequena", name: "Pequeña", priceDelta: -2000 };
const EXTRA_QUESO = { id: "queso", name: "Queso", priceDelta: 2000 };
const EXTRA_TOCINETA = { id: "tocineta", name: "Tocineta", priceDelta: 2500 };

const BURGER = {
  id: "burger",
  name: "Hamburguesa",
  price: 18000,
  requiresKitchen: true,
  sizes: [SIZE_PEQUENA, SIZE_GRANDE],
  extras: [EXTRA_QUESO, EXTRA_TOCINETA]
} as unknown as Product;

describe("computeUnitPrice", () => {
  it("suma tamaño y extras al precio base", () => {
    expect(computeUnitPrice(18000, SIZE_GRANDE, [EXTRA_QUESO, EXTRA_TOCINETA])).toBe(25500);
  });

  it("sin variante es el precio base", () => {
    expect(computeUnitPrice(18000, null, [])).toBe(18000);
    expect(computeUnitPrice(18000, undefined)).toBe(18000);
  });

  it("un tamaño que resta baja el precio, pero nunca por debajo de cero", () => {
    expect(computeUnitPrice(18000, SIZE_PEQUENA, [])).toBe(16000);
    expect(computeUnitPrice(1000, { priceDelta: -5000 }, [])).toBe(0);
  });
});

describe("buildVariantLabel", () => {
  it("usa el mismo formato que la Caja", () => {
    expect(buildVariantLabel(SIZE_GRANDE, [EXTRA_QUESO, EXTRA_TOCINETA])).toBe("Grande + Queso, Tocineta");
    expect(buildVariantLabel(SIZE_GRANDE, [])).toBe("Grande");
    expect(buildVariantLabel(null, [EXTRA_QUESO])).toBe("+ Queso");
    expect(buildVariantLabel(null, [])).toBe("");
  });
});

describe("buildLineNote / parseLineNote", () => {
  it("une tamaño/extras, notas rápidas y texto libre en ese orden", () => {
    const note = buildLineNote({
      variantLabel: "Grande + Queso",
      quickNotes: ["SIN CEBOLLA", "SIN PICANTE"],
      freeText: "poca sal"
    });
    expect(note).toBe(["Grande + Queso", "SIN CEBOLLA", "SIN PICANTE", "poca sal"].join(NOTE_SEPARATOR));
  });

  it("sin nada que decir no hay nota (queda undefined)", () => {
    expect(buildLineNote({})).toBeUndefined();
    expect(buildLineNote({ variantLabel: "  ", quickNotes: [], freeText: "   " })).toBeUndefined();
  });

  it("no repite partes iguales (sin importar mayúsculas) y limpia espacios", () => {
    const note = buildLineNote({ quickNotes: ["SIN CEBOLLA"], freeText: "  sin   cebolla " });
    expect(note).toBe("SIN CEBOLLA");
  });

  it("ida y vuelta: lo que se arma se puede volver a separar", () => {
    const label = "Grande + Queso";
    const note = buildLineNote({ variantLabel: label, quickNotes: ["SIN HIELO"], freeText: "con limón" });
    expect(parseLineNote(note, label)).toEqual({ quickNotes: ["SIN HIELO"], freeText: "con limón" });
  });

  it("una nota vieja escrita a mano queda como texto libre", () => {
    expect(parseLineNote("sin arroz", "")).toEqual({ quickNotes: [], freeText: "sin arroz" });
    expect(parseLineNote(undefined, "Grande")).toEqual({ quickNotes: [], freeText: "" });
  });

  it("una nota escrita a mano igual a un botón se reconoce como ese botón", () => {
    expect(parseLineNote("sin cebolla", "")).toEqual({ quickNotes: ["SIN CEBOLLA"], freeText: "" });
  });
});

describe("notas rápidas en la tarjeta de cocina", () => {
  it("todas las que empiezan por SIN salen resaltadas como restricción", () => {
    QUICK_NOTE_PRESETS.filter((note) => note.startsWith("SIN ")).forEach((note) => {
      expect(classifyKitchenNote(note)).toBe("restriction");
    });
  });

  it("una nota con tamaño y 'SIN CEBOLLA' también se resalta", () => {
    expect(classifyKitchenNote("Grande + Queso · SIN CEBOLLA")).toBe("restriction");
  });

  it("'PARA LLEVAR' es información, no restricción", () => {
    expect(classifyKitchenNote("PARA LLEVAR")).toBe("info");
  });
});

describe("needsOptions / resolveLineVariant", () => {
  it("solo pide hoja de opciones si hay tamaños o extras", () => {
    expect(needsOptions(BURGER)).toBe(true);
    expect(needsOptions({ sizes: [], extras: [] })).toBe(false);
    expect(needsOptions({})).toBe(false);
    expect(needsOptions({ extras: [EXTRA_QUESO] })).toBe(true);
  });

  it("recupera tamaño, extras y texto de una línea guardada por sus ids", () => {
    const resolved = resolveLineVariant(BURGER, {
      selectedSizeId: "grande",
      selectedExtraIds: ["tocineta", "queso"]
    });
    expect(resolved.size?.id).toBe("grande");
    expect(resolved.extras.map((extra) => extra.id).sort()).toEqual(["queso", "tocineta"]);
    expect(resolved.label).toBe("Grande + Queso, Tocineta");
  });

  it("si el producto ya no tiene esa opción, no inventa nada", () => {
    const resolved = resolveLineVariant(undefined, { selectedSizeId: "grande", selectedExtraIds: ["queso"] });
    expect(resolved).toEqual({ size: null, extras: [], label: "" });
  });
});

/* ---------------------------------------------------------------------------
   Contra el TableEngine real
--------------------------------------------------------------------------- */
describe("pedido de mesa con tamaño/extras (TableEngine real)", () => {
  async function engineWithOpenTable() {
    const repo = new InMemoryRepository<Table>("tables");
    const table: Table = {
      id: "t1",
      name: "Mesa 1",
      capacity: 4,
      peopleCount: 2,
      status: "BUSY",
      items: [],
      subtotal: 0,
      tax: 0,
      discount: 0,
      total: 0,
      updatedAt: new Date()
    };
    await repo.save(table);
    return { engine: new TableEngine(repo as any), repo };
  }

  /** Igual que la vista: precio final y nota ya armados antes de llamar al motor. */
  async function addVariant(
    engine: TableEngine,
    opts: { size?: typeof SIZE_GRANDE; extras?: (typeof EXTRA_QUESO)[]; quantity?: number; quickNotes?: string[]; freeText?: string }
  ) {
    const extras = opts.extras ?? [];
    const size = opts.size ?? null;
    await engine.addItem({
      tableId: "t1",
      product: { ...BURGER, price: computeUnitPrice(BURGER.price, size, extras) },
      quantity: opts.quantity ?? 1,
      note: buildLineNote({
        variantLabel: buildVariantLabel(size, extras),
        quickNotes: opts.quickNotes,
        freeText: opts.freeText
      }),
      selectedSizeId: size?.id ?? null,
      selectedExtraIds: extras.map((extra) => extra.id)
    });
  }

  it("la línea con extras lleva el precio final, su nota, y no se mezcla con la simple", async () => {
    const { engine, repo } = await engineWithOpenTable();

    await addVariant(engine, {});
    await addVariant(engine, { size: SIZE_GRANDE, extras: [EXTRA_QUESO, EXTRA_TOCINETA], quickNotes: ["SIN CEBOLLA"] });

    const table = (await repo.findById("t1"))!;
    expect(table.items).toHaveLength(2);

    const plain = table.items.find((item) => !item.selectedSizeId)!;
    const loaded = table.items.find((item) => item.selectedSizeId === "grande")!;

    expect(plain.price).toBe(18000);
    expect(loaded.price).toBe(25500);
    expect(loaded.note).toBe("Grande + Queso, Tocineta · SIN CEBOLLA");
    expect(loaded.selectedExtraIds).toEqual(["queso", "tocineta"]);
    expect(loaded.requiresKitchen).toBe(true);
    expect(table.subtotal).toBe(18000 + 25500);
  });

  it("tocar dos veces la misma variante suma a la misma línea", async () => {
    const { engine, repo } = await engineWithOpenTable();

    await addVariant(engine, { size: SIZE_GRANDE, extras: [EXTRA_QUESO], quickNotes: ["SIN PICANTE"] });
    await addVariant(engine, { size: SIZE_GRANDE, extras: [EXTRA_QUESO], quickNotes: ["SIN PICANTE"] });

    const table = (await repo.findById("t1"))!;
    expect(table.items).toHaveLength(1);
    expect(table.items[0].quantity).toBe(2);
    expect(table.subtotal).toBe(2 * 23000);
  });

  it("'+/−' con la referencia completa cambia SOLO su línea", async () => {
    const { engine, repo } = await engineWithOpenTable();
    await addVariant(engine, {});
    await addVariant(engine, { size: SIZE_GRANDE, extras: [EXTRA_QUESO] });

    const before = (await repo.findById("t1"))!;
    const loaded = before.items.find((item) => item.selectedSizeId === "grande")!;

    await engine.updateItemQuantity("t1", loaded.productId, loaded.quantity + 2, lineRefFromItem(loaded));

    const after = (await repo.findById("t1"))!;
    expect(after.items.find((item) => item.selectedSizeId === "grande")!.quantity).toBe(3);
    expect(after.items.find((item) => !item.selectedSizeId)!.quantity).toBe(1);
  });

  it("sin tamaño/extras en la referencia el motor NO encuentra la línea (por eso el panel completo ahora los manda)", async () => {
    const { engine, repo } = await engineWithOpenTable();
    await addVariant(engine, { size: SIZE_GRANDE, extras: [EXTRA_QUESO] });

    const loaded = (await repo.findById("t1"))!.items[0];
    await engine.updateItemQuantity("t1", loaded.productId, 5, { note: loaded.note });

    expect((await repo.findById("t1"))!.items[0].quantity).toBe(1);
  });

  it("bajar a cero o quitar con la referencia completa borra solo esa línea", async () => {
    const { engine, repo } = await engineWithOpenTable();
    await addVariant(engine, {});
    await addVariant(engine, { size: SIZE_GRANDE, extras: [EXTRA_QUESO] });

    const loaded = (await repo.findById("t1"))!.items.find((item) => item.selectedSizeId === "grande")!;
    await engine.removeItem("t1", loaded.productId, lineRefFromItem(loaded));

    const after = (await repo.findById("t1"))!;
    expect(after.items).toHaveLength(1);
    expect(after.items[0].selectedSizeId).toBeUndefined();
    expect(after.subtotal).toBe(18000);
  });

  it("editar la nota conserva tamaño, extras y precio, y solo toca esa línea", async () => {
    const { engine, repo } = await engineWithOpenTable();
    await addVariant(engine, {});
    await addVariant(engine, { size: SIZE_GRANDE, extras: [EXTRA_QUESO] });

    const loaded = (await repo.findById("t1"))!.items.find((item) => item.selectedSizeId === "grande")!;
    const label = resolveLineVariant(BURGER, loaded).label;
    const nextNote = buildLineNote({ variantLabel: label, quickNotes: ["SIN CEBOLLA"], freeText: "bien cocida" })!;

    await engine.updateItemNote("t1", loaded.productId, loaded.note, nextNote, undefined, {
      selectedSizeId: loaded.selectedSizeId ?? null,
      selectedExtraIds: loaded.selectedExtraIds ?? []
    });

    const after = (await repo.findById("t1"))!;
    const edited = after.items.find((item) => item.selectedSizeId === "grande")!;
    expect(edited.note).toBe("Grande + Queso · SIN CEBOLLA · bien cocida");
    expect(edited.price).toBe(23000);
    expect(edited.selectedExtraIds).toEqual(["queso"]);
    expect(after.items.find((item) => !item.selectedSizeId)!.note).toBeUndefined();
  });

  it("poner la nota a 1 de 2 unidades separa esa unidad en su propia línea", async () => {
    const { engine, repo } = await engineWithOpenTable();
    await addVariant(engine, { size: SIZE_GRANDE, extras: [EXTRA_QUESO], quantity: 2 });

    const line = (await repo.findById("t1"))!.items[0];
    const label = resolveLineVariant(BURGER, line).label;
    await engine.updateItemNote("t1", line.productId, line.note, buildLineNote({ variantLabel: label, quickNotes: ["SIN CEBOLLA"] })!, 1, {
      selectedSizeId: line.selectedSizeId ?? null,
      selectedExtraIds: line.selectedExtraIds ?? []
    });

    const after = (await repo.findById("t1"))!;
    expect(after.items).toHaveLength(2);
    expect(after.items.reduce((sum, item) => sum + item.quantity, 0)).toBe(2);
    expect(after.items.map((item) => item.note).sort()).toEqual(["Grande + Queso", "Grande + Queso · SIN CEBOLLA"]);
    expect(new Set(after.items.map(lineDisplayKey)).size).toBe(2);
    expect(after.subtotal).toBe(2 * 23000);
  });
});