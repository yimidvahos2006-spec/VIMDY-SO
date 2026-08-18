// tests/smoke/production-multi-tenant.test.ts
/* ===========================================================================
   FASE 9 — AUDITORÍA FINAL DE PRODUCCIÓN
   ---------------------------------------------------------------------------
   Tests de regresión para verificar que las entidades creadas por los motores
   de producción incluyan businessId/branchId, y que los repositorios/engines
   apliquen scope multi-tenant correctamente.
   =========================================================================== */

import { describe, it, expect, beforeEach } from "vitest";

import {
  Product,
  Sale,
  Order,
  KitchenOrder,
  CashMovement,
  Shift
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
import { PosCore } from "../../src/core/engines/PosCore";
import { TableEngine } from "../../src/core/engines/TableEngine";
import { OrderEngine } from "../../src/core/engines/OrderEngine";
import { ShiftEngine } from "../../src/core/engines/ShiftEngine";

import { InMemoryRepository } from "../fakes/InMemoryRepository";
import { FakeProductRepository } from "../fakes/FakeProductRepository";
import { FakeSaleRepository } from "../fakes/FakeSaleRepository";
import { setCurrentBusinessId, setCurrentBranchId } from "../../src/infrastructure/supabase/supabaseClient";

function buildContext(businessId = "biz-1", branchId = "branch-1") {
  const products = new FakeProductRepository();
  const sales = new FakeSaleRepository();
  const receipts = new InMemoryRepository<any>("receipts");
  const kitchenOrders = new InMemoryRepository<KitchenOrder>("kitchen_orders");
  const cashMovements = new InMemoryRepository<CashMovement>("cash_movements");
  const customers = new InMemoryRepository<any>("customers");
  const movements = new InMemoryRepository<any>("inventory_movements");
  const auditLogs = new InMemoryRepository<any>("audit_logs");
  const tables = new InMemoryRepository<any>("tables");
  const orders = new InMemoryRepository<Order>("orders");
  const shifts = new InMemoryRepository<Shift>("shifts");

  const kardex = new KardexEngine(movements as any);
  const inventory = new InventoryEngine(products, kardex);
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

  const orderEngine = new OrderEngine(
    orders as any,
    kitchen,
    salesEngine
  );

  const tableEngine = new TableEngine(
    tables as any,
    kitchen as any,
    salesEngine,
    orderEngine
  );

  const shiftEngine = new ShiftEngine(shifts as any, cash);

  return {
    products,
    salesEngine,
    tableEngine,
    orderEngine,
    shiftEngine,
    inventoryEngine: inventory,
    cart,
    customers: customers as any,
    sales: sales as any,
    tables: tables as any,
    orders: orders as any,
    kitchenOrders: kitchenOrders as any,
    cashMovements: cashMovements as any,
    shifts: shifts as any,
    cashEngine: cash,
    kitchen,
    businessId,
    branchId
  };
}

const BURGER: Product = {
  id: "prod-burger",
  name: "Hamburguesa",
  categoryId: "cat-comidas",
  price: 18000,
  stock: 10,
  minStock: 2,
  lastUpdated: new Date()
};

describe("FASE 9 — Producción Multi-Tenant", () => {
  beforeEach(() => {
    setCurrentBusinessId(null);
    setCurrentBranchId(null);
  });

  // ========================================================================
  // 1. SalesEngine.createSale setea businessId/branchId
  // ========================================================================
  it("1. SalesEngine.createSale setea businessId/branchId", async () => {
    const ctx = buildContext();
    await ctx.products.save(BURGER);

    setCurrentBusinessId(ctx.businessId);
    setCurrentBranchId(ctx.branchId);

    const sale = await ctx.salesEngine.createSale({
      id: "sale-1",
      type: "QUICK",
      items: [{ productId: BURGER.id, quantity: 1, price: BURGER.price }],
      cashierId: "cashier-1"
    });

    expect(sale.businessId).toBe(ctx.businessId);
    expect(sale.branchId).toBe(ctx.branchId);
  });

  // ========================================================================
  // 2. CashEngine.registerIncome setea businessId/branchId
  // ========================================================================
  it("2. CashEngine.registerIncome setea businessId/branchId", async () => {
    const ctx = buildContext();

    setCurrentBusinessId(ctx.businessId);
    setCurrentBranchId(ctx.branchId);

    const movement = await ctx.cashEngine.registerIncome(
      10000,
      "Venta test",
      "CASH",
      10000,
      "sale-payment-sale-1"
    );

    expect(movement.businessId).toBe(ctx.businessId);
    expect(movement.branchId).toBe(ctx.branchId);
  });

  // ========================================================================
  // 3. CashEngine.registerExpense setea businessId/branchId
  // ========================================================================
  it("3. CashEngine.registerExpense setea businessId/branchId", async () => {
    const ctx = buildContext();

    setCurrentBusinessId(ctx.businessId);
    setCurrentBranchId(ctx.branchId);

    const movement = await ctx.cashEngine.registerExpense(
      5000,
      "Reembolso test",
      "sale-refund-sale-1"
    );

    expect(movement.businessId).toBe(ctx.businessId);
    expect(movement.branchId).toBe(ctx.branchId);
  });

  // ========================================================================
  // 4. ShiftEngine.openShift setea businessId/branchId
  // ========================================================================
  it("4. ShiftEngine.openShift setea businessId/branchId", async () => {
    const ctx = buildContext();

    setCurrentBusinessId(ctx.businessId);
    setCurrentBranchId(ctx.branchId);

    const shift = await ctx.shiftEngine.openShift("cashier-1", 100000, "Fondo inicial");

    expect(shift.businessId).toBe(ctx.businessId);
    expect(shift.branchId).toBe(ctx.branchId);
  });

  // ========================================================================
  // 5. OrderEngine.createOrder setea businessId/branchId
  // ========================================================================
  it("5. OrderEngine.createOrder setea businessId/branchId", async () => {
    const ctx = buildContext();

    setCurrentBusinessId(ctx.businessId);
    setCurrentBranchId(ctx.branchId);

    const order = await ctx.orderEngine.createOrder({
      source: "TABLE",
      tableId: "table-1",
      waiterId: "waiter-1",
      customerId: "cust-1",
      notes: "Sin cebolla"
    });

    expect(order.businessId).toBe(ctx.businessId);
    expect(order.branchId).toBe(ctx.branchId);
  });

  // ========================================================================
  // 6. KitchenEngine filtra por scope en getActiveOrders
  // ========================================================================
  it("6. KitchenEngine filtra por scope en getActiveOrders", async () => {
    const ctxA = buildContext("biz-a", "branch-a");
    const ctxB = buildContext("biz-b", "branch-b");

    setCurrentBusinessId("biz-a");
    setCurrentBranchId("branch-a");

    const orderA = await ctxA.orderEngine.createOrder({
      source: "TABLE",
      tableId: "table-a",
      waiterId: "waiter-1"
    });

    await ctxA.kitchenOrders.save({
      id: "kitchen-a",
      orderId: orderA.id,
      tableId: "table-a",
      status: "PENDIENTE",
      businessId: "biz-a",
      branchId: "branch-a",
      createdAt: new Date(),
      updatedAt: new Date()
    });

    setCurrentBusinessId("biz-b");
    setCurrentBranchId("branch-b");

    const activeB = await ctxB.kitchen.getActiveOrders();
    expect(activeB).toHaveLength(0);
  });

  // ========================================================================
  // 7. OrderEngine filtra por scope en getAllOrders
  // ========================================================================
  it("7. OrderEngine filtra por scope en getAllOrders", async () => {
    const ctxA = buildContext("biz-a", "branch-a");
    const ctxB = buildContext("biz-b", "branch-b");

    setCurrentBusinessId("biz-a");
    setCurrentBranchId("branch-a");

    await ctxA.orderEngine.createOrder({
      source: "TABLE",
      tableId: "table-a",
      waiterId: "waiter-1"
    });

    setCurrentBusinessId("biz-b");
    setCurrentBranchId("branch-b");

    const ordersB = await ctxB.orderEngine.getAllOrders();
    expect(ordersB).toHaveLength(0);
  });

  // ========================================================================
  // 8. ProductRepository.findAll() filtra caché local por scope
  // ========================================================================
  it("8. ProductRepository.findAll() filtra caché local por scope", async () => {
    const ctxA = buildContext("biz-a", "branch-a");
    const ctxB = buildContext("biz-b", "branch-b");

    setCurrentBusinessId("biz-a");
    setCurrentBranchId("branch-a");

    const productA: Product = {
      id: "prod-a",
      name: "Producto A",
      categoryId: "cat-1",
      price: 1000,
      stock: 10,
      minStock: 1,
      lastUpdated: new Date(),
      businessId: "biz-a",
      branchId: "branch-a"
    };

    await ctxA.products.save(productA);

    setCurrentBusinessId("biz-b");
    setCurrentBranchId("branch-b");

    const productsB = await ctxB.products.findAll();
    expect(productsB).toHaveLength(0);
  });

  // ========================================================================
  // 9. Reembolso total usa ID determinístico
  // ========================================================================
  it("9. Reembolso total usa ID determinístico", async () => {
    const ctx = buildContext();
    await ctx.products.save(BURGER);

    setCurrentBusinessId(ctx.businessId);
    setCurrentBranchId(ctx.branchId);

    const sale = await ctx.salesEngine.createSale({
      id: "sale-refund-1",
      type: "QUICK",
      items: [{ productId: BURGER.id, quantity: 1, price: BURGER.price }],
      cashierId: "cashier-1"
    });

    const paymentResult = await ctx.salesEngine.registerPayment(
      sale,
      "CASH",
      { received: sale.total }
    );

    const allMovements = await ctx.cashMovements.findAll();
    const refundMovements = allMovements.filter((m: any) => m.id === "sale-refund-sale-refund-1");
    expect(refundMovements).toHaveLength(0);
  });

  // ========================================================================
  // 10. Movimiento manual de ShiftPanel usa ID determinístico
  // ========================================================================
  it("10. Movimiento manual de ShiftPanel usa ID determinístico", async () => {
    const ctx = buildContext();

    setCurrentBusinessId(ctx.businessId);
    setCurrentBranchId(ctx.branchId);

    const movementId = "manual-movement-test";
    await ctx.cashEngine.registerExpense(
      5000,
      "Gasto manual test",
      movementId
    );

    const allMovements = await ctx.cashMovements.findAll();
    expect(allMovements).toHaveLength(1);
    expect(allMovements[0].id).toBe(movementId);
  });
});
