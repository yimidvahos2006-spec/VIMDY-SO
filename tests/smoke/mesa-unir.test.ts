// tests/smoke/mesa-unir.test.ts
/* ===========================================================================
   Unir mesas (punto 3, paso 3A) — contrato del TableEngine
   ---------------------------------------------------------------------------
   - Une la cuenta de una mesa abierta dentro de otra mesa abierta.
   - Las líneas viajan COMPLETAS (tamaño, extras, nota, descuento, IVA...).
   - Líneas idénticas se suman; distintas se conservan separadas.
   - El origen queda LIBRE y reutilizable (nunca "CLOSED" oculta) y su pedido
     se cancela (ya no queda huérfano).
   - Si algo falla a mitad de camino, el destino vuelve a como estaba.
=========================================================================== */

import { describe, it, expect, beforeEach } from "vitest";

import type { KitchenOrder, Order, SaleItem, Table } from "../../src/core/entities/Entities";
import { TableEngine } from "../../src/core/engines/TableEngine";
import { OrderEngine } from "../../src/core/engines/OrderEngine";
import { KitchenEngine } from "../../src/core/engines/KitchenEngine";
import { InMemoryRepository } from "../fakes/InMemoryRepository";
import {
  assessMerge,
  mergeSaleItems,
  subtractSaleItems
} from "../../src/core/utils/tableMerge";

const pizzaGrande: SaleItem = {
  productId: "pizza",
  quantity: 1,
  price: 30000,
  requiresKitchen: true,
  selectedSizeId: "grande",
  selectedExtraIds: ["queso", "tocineta"],
  note: "sin cebolla",
  discount: { type: "PERCENT", value: 10 },
  taxRate: 8,
  unit: "unidad"
};

const gaseosa: SaleItem = { productId: "gaseosa", quantity: 2, price: 4000, requiresKitchen: false };

function buildContext() {
  const tables = new InMemoryRepository<Table>("tables");
  const orders = new InMemoryRepository<Order>("orders");
  const orderEngine = new OrderEngine(orders as never, {} as never, {} as never);
  const kitchenOrders = new InMemoryRepository<KitchenOrder>("kitchen");
  const kitchen = new KitchenEngine(kitchenOrders as never, { log: async () => undefined } as never);
  const engine = new TableEngine(tables as any, kitchen, {} as any, orderEngine);
  return { engine, tables, orders, orderEngine, kitchen, kitchenOrders };
}

async function openWith(
  ctx: ReturnType<typeof buildContext>,
  id: string,
  name: string,
  people: number,
  items: SaleItem[],
  extra: Partial<Table> = {}
) {
  await ctx.tables.save({
    id,
    name,
    capacity: 6,
    peopleCount: 0,
    status: "FREE",
    items: [],
    subtotal: 0,
    tax: 0,
    discount: 0,
    total: 0,
    updatedAt: new Date()
  } as Table);
  await ctx.engine.openTable({ tableId: id, peopleCount: people, waiterId: "w1", operationId: `op-${id}` });
  const opened = (await ctx.tables.findById(id)) as Table;
  await ctx.tables.update({ ...opened, items, ...extra } as Table);
}

describe("Smoke: unir mesas", () => {
  let ctx: ReturnType<typeof buildContext>;

  beforeEach(async () => {
    ctx = buildContext();
    await openWith(ctx, "t1", "Mesa 1", 2, [pizzaGrande, gaseosa]);
    await openWith(ctx, "t2", "Mesa 2", 3, [{ ...gaseosa, quantity: 1 }]);
  });

  it("mueve las líneas completas, suma personas y deja el origen libre y reutilizable", async () => {
    const merged = await ctx.engine.mergeTables("t1", "t2");

    const pizza = merged.items.find((i) => i.productId === "pizza") as SaleItem;
    expect(pizza).toMatchObject({
      quantity: 1,
      price: 30000,
      selectedSizeId: "grande",
      selectedExtraIds: ["queso", "tocineta"],
      note: "sin cebolla",
      discount: { type: "PERCENT", value: 10 },
      taxRate: 8,
      unit: "unidad",
      requiresKitchen: true
    });

    // La gaseosa idéntica se suma (1 + 2), no se duplica la línea.
    const sodas = merged.items.filter((i) => i.productId === "gaseosa");
    expect(sodas).toHaveLength(1);
    expect(sodas[0].quantity).toBe(3);

    expect(merged.subtotal).toBe(30000 + 3 * 4000);
    expect(merged.peopleCount).toBe(5);
    expect(merged.status).not.toBe("FREE");

    const source = (await ctx.tables.findById("t1")) as Table;
    expect(source.status).toBe("FREE");
    expect(source.items).toHaveLength(0);
    expect(source.total).toBe(0);
    expect(source.peopleCount).toBe(0);
    expect(source.orderId).toBeUndefined();
    expect(source.openOperationId).toBeUndefined();

    // Reutilizable: se puede abrir de nuevo para otros clientes.
    const reopened = await ctx.engine.openTable({
      tableId: "t1",
      peopleCount: 1,
      waiterId: "w2",
      operationId: "op-nuevo"
    });
    expect(reopened.status).toBe("BUSY");
  });

  it("cancela el pedido del origen y conserva el del destino", async () => {
    const sourceBefore = (await ctx.tables.findById("t1")) as Table;
    const targetBefore = (await ctx.tables.findById("t2")) as Table;
    expect(sourceBefore.orderId).toBeTruthy();
    expect(targetBefore.orderId).toBeTruthy();

    await ctx.engine.mergeTables("t1", "t2");

    const sourceOrder = await ctx.orderEngine.getOrder(sourceBefore.orderId as string);
    const targetOrder = await ctx.orderEngine.getOrder(targetBefore.orderId as string);
    expect(sourceOrder.status).toBe("CANCELLED");
    expect(targetOrder.status).not.toBe("CANCELLED");

    const targetAfter = (await ctx.tables.findById("t2")) as Table;
    expect(targetAfter.orderId).toBe(targetBefore.orderId);
  });

  it("suma también el descuento de la cuenta", async () => {
    const t1 = (await ctx.tables.findById("t1")) as Table;
    const t2 = (await ctx.tables.findById("t2")) as Table;
    await ctx.tables.update({ ...t1, discount: 1000 } as Table);
    await ctx.tables.update({ ...t2, discount: 500 } as Table);

    const merged = await ctx.engine.mergeTables("t1", "t2");
    expect(merged.discount).toBe(1500);
    expect(merged.total).toBeCloseTo(merged.subtotal + merged.tax - 1500, 2);
  });

  it("rechaza unir una mesa consigo misma", async () => {
    await expect(ctx.engine.mergeTables("t1", "t1")).rejects.toThrow("TABLE_MERGE_SAME_TABLE");
  });

  it("rechaza un destino libre, reservado, cobrando o cerrado (y no toca nada)", async () => {
    for (const status of ["FREE", "RESERVED", "PAYING", "CLOSED"] as const) {
      const t2 = (await ctx.tables.findById("t2")) as Table;
      await ctx.tables.update({ ...t2, status } as Table);

      await expect(ctx.engine.mergeTables("t1", "t2")).rejects.toThrow("TABLE_MERGE_TARGET_NOT_OPEN");

      const source = (await ctx.tables.findById("t1")) as Table;
      expect(source.items).toHaveLength(2);
      expect(source.status).toBe("BUSY");
    }
  });

  it("rechaza un origen sin cuenta abierta o sin productos", async () => {
    const t1 = (await ctx.tables.findById("t1")) as Table;

    await ctx.tables.update({ ...t1, items: [] } as Table);
    await expect(ctx.engine.mergeTables("t1", "t2")).rejects.toThrow("EMPTY_TABLE");

    const emptied = (await ctx.tables.findById("t1")) as Table;
    await ctx.tables.update({ ...emptied, status: "FREE" } as Table);
    await expect(ctx.engine.mergeTables("t1", "t2")).rejects.toThrow("TABLE_NOT_OPEN");
  });

  it("rechaza mesas de otra sucursal", async () => {
    const t1 = (await ctx.tables.findById("t1")) as Table;
    const t2 = (await ctx.tables.findById("t2")) as Table;
    await ctx.tables.update({ ...t1, branchId: "sede-a" } as Table);
    await ctx.tables.update({ ...t2, branchId: "sede-b" } as Table);

    await expect(ctx.engine.mergeTables("t1", "t2")).rejects.toThrow("CONTEXT_MISMATCH");
  });

  it("si falla liberar el origen, el destino vuelve exactamente a como estaba", async () => {
    const targetBefore = (await ctx.tables.findById("t2")) as Table;

    const realUpdate = ctx.tables.update.bind(ctx.tables);
    (ctx.tables as any).update = async (entity: Table) => {
      if (entity.id === "t1" && entity.status === "FREE") throw new Error("FALLO_SIMULADO_DE_RED");
      return realUpdate(entity);
    };

    await expect(ctx.engine.mergeTables("t1", "t2")).rejects.toThrow("FALLO_SIMULADO_DE_RED");

    const targetAfter = (await ctx.tables.findById("t2")) as Table;
    expect(targetAfter.items).toEqual(targetBefore.items);
    expect(targetAfter.peopleCount).toBe(targetBefore.peopleCount);
    expect(targetAfter.discount).toBe(targetBefore.discount);

    const source = (await ctx.tables.findById("t1")) as Table;
    expect(source.items).toHaveLength(2);
    expect(source.status).toBe("BUSY");
  });
});

describe("Reglas puras de unión", () => {
  it("no suma líneas del mismo producto con tamaño, extras o nota distintos", () => {
    const base: SaleItem[] = [{ ...pizzaGrande }];
    const merged = mergeSaleItems(base, [
      { ...pizzaGrande, selectedSizeId: "chica" },
      { ...pizzaGrande, selectedExtraIds: ["queso"] },
      { ...pizzaGrande, note: "bien cocida" },
      { ...pizzaGrande }
    ]);

    expect(merged).toHaveLength(4);
    expect(merged[0].quantity).toBe(2);
  });

  it("suma la cantidad física (peso) junto con la cantidad", () => {
    const queso: SaleItem = { productId: "queso", quantity: 1, price: 20000, unit: "kg", quantityRaw: 0.5 };
    const merged = mergeSaleItems([queso], [{ ...queso, quantityRaw: 0.25 }]);
    expect(merged[0].quantity).toBe(2);
    expect(merged[0].quantityRaw).toBeCloseTo(0.75, 6);
  });

  it("restar es la operación inversa exacta de sumar", () => {
    const base: SaleItem[] = [{ ...gaseosa, quantity: 1 }];
    const incoming: SaleItem[] = [pizzaGrande, gaseosa];
    const restored = subtractSaleItems(mergeSaleItems(base, incoming), incoming);
    expect(restored).toEqual(base);
  });

  it("assessMerge valida estados y contexto", () => {
    const open = (id: string, status: Table["status"], items: SaleItem[] = [gaseosa]) =>
      ({ id, name: id, status, items } as unknown as Table);

    expect(assessMerge(open("a", "BUSY"), open("b", "EATING")).ok).toBe(true);
    expect(assessMerge(open("a", "BUSY"), open("a", "BUSY")).code).toBe("TABLE_MERGE_SAME_TABLE");
    expect(assessMerge(open("a", "BUSY"), open("b", "FREE")).code).toBe("TABLE_MERGE_TARGET_NOT_OPEN");
    expect(assessMerge(open("a", "FREE"), open("b", "BUSY")).code).toBe("TABLE_NOT_OPEN");
    expect(assessMerge(open("a", "BUSY", []), open("b", "BUSY")).code).toBe("EMPTY_TABLE");
  });
});