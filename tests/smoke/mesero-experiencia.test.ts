import { describe, it, expect, beforeEach } from "vitest";

import { Product, Table, OrderPriority } from "../../src/core/entities/Entities";
import { InMemoryRepository } from "../fakes/InMemoryRepository";
import { FakeProductRepository } from "../fakes/FakeProductRepository";
import { Sale, SaleItem } from "../../src/core/entities/Entities";
import { KardexEngine } from "../../src/core/engines/KardexEngine";
import { InventoryEngine } from "../../src/core/engines/InventoryEngine";
import { KitchenEngine } from "../../src/core/engines/KitchenEngine";
import { CashEngine } from "../../src/core/engines/CashEngine";
import { AuditEngine } from "../../src/core/engines/AuditEngine";
import { SalesEngine } from "../../src/core/engines/SalesEngine";
import { OrderEngine } from "../../src/core/engines/OrderEngine";
import { TableEngine } from "../../src/core/engines/TableEngine";
import { PaymentEngine } from "../../src/core/engines/PaymentEngine";
import { ReceiptEngine } from "../../src/core/engines/ReceiptEngine";
import { CustomerEngine } from "../../src/core/engines/CustomerEngine";
import { AlertEngine } from "../../src/core/engines/AlertEngine";
import { HealthEngine } from "../../src/core/engines/HealthEngine";
import { CartEngine } from "../../src/core/engines/CartEngine";
import { PosCore } from "../../src/core/engines/PosCore";

function buildContext() {
  const products = new FakeProductRepository();
  const tables = new InMemoryRepository<Table>("tables");
  const orders = new InMemoryRepository<any>("orders");
  const sales = new InMemoryRepository<Sale>("sales");
  const receipts = new InMemoryRepository<any>("receipts");
  const kitchenOrders = new InMemoryRepository<any>("kitchen_orders");
  const cashMovements = new InMemoryRepository<any>("cash_movements");
  const customers = new InMemoryRepository<any>("customers");
  const auditLogs = new InMemoryRepository<any>("audit_logs");

  const kardex = new KardexEngine(auditLogs as any);
  const inventory = new InventoryEngine(products as any, kardex);
  const kitchen = new KitchenEngine(kitchenOrders as any, new AuditEngine(auditLogs as any));
  const cash = new CashEngine(cashMovements as any);
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

  return { products, tables, salesEngine, tableEngine, kitchenOrders };
}

const HAMBURGUESA: Product = {
  id: "prod-hamburguesa",
  name: "Hamburguesa",
  price: 18000,
  stock: 100,
  minStock: 10,
  requiresKitchen: true,
  trackStock: true,
  isIngredient: false,
  active: true,
  categoryId: "Platos Fuertes",
  createdAt: new Date(),
  updatedAt: new Date()
};

const GASEOSA: Product = {
  id: "prod-gaseosa",
  name: "Gaseosa",
  price: 4000,
  stock: 200,
  minStock: 20,
  requiresKitchen: false,
  trackStock: true,
  isIngredient: false,
  active: true,
  categoryId: "Bebidas",
  createdAt: new Date(),
  updatedAt: new Date()
};

describe("Smoke: experiencia del mesero en VIMDY", () => {
  let ctx: ReturnType<typeof buildContext>;

  beforeEach(async () => {
    ctx = buildContext();
    await ctx.products.save(HAMBURGUESA);
    await ctx.products.save(GASEOSA);

    await ctx.tables.save({
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
    } as Table);
  });

  it("agrega productos con nota y la nota persiste en la mesa", async () => {
    await ctx.tableEngine.openTable({ tableId: "table-1", peopleCount: 2, waiterId: "w1" });
    await ctx.tableEngine.addItem({
      tableId: "table-1",
      product: HAMBURGUESA,
      quantity: 1,
      note: "sin arroz"
    });

    const table = await ctx.tableEngine.getTable("table-1");
    expect(table.items).toHaveLength(1);
    expect(table.items[0].note).toBe("sin arroz");
  });

  it("envía a cocina solo los productos que requieren cocina, ignorando notas", async () => {
    await ctx.tableEngine.openTable({ tableId: "table-1", peopleCount: 2, waiterId: "w1" });
    await ctx.tableEngine.addItem({
      tableId: "table-1",
      product: HAMBURGUESA,
      quantity: 1,
      note: "al punto"
    });
    await ctx.tableEngine.addItem({
      tableId: "table-1",
      product: GASEOSA,
      quantity: 2,
      note: "con hielo"
    });

    await ctx.tableEngine.sendToKitchen("table-1");

    const kitchenOrders = await ctx.kitchenOrders.findAll();
    expect(kitchenOrders).toHaveLength(1);
    expect(kitchenOrders[0].items).toHaveLength(1);
    expect(kitchenOrders[0].items[0].productId).toBe(HAMBURGUESA.id);
  });

  it("cobrar mesa con items con nota genera la venta correcta", async () => {
    await ctx.tableEngine.openTable({ tableId: "table-1", peopleCount: 2, waiterId: "w1" });
    await ctx.tableEngine.addItem({
      tableId: "table-1",
      product: HAMBURGUESA,
      quantity: 1,
      note: "sin arroz"
    });

    const { sale } = await ctx.tableEngine.closeTable({
      tableId: "table-1",
      method: "CASH",
      cashierId: "c1"
    });

    expect(sale.items).toHaveLength(1);
    expect(sale.items[0].note).toBe("sin arroz");
  });
});
