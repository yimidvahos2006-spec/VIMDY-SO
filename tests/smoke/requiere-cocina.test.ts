// tests/smoke/requiere-cocina.test.ts
/* ===========================================================================
   SMOKE TEST — Enrutamiento a cocina según Product.requiresKitchen
   ---------------------------------------------------------------------------
   Cubre el punto #1 de la base ("requiresKitchen en el catálogo de
   productos"): sin esto, TODO pedido/venta mandaba TODOS sus items a
   Cocina, aunque fueran una gaseosa embotellada. Esta prueba confirma que,
   en los dos caminos reales de VIMDY que generan comandas...

     1. SalesEngine.sendToKitchen (disparado automático por createSale, la
        ruta de Caja/mostrador/domicilio)
     2. TableEngine.sendToKitchen (la ruta real que usa el mesero desde
        TableDetailPanel)

   ...un producto con requiresKitchen === false NUNCA aparece en una
   comanda, y si NINGÚN producto del pedido lo requiere, no se crea una
   comanda fantasma en Cocina.

   Si este flujo se rompe, Cocina vuelve a recibir tickets de productos que
   no necesitan prepararse — ruido que hace más lento al cocinero real.
=========================================================================== */

import { describe, it, expect, beforeEach } from "vitest";

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

const BURGER: Product = {
  id: "prod-burger",
  name: "Hamburguesa Clásica",
  categoryId: "cat-comidas",
  price: 18000,
  stock: 20,
  minStock: 2,
  lastUpdated: new Date(),
  requiresKitchen: true
};

const SODA: Product = {
  id: "prod-soda",
  name: "Gaseosa embotellada 400ml",
  categoryId: "cat-bebidas",
  price: 4000,
  stock: 50,
  minStock: 5,
  lastUpdated: new Date(),
  requiresKitchen: false
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
  const cart = new CartEngine();

  const salesEngine = new SalesEngine(
    sales as any,
    cart,
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

  return { salesEngine, tableEngine, products, cart, kitchenOrders, tables, orders };
}

describe("Smoke: requiresKitchen filtra qué llega a Cocina", () => {
  let ctx: ReturnType<typeof buildContext>;

  beforeEach(async () => {
    ctx = buildContext();
    await ctx.products.save(BURGER);
    await ctx.products.save(SODA);
  });

  it("SalesEngine: en una venta mixta, la comanda solo trae el item que requiere cocina", async () => {
    ctx.cart.addItem(BURGER, 1);
    ctx.cart.addItem(SODA, 2);

    await ctx.salesEngine.quickSale({ cashierId: "cashier-1" });

    const kitchenOrders = await ctx.kitchenOrders.findAll();
    expect(kitchenOrders).toHaveLength(1);
    expect(kitchenOrders[0].items).toHaveLength(1);
    expect(kitchenOrders[0].items[0].productId).toBe(BURGER.id);
  });

  it("SalesEngine: una venta 100% de productos sin cocina no genera ninguna comanda", async () => {
    ctx.cart.addItem(SODA, 3);

    await ctx.salesEngine.quickSale({ cashierId: "cashier-1" });

    const kitchenOrders = await ctx.kitchenOrders.findAll();
    expect(kitchenOrders).toHaveLength(0);
  });

  it("TableEngine: la mesa envía a cocina solo los items que lo requieren", async () => {
    const table = await ctx.tables.save({
      id: "table-1",
      name: "Mesa 1",
      capacity: 4,
      peopleCount: 0,
      status: "FREE",
      items: [],
      subtotal: 0,
      tax: 0,
      discount: 0,
      total: 0,
      updatedAt: new Date()
    } as Table).then(() => ctx.tables.findById("table-1"));
    expect(table).not.toBeNull();

    await ctx.tableEngine.openTable({ tableId: "table-1", peopleCount: 2, waiterId: "waiter-1" });
    await ctx.tableEngine.addItem({ tableId: "table-1", product: BURGER, quantity: 1 });
    await ctx.tableEngine.addItem({ tableId: "table-1", product: SODA, quantity: 2 });

    await ctx.tableEngine.sendToKitchen("table-1");

    const kitchenOrders = await ctx.kitchenOrders.findAll();
    expect(kitchenOrders).toHaveLength(1);
    expect(kitchenOrders[0].items).toHaveLength(1);
    expect(kitchenOrders[0].items[0].productId).toBe(BURGER.id);
  });

  it("TableEngine: un pedido 100% sin cocina rechaza el envío con NOTHING_REQUIRES_KITCHEN", async () => {
    await ctx.tables.save({
      id: "table-2",
      name: "Mesa 2",
      capacity: 2,
      peopleCount: 0,
      status: "FREE",
      items: [],
      subtotal: 0,
      tax: 0,
      discount: 0,
      total: 0,
      updatedAt: new Date()
    } as Table);

    await ctx.tableEngine.openTable({ tableId: "table-2", peopleCount: 1, waiterId: "waiter-1" });
    await ctx.tableEngine.addItem({ tableId: "table-2", product: SODA, quantity: 1 });

    await expect(ctx.tableEngine.sendToKitchen("table-2")).rejects.toThrow(
      /NOTHING_REQUIRES_KITCHEN/
    );

    const kitchenOrders = await ctx.kitchenOrders.findAll();
    expect(kitchenOrders).toHaveLength(0);
  });
});