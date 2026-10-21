// Notas por plato en mesas: cada variante llega a cocina con SU nota y nada se duplica ni se pierde.
import { describe, it, expect, beforeEach, afterEach } from "vitest";

import { Product, Sale, Table, CashMovement, KitchenOrder, Order } from "../../src/core/entities/Entities";

import { CartEngine } from "../../src/core/engines/CartEngine";
import { InventoryEngine } from "../../src/core/engines/InventoryEngine";
import { PaymentEngine } from "../../src/core/engines/PaymentEngine";
import { ReceiptEngine } from "../../src/core/engines/ReceiptEngine";
import { KitchenEngine } from "../../src/core/engines/KitchenEngine";
import { CashEngine } from "../../src/core/engines/CashEngine";
import { CustomerEngine } from "../../src/core/engines/CustomerEngine";
import { AlertEngine } from "../../src/core/engines/AlertEngine";
import { HealthEngine } from "../../src/core/engines/HealthEngine";
import { KardexEngine } from "../../src/core/engines/KardexEngine";
import { AuditEngine } from "../../src/core/engines/AuditEngine";
import { SalesEngine } from "../../src/core/engines/SalesEngine";
import { TableEngine } from "../../src/core/engines/TableEngine";
import { OrderEngine } from "../../src/core/engines/OrderEngine";
import { PosCore } from "../../src/core/engines/PosCore";

import { InMemoryRepository } from "../fakes/InMemoryRepository";
import { FakeProductRepository } from "../fakes/FakeProductRepository";
import { DEFAULT_OPERATION_CONFIG } from "../../src/core/config/operation";
import { enabledModulesStore } from "../../src/core/store/enabledModulesStore";
import { operationConfigStore } from "../../src/core/store/operationConfigStore";
import { kitchenOutputModeStore } from "../../src/core/store/kitchenOutputModeStore";


const BURGER: Product = {
  id: "prod-burger",
  name: "Hamburguesa Clásica",
  categoryId: "cat-comidas",
  price: 18000,
  stock: 50,
  minStock: 2,
  lastUpdated: new Date(),
  requiresKitchen: true
};

function buildContext() {
  const products = new FakeProductRepository();
  const sales = new InMemoryRepository<Sale>("sales");
  const receipts = new InMemoryRepository("receipts");
  const kitchenOrders = new InMemoryRepository<KitchenOrder>("kitchen_orders");
  const cashMovements = new InMemoryRepository<CashMovement>("cash_movements");
  const customers = new InMemoryRepository("customers");
  const movements = new InMemoryRepository("inventory_movements");
  const auditLogs = new InMemoryRepository("audit_logs");
  const orders = new InMemoryRepository<Order>("orders");
  const tables = new InMemoryRepository<Table>("tables");

  const kardex = new KardexEngine(movements as any);
  const inventory = new InventoryEngine(products, kardex);
  const kitchen = new KitchenEngine(kitchenOrders, new AuditEngine(auditLogs as any));
  const cash = new CashEngine(cashMovements);
  const audit = new AuditEngine(auditLogs as any);

  const salesEngine = new SalesEngine(
    sales as any,
    new CartEngine(),
    inventory,
    new PaymentEngine(),
    new ReceiptEngine(receipts as any),
    kitchen,
    cash,
    new CustomerEngine(customers as any, sales as any),
    new AlertEngine(),
    new HealthEngine(),
    kardex,
    {} as PosCore,
    audit
  );

  const orderEngine = new OrderEngine(orders as never, kitchen, salesEngine);
  const tableEngine = new TableEngine(tables as any, kitchen, salesEngine, orderEngine);
  return { tableEngine, kitchenOrders, tables };
}

describe("CartEngine: Caja/POS conserva su comportamiento clásico", () => {
  it("sin splitByNote el mismo producto sigue siendo UNA línea (la última nota gana)", () => {
    const cart = new CartEngine();
    cart.addItem(BURGER, 1);
    cart.addItem(BURGER, 1, "sin cebolla");
    expect(cart.getItems()).toHaveLength(1);
    expect(cart.getItems()[0].quantity).toBe(2);
    expect(cart.getItems()[0].note).toBe("sin cebolla");
  });

  it("removeItem/updateQuantity sin línea siguen actuando sobre todo el producto", () => {
    const cart = new CartEngine();
    cart.addItem(BURGER, 2);
    cart.updateQuantity(BURGER.id, 5);
    expect(cart.getItems()[0].quantity).toBe(5);
    cart.removeItem(BURGER.id);
    expect(cart.isEmpty()).toBe(true);
  });
});

describe("Mesas: notas por plato y envío correcto a cocina", () => {
  let ctx: ReturnType<typeof buildContext>;
  const T = "table-1";

  beforeEach(async () => {
    enabledModulesStore.set(["caja", "pedidos"]);
    operationConfigStore.set({
      ...DEFAULT_OPERATION_CONFIG,
      kitchenEnabled: true,
      kitchenOutputMode: "kds",
      kdsEnabled: true,
      salesChannels: ["presencial"]
    });
    kitchenOutputModeStore.set("pantalla");
    ctx = buildContext();
    await ctx.tables.save({
      id: T, name: "Mesa 1", capacity: 4, peopleCount: 0, status: "FREE",
      items: [], subtotal: 0, tax: 0, discount: 0, total: 0, updatedAt: new Date()
    } as Table);
    await ctx.tableEngine.openTable({ tableId: T, peopleCount: 2, waiterId: "waiter-1" });
  });

  afterEach(() => {
    enabledModulesStore.clear();
    operationConfigStore.clear();
    kitchenOutputModeStore.clear();
  });

  const items = async () => (await ctx.tableEngine.getTable(T))!.items;
  const sentOrders = async () => (await ctx.kitchenOrders.findAll()).filter(o => o.status !== "CANCELADO");
  const summary = (list: readonly { quantity: number; note?: string }[]) =>
    list.map(i => `${i.quantity}|${i.note ?? ""}`).sort();

  it("la misma hamburguesa con y sin nota queda en líneas separadas y cocina recibe cada una con su nota", async () => {
    await ctx.tableEngine.addItem({ tableId: T, product: BURGER, quantity: 1 });
    await ctx.tableEngine.addItem({ tableId: T, product: BURGER, quantity: 1, note: "sin cebolla" });

    expect(summary(await items())).toEqual(["1|", "1|sin cebolla"]);

    await ctx.tableEngine.sendToKitchen(T);
    const orders = await sentOrders();
    expect(orders).toHaveLength(1);
    expect(summary(orders[0].items)).toEqual(["1|", "1|sin cebolla"]);
  });

  it("la misma nota dos veces se suma en una sola línea", async () => {
    await ctx.tableEngine.addItem({ tableId: T, product: BURGER, quantity: 1, note: "sin cebolla" });
    await ctx.tableEngine.addItem({ tableId: T, product: BURGER, quantity: 1, note: " sin cebolla " });
    expect(summary(await items())).toEqual(["2|sin cebolla"]);
  });

  it("2 hamburguesas, nota solo a 1 unidad: quedan 1 normal y 1 sin cebolla", async () => {
    await ctx.tableEngine.addItem({ tableId: T, product: BURGER, quantity: 2 });
    await ctx.tableEngine.updateItemNote(T, BURGER.id, undefined, "sin cebolla", 1);
    expect(summary(await items())).toEqual(["1|", "1|sin cebolla"]);

    const table = (await ctx.tableEngine.getTable(T))!;
    expect(table.subtotal).toBe(36000); // el total no cambia al separar la línea
  });

  it("nota a todas las unidades no divide la línea", async () => {
    await ctx.tableEngine.addItem({ tableId: T, product: BURGER, quantity: 2 });
    await ctx.tableEngine.updateItemNote(T, BURGER.id, undefined, "sin cebolla");
    expect(summary(await items())).toEqual(["2|sin cebolla"]);
  });

  it("cambiar una nota ya enviada a cocina se rechaza y no altera mesa ni cocina", async () => {
    await ctx.tableEngine.addItem({ tableId: T, product: BURGER, quantity: 1 });
    await ctx.tableEngine.sendToKitchen(T);

    await expect(
      ctx.tableEngine.updateItemNote(T, BURGER.id, undefined, "sin cebolla")
    ).rejects.toThrow("TABLE_NOTE_ALREADY_SENT");

    expect(summary(await items())).toEqual(["1|"]);
    expect(await sentOrders()).toHaveLength(1);
  });

  it("después de enviar, agregar el plato de nuevo con nota manda SOLO el plato nuevo", async () => {
    await ctx.tableEngine.addItem({ tableId: T, product: BURGER, quantity: 1 });
    await ctx.tableEngine.sendToKitchen(T);

    await ctx.tableEngine.addItem({ tableId: T, product: BURGER, quantity: 1, note: "sin cebolla" });
    await ctx.tableEngine.sendToKitchen(T);

    const orders = (await sentOrders()).sort((a, b) => +new Date(a.createdAt) - +new Date(b.createdAt));
    expect(orders).toHaveLength(2);
    expect(summary(orders[0].items)).toEqual(["1|"]);
    expect(summary(orders[1].items)).toEqual(["1|sin cebolla"]);
  });

  it("enviar dos veces sin cambios no duplica comandas", async () => {
    await ctx.tableEngine.addItem({ tableId: T, product: BURGER, quantity: 1, note: "sin cebolla" });
    await ctx.tableEngine.sendToKitchen(T);
    await ctx.tableEngine.sendToKitchen(T);
    expect(await sentOrders()).toHaveLength(1);
  });

  it("1 unidad ya enviada + 2 nuevas: la nota a las 2 nuevas se permite y solo salen esas", async () => {
    await ctx.tableEngine.addItem({ tableId: T, product: BURGER, quantity: 1 });
    await ctx.tableEngine.sendToKitchen(T);
    await ctx.tableEngine.addItem({ tableId: T, product: BURGER, quantity: 2 }); // línea sin nota: 3 (1 enviada)

    await ctx.tableEngine.updateItemNote(T, BURGER.id, undefined, "sin cebolla", 2);
    expect(summary(await items())).toEqual(["1|", "2|sin cebolla"]);

    await ctx.tableEngine.sendToKitchen(T);
    const orders = (await sentOrders()).sort((a, b) => +new Date(a.createdAt) - +new Date(b.createdAt));
    expect(orders).toHaveLength(2);
    expect(summary(orders[1].items)).toEqual(["2|sin cebolla"]);
  });

  it("1 unidad ya enviada + 2 nuevas: la nota a las 3 se rechaza (una ya salió)", async () => {
    await ctx.tableEngine.addItem({ tableId: T, product: BURGER, quantity: 1 });
    await ctx.tableEngine.sendToKitchen(T);
    await ctx.tableEngine.addItem({ tableId: T, product: BURGER, quantity: 2 });

    await expect(
      ctx.tableEngine.updateItemNote(T, BURGER.id, undefined, "sin cebolla")
    ).rejects.toThrow("TABLE_NOTE_ALREADY_SENT");
  });

  it("quitar y cambiar cantidad actúan solo sobre la línea indicada", async () => {
    await ctx.tableEngine.addItem({ tableId: T, product: BURGER, quantity: 1 });
    await ctx.tableEngine.addItem({ tableId: T, product: BURGER, quantity: 1, note: "sin cebolla" });

    await ctx.tableEngine.updateItemQuantity(T, BURGER.id, 3, { note: "sin cebolla" });
    expect(summary(await items())).toEqual(["1|", "3|sin cebolla"]);

    await ctx.tableEngine.removeItem(T, BURGER.id, { note: undefined });
    expect(summary(await items())).toEqual(["3|sin cebolla"]);
  });
});