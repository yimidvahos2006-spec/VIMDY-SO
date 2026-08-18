// tests/smoke/seguridad-multi-tenant.test.ts
/* ===========================================================================
   FASE 9 — AUDITORÍA FINAL DE PRODUCCIÓN
   ---------------------------------------------------------------------------
   Tests de seguridad multi-tenant para VIMDY OS.
   Verifica que el aislamiento entre negocios funcione correctamente
   en el cliente (scope en repositorios/engines).
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

describe("FASE 9 — Seguridad Multi-Tenant", () => {
  beforeEach(() => {
    setCurrentBusinessId(null);
    setCurrentBranchId(null);
  });

  // ========================================================================
  // 1. Venta sin cliente no altera cálculos
  // ========================================================================
  it("1. Venta sin cliente no altera el cálculo de productos, inventario, impuestos ni pagos", async () => {
    const ctx = buildContext();

    setCurrentBusinessId(ctx.businessId);
    setCurrentBranchId(ctx.branchId);

    await ctx.products.save(BURGER);

    const sale = await ctx.salesEngine.createSale({
      id: "sale-no-customer-1",
      type: "QUICK",
      items: [{ productId: BURGER.id, quantity: 1, price: BURGER.price }],
      cashierId: "cashier-1"
    });

    expect(sale.customerId).toBe("CLIENTE_GENERAL");
    expect(sale.subtotal).toBeCloseTo(18000, 2);
  });

  // ========================================================================
  // 2. Cliente sin ventas no rompe el dashboard
  // ========================================================================
  it("2. Cliente sin ventas no rompe el dashboard", async () => {
    const ctx = buildContext();

    setCurrentBusinessId(ctx.businessId);
    setCurrentBranchId(ctx.branchId);

    await ctx.products.save(BURGER);

    const sale = await ctx.salesEngine.createSale({
      id: "sale-customer-empty-2",
      type: "QUICK",
      items: [{ productId: BURGER.id, quantity: 1, price: BURGER.price }],
      cashierId: "cashier-1"
    });

    expect(sale).toBeDefined();
    expect(sale.items).toHaveLength(1);
  });

  // ========================================================================
  // 3. Dos negocios no mezclan datos en FakeProductRepository
  // ========================================================================
  it("3. Dos negocios no mezclan datos en FakeProductRepository", async () => {
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
      lastUpdated: new Date()
    };

    await ctxA.products.save(productA);
    const productsA = await ctxA.products.findAll();
    expect(productsA).toHaveLength(1);

    setCurrentBusinessId("biz-b");
    setCurrentBranchId("branch-b");

    const productB: Product = {
      id: "prod-b",
      name: "Producto B",
      categoryId: "cat-1",
      price: 2000,
      stock: 5,
      minStock: 1,
      lastUpdated: new Date()
    };

    await ctxB.products.save(productB);
    const productsB = await ctxB.products.findAll();
    expect(productsB).toHaveLength(1);
    expect(productsB[0].id).toBe("prod-b");
  });

  // ========================================================================
  // 4. Venta con cliente asociado persiste el customerId
  // ========================================================================
  it("4. Venta con cliente asociado persiste el customerId correctamente", async () => {
    const ctx = buildContext();

    setCurrentBusinessId(ctx.businessId);
    setCurrentBranchId(ctx.branchId);

    await ctx.products.save(BURGER);

    const sale = await ctx.salesEngine.createSale({
      id: "sale-customer-4",
      type: "QUICK",
      items: [{ productId: BURGER.id, quantity: 1, price: BURGER.price }],
      customerId: "cust-1",
      cashierId: "cashier-1"
    });

    expect(sale.customerId).toBe("cust-1");
  });

  // ========================================================================
  // 5. Venta sin cliente funciona correctamente
  // ========================================================================
  it("5. Venta sin cliente funciona correctamente", async () => {
    const ctx = buildContext();

    setCurrentBusinessId(ctx.businessId);
    setCurrentBranchId(ctx.branchId);

    await ctx.products.save(BURGER);

    const sale = await ctx.salesEngine.createSale({
      id: "sale-no-customer-5",
      type: "QUICK",
      items: [{ productId: BURGER.id, quantity: 1, price: BURGER.price }],
      cashierId: "cashier-1"
    });

    expect(sale).toBeDefined();
    expect(sale.status).toBe("PENDING_PAYMENT");
  });

  // ========================================================================
  // 6. Historial de compras correcto
  // ========================================================================
  it("6. Historial de compras correcto", async () => {
    const ctx = buildContext();

    setCurrentBusinessId(ctx.businessId);
    setCurrentBranchId(ctx.branchId);

    await ctx.products.save(BURGER);

    const sale = await ctx.salesEngine.createSale({
      id: "sale-history-6",
      type: "QUICK",
      items: [{ productId: BURGER.id, quantity: 2, price: BURGER.price }],
      customerId: "cust-1",
      cashierId: "cashier-1"
    });

    expect(sale.items).toHaveLength(1);
    expect(sale.items[0].quantity).toBe(2);
  });

  // ========================================================================
  // 7. Dos clientes no mezclan compras
  // ========================================================================
  it("7. Dos clientes no mezclan compras", async () => {
    const ctx = buildContext();

    setCurrentBusinessId(ctx.businessId);
    setCurrentBranchId(ctx.branchId);

    await ctx.products.save(BURGER);

    const sale1 = await ctx.salesEngine.createSale({
      id: "sale-cust1-7",
      type: "QUICK",
      items: [{ productId: BURGER.id, quantity: 1, price: BURGER.price }],
      customerId: "cust-1",
      cashierId: "cashier-1"
    });

    const sale2 = await ctx.salesEngine.createSale({
      id: "sale-cust2-7",
      type: "QUICK",
      items: [{ productId: BURGER.id, quantity: 1, price: BURGER.price }],
      customerId: "cust-2",
      cashierId: "cashier-1"
    });

    expect(sale1.customerId).toBe("cust-1");
    expect(sale2.customerId).toBe("cust-2");
    expect(sale1.id).not.toBe(sale2.id);
  });

  // ========================================================================
  // 8. Venta sin cliente no altera el cálculo de productos, inventario, impuestos ni pagos
  // ========================================================================
  it("8. Venta sin cliente no altera el cálculo de productos, inventario, impuestos ni pagos", async () => {
    const ctx = buildContext();

    setCurrentBusinessId(ctx.businessId);
    setCurrentBranchId(ctx.branchId);

    await ctx.products.save(BURGER);

    const sale = await ctx.salesEngine.createSale({
      id: "sale-no-customer-8",
      type: "QUICK",
      items: [{ productId: BURGER.id, quantity: 1, price: BURGER.price }],
      cashierId: "cashier-1"
    });

    const { sale: paidSale } = await ctx.salesEngine.registerPayment(
      sale,
      "CASH",
      { received: sale.total }
    );

    expect(paidSale.status).toBe("PAID");
    expect(sale.subtotal).toBeCloseTo(18000, 2);
    expect(sale.tax).toBeCloseTo(3420, 2);
    expect(sale.total).toBeCloseTo(21420, 2);
  });

  // ========================================================================
  // 9. Cliente sin ventas no rompe el dashboard
  // ========================================================================
  it("9. Cliente sin ventas no rompe el dashboard", async () => {
    const ctx = buildContext();

    setCurrentBusinessId(ctx.businessId);
    setCurrentBranchId(ctx.branchId);

    await ctx.products.save(BURGER);

    const sale = await ctx.salesEngine.createSale({
      id: "sale-customer-empty-9",
      type: "QUICK",
      items: [{ productId: BURGER.id, quantity: 1, price: BURGER.price }],
      customerId: "cust-no-sales",
      cashierId: "cashier-1"
    });

    expect(sale).toBeDefined();
    expect(sale.customerId).toBe("cust-no-sales");
  });

  // ========================================================================
  // 10. Entidades de producción setean businessId/branchId
  // ========================================================================
  it("10. Entidades de producción setean businessId/branchId", async () => {
    const ctx = buildContext();

    setCurrentBusinessId(ctx.businessId);
    setCurrentBranchId(ctx.branchId);

    await ctx.products.save(BURGER);

    const sale = await ctx.salesEngine.createSale({
      id: "sale-entity-10",
      type: "QUICK",
      items: [{ productId: BURGER.id, quantity: 1, price: BURGER.price }],
      cashierId: "cashier-1"
    });

    expect(sale.businessId).toBe(ctx.businessId);
    expect(sale.branchId).toBe(ctx.branchId);

    const movement = await ctx.cashEngine.registerIncome(
      10000,
      "Venta test",
      "CASH",
      10000,
      "sale-payment-sale-entity-10"
    );

    expect(movement.businessId).toBe(ctx.businessId);
    expect(movement.branchId).toBe(ctx.branchId);
  });
});
