// tests/smoke/mesa-cobro-digital.test.ts
/* ===========================================================================
   Cobro digital de mesas (Wompi) — contrato del TableEngine
   ---------------------------------------------------------------------------
   - prepareTableSaleForPayment() crea la venta pendiente SIN cobrarla y es
     idempotente (mismo resultado al repetirse).
   - Si la cuenta cambia después de iniciar un cobro pendiente, NO se reutiliza
     la venta vieja (evita cobrar un monto desactualizado).
   - confirmTableExternalPayment() nunca cierra la mesa si la venta no figura
     como pagada en la base de datos.
=========================================================================== */

import { describe, it, expect, beforeEach } from "vitest";
import { operationConfigStore } from "../../src/core/store/operationConfigStore";
import { kitchenOutputModeStore } from "../../src/core/store/kitchenOutputModeStore";
import { DEFAULT_OPERATION_CONFIG } from "../../src/core/config/operation";

import {
  Product,
  Sale,
  Table,
  CashMovement,
  KitchenOrder,
  Order
} from "../../src/core/entities/Entities";

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

const BEER: Product = {
  id: "prod-beer",
  name: "Cerveza",
  categoryId: "cat-bebidas",
  price: 6000,
  stock: 30,
  minStock: 5,
  lastUpdated: new Date(),
  requiresKitchen: false
};

const DESSERT: Product = {
  id: "prod-dessert",
  name: "Postre",
  categoryId: "cat-postres",
  price: 8000,
  stock: 10,
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
  const tables = new InMemoryRepository<Table>("tables");
  const orders = new InMemoryRepository<Order>("orders");

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

  return {
    products,
    salesEngine,
    tableEngine,
    orderEngine,
    kitchenOrders,
    cashMovements,
    tables,
    orders,
    inventory,
    cart,
    kitchenEngine: kitchen
  };
}


describe("Mesas — cobro digital (Wompi)", () => {
  let ctx: ReturnType<typeof buildContext>;

  beforeEach(async () => {
    operationConfigStore.set({
      ...DEFAULT_OPERATION_CONFIG,
      kitchenEnabled: true,
      kitchenOutputMode: "kds",
      kdsEnabled: true,
      salesChannels: ["presencial"]
    });
    kitchenOutputModeStore.set("pantalla");
    ctx = buildContext();
    await ctx.products.save(BURGER);
    await ctx.products.save(SODA);

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

    await ctx.tableEngine.openTable({ tableId: "table-1", peopleCount: 2, waiterId: "waiter-1" });
    await ctx.tableEngine.addItem({ tableId: "table-1", product: BURGER, quantity: 1 });
  });

  it("prepara la venta pendiente sin cobrarla y es idempotente", async () => {
    const first = await ctx.tableEngine.prepareTableSaleForPayment({ tableId: "table-1", cashierId: "cashier-1" });
    const second = await ctx.tableEngine.prepareTableSaleForPayment({ tableId: "table-1", cashierId: "cashier-1" });

    expect(second.id).toBe(first.id);
    expect(String(first.status)).not.toBe("PAID");

    const sales = await ctx.salesEngine.getAllSales();
    expect(sales).toHaveLength(1);

    const table = await ctx.tableEngine.getTable("table-1");
    expect(table?.status).not.toBe("FREE");
  });

  it("no reutiliza una venta pendiente si la cuenta de la mesa cambió", async () => {
    await ctx.tableEngine.prepareTableSaleForPayment({ tableId: "table-1", cashierId: "cashier-1" });

    await ctx.tableEngine.addItem({ tableId: "table-1", product: SODA, quantity: 1 });

    await expect(
      ctx.tableEngine.prepareTableSaleForPayment({ tableId: "table-1", cashierId: "cashier-1" })
    ).rejects.toThrow("TABLE_SALE_STALE");

    const sales = await ctx.salesEngine.getAllSales();
    expect(sales).toHaveLength(1);
  });

  it("no cierra la mesa si el pago todavía no figura como pagado", async () => {
    const sale = await ctx.tableEngine.prepareTableSaleForPayment({ tableId: "table-1", cashierId: "cashier-1" });

    await expect(
      ctx.tableEngine.confirmTableExternalPayment({ tableId: "table-1", saleId: sale.id, method: "CARD" })
    ).rejects.toThrow("TABLE_PAYMENT_PENDING_VERIFICATION");

    const table = await ctx.tableEngine.getTable("table-1");
    expect(table?.status).not.toBe("FREE");
    expect(table?.items).toHaveLength(1);
  });

  it("cierra la mesa cuando la venta ya figura pagada (confirmada por el proveedor)", async () => {
    const sale = await ctx.tableEngine.prepareTableSaleForPayment({ tableId: "table-1", cashierId: "cashier-1" });

    // Simula lo que hace finalize_wompi_sale_payment_atomic en la base de datos.
    await ctx.salesEngine.updateSale({ ...sale, status: "PAID" });

    const { sale: paid, receipt } = await ctx.tableEngine.confirmTableExternalPayment({
      tableId: "table-1",
      saleId: sale.id,
      method: "CARD"
    });

    expect(String(paid.status)).toBe("PAID");
    expect(receipt).toBeDefined();

    const table = await ctx.tableEngine.getTable("table-1");
    expect(table?.status).toBe("FREE");
    expect(table?.items).toHaveLength(0);
  });
});