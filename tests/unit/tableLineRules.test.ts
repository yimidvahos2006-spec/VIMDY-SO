// tests/unit/tableLineRules.test.ts
/* ===========================================================================
   Reglas de línea de mesa (Etapa 2 — identidad de línea).

   1. Identidad: producto + tamaño + extras (sin orden) + nota normalizada.
   2. Unificación: líneas idénticas se suman; distintas nunca se mezclan.
   3. Operaciones con línea completa: quitar / cambiar cantidad / editar nota.
   4. Compatibilidad: una operación vieja de la cola (solo productId) sigue
      actuando sobre todas las líneas del producto.
   5. PARIDAD: lo que ve el mesero sin internet (applyLineOperation) es
      EXACTAMENTE lo que deja el TableEngine real al sincronizar.
   =========================================================================== */

import { describe, it, expect } from "vitest";
import type { SaleItem, Table } from "../../src/core/entities/Entities";
import {
  applyLineOperation,
  computeTableTotals,
  lineKey,
  lineOperationFromPending,
  resolveRequiresKitchen,
  type TableLineOperation
} from "../../src/core/offline/tableLineRules";
import { CartEngine } from "../../src/core/engines/CartEngine";
import { TableEngine } from "../../src/core/engines/TableEngine";
import { companyConfigStore } from "../../src/core/store/companyConfigStore";
import { InMemoryRepository } from "../fakes/InMemoryRepository";

const BURGER = { id: "burger", price: 18000, requiresKitchen: true };
const COLA = { id: "cola", price: 4000, requiresKitchen: false };

const add = (
  product: typeof BURGER,
  quantity = 1,
  extra: Partial<Extract<TableLineOperation, { type: "ADD_ITEM" }>> = {}
): TableLineOperation => ({ type: "ADD_ITEM", product, quantity, ...extra });

const run = (ops: TableLineOperation[], start: SaleItem[] = []) =>
  ops.reduce<SaleItem[]>((items, op) => applyLineOperation(items, op), start);

describe("lineKey — identidad de línea", () => {
  it("ignora el orden de los extras, los duplicados y los espacios de la nota", () => {
    const a = lineKey({ productId: "p", selectedExtraIds: ["queso", "tocineta"], note: " sin cebolla " });
    const b = lineKey({ productId: "p", selectedExtraIds: ["tocineta", "queso", "queso"], note: "sin cebolla" });
    expect(a).toBe(b);
  });

  it("'sin nota', null y undefined son la misma línea", () => {
    expect(lineKey({ productId: "p", note: "" })).toBe(lineKey({ productId: "p" }));
    expect(lineKey({ productId: "p", note: null })).toBe(lineKey({ productId: "p", note: "  " }));
  });

  it("producto, tamaño, extras y nota distintos dan claves distintas", () => {
    const base = { productId: "p", selectedSizeId: "m", selectedExtraIds: ["queso"], note: "x" };
    const keys = new Set([
      lineKey(base),
      lineKey({ ...base, productId: "q" }),
      lineKey({ ...base, selectedSizeId: "l" }),
      lineKey({ ...base, selectedExtraIds: [] }),
      lineKey({ ...base, note: "y" })
    ]);
    expect(keys.size).toBe(5);
  });
});

describe("ADD_ITEM — unificación de líneas idénticas", () => {
  it("el mismo producto, sin nota, dos veces: UNA línea con cantidad 2", () => {
    const items = run([add(COLA), add(COLA)]);
    expect(items).toHaveLength(1);
    expect(items[0].quantity).toBe(2);
  });

  it("notas con espacios distintos pero iguales al normalizar se unifican", () => {
    const items = run([add(BURGER, 1, { note: "sin cebolla" }), add(BURGER, 2, { note: "  sin cebolla  " })]);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ quantity: 3, note: "sin cebolla" });
  });

  it("distinta nota, tamaño o extras: líneas aparte", () => {
    const items = run([
      add(BURGER),
      add(BURGER, 1, { note: "sin cebolla" }),
      add(BURGER, 1, { selectedSizeId: "grande" }),
      add(BURGER, 1, { selectedExtraIds: ["queso"] })
    ]);
    expect(items).toHaveLength(4);
  });

  it("extras en distinto orden se unifican en una sola línea (guardados ordenados)", () => {
    const items = run([
      add(BURGER, 1, { selectedExtraIds: ["tocineta", "queso"] }),
      add(BURGER, 1, { selectedExtraIds: ["queso", "tocineta"] })
    ]);
    expect(items).toHaveLength(1);
    expect(items[0].quantity).toBe(2);
    expect(items[0].selectedExtraIds).toEqual(["queso", "tocineta"]);
  });

  it("cantidad cero, negativa o no numérica se rechaza como VALIDATION_ERROR", () => {
    for (const quantity of [0, -1, Number.NaN]) {
      expect(() => run([add(COLA, quantity)])).toThrow(/^VALIDATION_ERROR/);
    }
  });

  it("no muta las líneas de entrada", () => {
    const start = run([add(COLA)]);
    const snapshot = structuredClone(start);
    applyLineOperation(start, add(COLA, 5));
    expect(start).toEqual(snapshot);
  });
});

describe("REMOVE_ITEM y UPDATE_QUANTITY — línea exacta", () => {
  const start = () =>
    run([
      add(BURGER, 2),
      add(BURGER, 1, { note: "sin cebolla" }),
      add(BURGER, 1, { selectedSizeId: "grande" })
    ]);

  it("quitar con línea elimina SOLO esa variante", () => {
    const items = applyLineOperation(start(), {
      type: "REMOVE_ITEM",
      line: { productId: "burger", note: "sin cebolla" }
    });
    expect(items).toHaveLength(2);
    expect(items.some((i) => i.note === "sin cebolla")).toBe(false);
  });

  it("una referencia sin tamaño NO toca la línea de tamaño grande", () => {
    const items = applyLineOperation(start(), {
      type: "REMOVE_ITEM",
      line: { productId: "burger" }
    });
    expect(items.map((i) => i.selectedSizeId ?? null).sort()).toEqual([null, "grande"].sort());
    expect(items.some((i) => i.selectedSizeId === "grande")).toBe(true);
  });

  it("operación vieja (solo productId) quita todas las líneas del producto", () => {
    const items = applyLineOperation([...start(), ...run([add(COLA)])], {
      type: "REMOVE_ITEM",
      productId: "burger"
    });
    expect(items.map((i) => i.productId)).toEqual(["cola"]);
  });

  it("UPDATE_QUANTITY cambia solo la línea indicada", () => {
    const items = applyLineOperation(start(), {
      type: "UPDATE_QUANTITY",
      line: { productId: "burger", note: "sin cebolla" },
      quantity: 5
    });
    expect(items.find((i) => i.note === "sin cebolla")?.quantity).toBe(5);
    expect(items.find((i) => !i.note && !i.selectedSizeId)?.quantity).toBe(2);
  });

  it("UPDATE_QUANTITY a 0 quita la línea", () => {
    const items = applyLineOperation(start(), {
      type: "UPDATE_QUANTITY",
      line: { productId: "burger", note: "sin cebolla" },
      quantity: 0
    });
    expect(items).toHaveLength(2);
  });

  it("una línea que ya no existe no rompe nada (no-op)", () => {
    const before = start();
    const items = applyLineOperation(before, {
      type: "UPDATE_QUANTITY",
      line: { productId: "burger", note: "fantasma" },
      quantity: 9
    });
    expect(items).toEqual(before);
  });
});

describe("UPDATE_NOTE — editar notas y unificar", () => {
  it("cambia la nota de toda la línea", () => {
    const items = run(
      [{ type: "UPDATE_NOTE", line: { productId: "burger" }, toNote: "sin cebolla" }],
      run([add(BURGER, 2)])
    );
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ quantity: 2, note: "sin cebolla" });
  });

  it("si ya existe una línea idéntica con la nota nueva, se UNIFICAN", () => {
    const items = run(
      [{ type: "UPDATE_NOTE", line: { productId: "burger", note: "a" }, toNote: "b" }],
      run([add(BURGER, 1, { note: "a" }), add(BURGER, 2, { note: "b" })])
    );
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ quantity: 3, note: "b" });
  });

  it("parcial: 2 hamburguesas, una 'sin cebolla' → dos líneas de 1", () => {
    const items = run(
      [{ type: "UPDATE_NOTE", line: { productId: "burger" }, toNote: "sin cebolla", units: 1 }],
      run([add(BURGER, 2)])
    );
    expect(items).toHaveLength(2);
    expect(items.find((i) => !i.note)?.quantity).toBe(1);
    expect(items.find((i) => i.note === "sin cebolla")?.quantity).toBe(1);
  });

  it("units igual (o mayor) a la cantidad mueve la línea entera, sin dejar líneas en cero", () => {
    for (const units of [2, 5]) {
      const items = run(
        [{ type: "UPDATE_NOTE", line: { productId: "burger" }, toNote: "x", units }],
        run([add(BURGER, 2)])
      );
      expect(items).toHaveLength(1);
      expect(items[0]).toMatchObject({ quantity: 2, note: "x" });
    }
  });

  it("parcial hacia una línea existente suma a esa y deja el resto", () => {
    const items = run(
      [{ type: "UPDATE_NOTE", line: { productId: "burger" }, toNote: "x", units: 1 }],
      run([add(BURGER, 3), add(BURGER, 1, { note: "x" })])
    );
    expect(items.find((i) => !i.note)?.quantity).toBe(2);
    expect(items.find((i) => i.note === "x")?.quantity).toBe(2);
  });

  it("quitar la nota (toNote vacío) la deja sin nota y unifica con la línea sin nota", () => {
    const items = run(
      [{ type: "UPDATE_NOTE", line: { productId: "burger", note: "x" }, toNote: "" }],
      run([add(BURGER, 1), add(BURGER, 1, { note: "x" })])
    );
    expect(items).toHaveLength(1);
    expect(items[0].quantity).toBe(2);
    expect(items[0].note).toBeUndefined();
  });

  it("misma nota (tras normalizar) o línea inexistente: no-op", () => {
    const before = run([add(BURGER, 1, { note: "x" })]);
    expect(applyLineOperation(before, { type: "UPDATE_NOTE", line: { productId: "burger", note: "x" }, toNote: " x " })).toEqual(before);
    expect(applyLineOperation(before, { type: "UPDATE_NOTE", line: { productId: "burger", note: "z" }, toNote: "y" })).toEqual(before);
  });

  it("solo edita la variante indicada (tamaño distinto no se toca)", () => {
    const before = run([add(BURGER, 1), add(BURGER, 1, { selectedSizeId: "grande" })]);
    const items = applyLineOperation(before, {
      type: "UPDATE_NOTE",
      line: { productId: "burger", selectedSizeId: "grande" },
      toNote: "bien cocida"
    });
    expect(items.find((i) => i.selectedSizeId === "grande")?.note).toBe("bien cocida");
    expect(items.find((i) => !i.selectedSizeId)?.note).toBeUndefined();
  });
});

describe("computeTableTotals", () => {
  it("subtotal, IVA y total con descuento, redondeados a 2 decimales", () => {
    const items = run([add(BURGER, 2), add(COLA, 1)]); // 40.000
    expect(computeTableTotals(items, 8, 1000)).toEqual({ subtotal: 40000, tax: 3200, total: 42200 });
  });

  it("el descuento nunca deja el total en negativo", () => {
    expect(computeTableTotals(run([add(COLA)]), 0, 999999).total).toBe(0);
  });
});

describe("lineOperationFromPending", () => {
  const catalog = (id: string) => ({ BURGER, COLA, ing: { id: "ing", price: 1, isIngredient: true, requiresKitchen: true } } as Record<string, any>)[id === "burger" ? "BURGER" : id === "cola" ? "COLA" : id];

  it("ADD_ITEM resuelve el producto y respeta la regla de ingredientes", () => {
    const op = lineOperationFromPending({ type: "ADD_ITEM", addItemInput: { productId: "ing", quantity: 1 } }, catalog);
    expect(op).toMatchObject({ type: "ADD_ITEM", product: { id: "ing", requiresKitchen: false } });
    expect(resolveRequiresKitchen({ isIngredient: true, requiresKitchen: true })).toBe(false);
  });

  it("ADD_ITEM con producto fuera del catálogo → undefined", () => {
    expect(lineOperationFromPending({ type: "ADD_ITEM", addItemInput: { productId: "nope", quantity: 1 } }, catalog)).toBeUndefined();
  });

  it("REMOVE_ITEM sin `line` (operación vieja) conserva el comportamiento por producto", () => {
    const op = lineOperationFromPending({ type: "REMOVE_ITEM", removeItemInput: { productId: "burger" } }, catalog);
    expect(op).toEqual({ type: "REMOVE_ITEM", productId: "burger", line: undefined });
  });

  it("UPDATE_NOTE arma la línea de origen con tamaño y extras", () => {
    const op = lineOperationFromPending(
      { type: "UPDATE_NOTE", updateNoteInput: { productId: "burger", fromNote: "a", toNote: "b", units: 1, selectedSizeId: "m" } },
      catalog
    );
    expect(op).toMatchObject({ type: "UPDATE_NOTE", line: { productId: "burger", note: "a", selectedSizeId: "m" }, toNote: "b", units: 1 });
  });

  it("OPEN, CLOSE y SEND_TO_KITCHEN no son operaciones de línea", () => {
    for (const type of ["OPEN", "CLOSE", "SEND_TO_KITCHEN"]) {
      expect(lineOperationFromPending({ type }, catalog)).toBeUndefined();
    }
  });
});

/* ---------------------------------------------------------------------------
   PARIDAD con el engine real: el estado optimista offline == resultado online.
--------------------------------------------------------------------------- */
describe("paridad offline ↔ TableEngine real", () => {
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

  it("la misma secuencia de operaciones da las mismas líneas y totales", async () => {
    const { engine, repo } = await engineWithOpenTable();
    const product = (p: typeof BURGER) => ({ ...p, name: p.id });

    // Secuencia que ejercita unificar, separar por variante, editar nota y quitar.
    await engine.addItem({ tableId: "t1", product: product(BURGER), quantity: 2 });
    await engine.addItem({ tableId: "t1", product: product(BURGER), quantity: 1 });
    await engine.addItem({ tableId: "t1", product: product(BURGER), quantity: 1, note: " sin cebolla " });
    await engine.addItem({ tableId: "t1", product: product(BURGER), quantity: 1, selectedSizeId: "grande", selectedExtraIds: ["tocineta", "queso"] });
    await engine.addItem({ tableId: "t1", product: product(COLA), quantity: 3 });
    await engine.updateItemNote("t1", "burger", undefined, "bien cocida", 1);
    await engine.updateItemQuantity("t1", "cola", 2, { note: undefined });
    await engine.removeItem("t1", "burger", { note: "sin cebolla" });

    const online = (await repo.findById("t1"))!;

    const offline = run([
      add(BURGER, 2),
      add(BURGER, 1),
      add(BURGER, 1, { note: " sin cebolla " }),
      add(BURGER, 1, { selectedSizeId: "grande", selectedExtraIds: ["tocineta", "queso"] }),
      add(COLA, 3),
      { type: "UPDATE_NOTE", line: { productId: "burger" }, toNote: "bien cocida", units: 1 },
      { type: "UPDATE_QUANTITY", line: { productId: "cola" }, quantity: 2 },
      { type: "REMOVE_ITEM", line: { productId: "burger", note: "sin cebolla" } }
    ]);

    const strip = (items: SaleItem[]) =>
      items.map(({ productId, quantity, price, note, selectedSizeId, selectedExtraIds }) => ({
        productId, quantity, price, note, selectedSizeId, selectedExtraIds
      }));
    expect(strip(offline)).toEqual(strip(online.items));

    const totals = computeTableTotals(offline, companyConfigStore.get().tax, 0);
    expect(online.subtotal).toBe(totals.subtotal);
    expect(online.tax).toBe(totals.tax);
    expect(online.total).toBe(totals.total);
  });

  it("CartEngine (online) y applyLineOperation coinciden en editar nota con unificación", () => {
    const cart = new CartEngine();
    cart.addItem({ id: "burger", price: 18000, requiresKitchen: true } as any, 1, "a", { splitByNote: true });
    cart.addItem({ id: "burger", price: 18000, requiresKitchen: true } as any, 2, "b", { splitByNote: true });
    cart.setLineNote("burger", "a", "b");

    const rules = run(
      [{ type: "UPDATE_NOTE", line: { productId: "burger", note: "a" }, toNote: "b" }],
      run([add(BURGER, 1, { note: "a" }), add(BURGER, 2, { note: "b" })])
    );
    expect(cart.getItems()).toEqual(rules);
  });
});