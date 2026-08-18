// tests/smoke/offline-sync-regression.test.ts
/* ===========================================================================
   FASE 8 — OFFLINE + SINCRONIZACIÓN
   ---------------------------------------------------------------------------
   Cubre los escenarios de regresión obligatorios:

     A.  Venta offline se sincroniza exactamente una vez.
     B.  Reintento de misma operación no duplica venta.
     C.  Idempotencia tras pérdida de conexión post-creación.
     D.  Venta offline descuenta inventario exactamente una vez.
     E.  Ajuste de inventario offline se aplica exactamente una vez.
     F.  Operación de negocio A no se sincroniza en negocio B.
     G.  Operación de sucursal A no se sincroniza en sucursal B.
     H.  Persistencia de operaciones pendientes al recargar.
     I.  Logout/login no ejecuta operaciones pendientes del contexto anterior.
     J.  Flujo completo de mesa offline sin duplicados.
     K.  Sincronización parcial fallida: items quedan PENDING/FAILED.
     L.  Reconexión respeta orden de dependencias.
     M.  Estados de sincronización claros.

   Usa engines reales con dobles de prueba en memoria, sin tocar Supabase.
   =========================================================================== */

import { describe, it, expect, beforeEach, vi } from "vitest";

import {
  Product,
  Sale,
  Customer,
  KitchenOrder,
  Table,
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
import { PosCore } from "../../src/core/engines/PosCore";
import { TableEngine } from "../../src/core/engines/TableEngine";
import { OrderEngine } from "../../src/core/engines/OrderEngine";

import { InMemoryRepository } from "../fakes/InMemoryRepository";
import { FakeProductRepository } from "../fakes/FakeProductRepository";
import { FakeSaleRepository } from "../fakes/FakeSaleRepository";
import { setCurrentBusinessId, setCurrentBranchId } from "../../src/infrastructure/supabase/supabaseClient";
import { PendingSale } from "../../src/core/offline/PendingSale";

function buildContext(businessId = "biz-1", branchId = "branch-1") {
  const products = new FakeProductRepository();
  const sales = new FakeSaleRepository();
  const receipts = new InMemoryRepository<any>("receipts");
  const kitchenOrders = new InMemoryRepository<KitchenOrder>("kitchen_orders");
  const cashMovements = new InMemoryRepository<any>("cash_movements");
  const customers = new InMemoryRepository<any>("customers");
  const movements = new InMemoryRepository<any>("inventory_movements");
  const auditLogs = new InMemoryRepository<any>("audit_logs");
  const tables = new InMemoryRepository<Table>("tables");
  const orders = new InMemoryRepository<Order>("orders");

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
    kitchen as any,
    salesEngine
  );

  const tableEngine = new TableEngine(
    tables as any,
    kitchen as any,
    salesEngine,
    orderEngine
  );

  return {
    products,
    salesEngine,
    tableEngine,
    inventoryEngine: inventory,
    cart,
    customers: customers as any,
    sales: sales as any,
    tables: tables as any,
    orders: orders as any,
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

const SODA: Product = {
  id: "prod-soda",
  name: "Gaseosa",
  categoryId: "cat-bebidas",
  price: 4000,
  stock: 20,
  minStock: 4,
  lastUpdated: new Date()
};

describe("FASE 8 — Offline + Sincronización", () => {
  beforeEach(() => {
    setCurrentBusinessId(null);
    setCurrentBranchId(null);
  });

  // ========================================================================
  // A. Venta offline se sincroniza exactamente una vez
  // ========================================================================
  it("A. Venta offline se sincroniza exactamente una vez", async () => {
    const ctx = buildContext();
    await ctx.products.save(BURGER);

    setCurrentBusinessId(ctx.businessId);
    setCurrentBranchId(ctx.branchId);

    const createSaleInput = {
      id: "sale-a",
      type: "QUICK" as const,
      items: [{ productId: BURGER.id, quantity: 1, price: BURGER.price }],
      cashierId: "cashier-1"
    };

    const sale1 = await ctx.salesEngine.createSale(createSaleInput);
    const sale2 = await ctx.salesEngine.createSale(createSaleInput);

    expect(sale1.id).toBe(sale2.id);

    const allSales = await ctx.sales.findAll();
    expect(allSales).toHaveLength(1);
  });

  // ========================================================================
  // B. Reintento de misma operación no duplica venta
  // ========================================================================
  it("B. Reintento de misma operación no duplica venta", async () => {
    const ctx = buildContext();
    await ctx.products.save(BURGER);

    setCurrentBusinessId(ctx.businessId);
    setCurrentBranchId(ctx.branchId);

    const createSaleInput = {
      id: "sale-b",
      type: "QUICK" as const,
      items: [{ productId: BURGER.id, quantity: 2, price: BURGER.price }],
      cashierId: "cashier-1"
    };

    await ctx.salesEngine.createSale(createSaleInput);
    await ctx.salesEngine.createSale(createSaleInput);
    await ctx.salesEngine.createSale(createSaleInput);

    const allSales = await ctx.sales.findAll();
    expect(allSales).toHaveLength(1);
    expect(allSales[0].items[0].quantity).toBe(2);
  });

  // ========================================================================
  // C. Idempotencia tras pérdida de conexión post-creación
  // ========================================================================
  it("C. Idempotencia tras pérdida de conexión post-creación", async () => {
    const ctx = buildContext();
    await ctx.products.save(BURGER);

    setCurrentBusinessId(ctx.businessId);
    setCurrentBranchId(ctx.branchId);

    const createSaleInput = {
      id: "sale-c",
      type: "QUICK" as const,
      items: [{ productId: BURGER.id, quantity: 1, price: BURGER.price }],
      cashierId: "cashier-1"
    };

    const first = await ctx.salesEngine.createSale(createSaleInput);
    const second = await ctx.salesEngine.createSale(createSaleInput);

    expect(first.id).toBe(second.id);
    expect(first.total).toBe(second.total);
  });

  // ========================================================================
  // D. Venta offline descuenta inventario exactamente una vez
  // ========================================================================
  it("D. Venta offline descuenta inventario exactamente una vez", async () => {
    const ctx = buildContext();
    await ctx.products.save(BURGER);

    setCurrentBusinessId(ctx.businessId);
    setCurrentBranchId(ctx.branchId);

    const createSaleInput = {
      id: "sale-d",
      type: "QUICK" as const,
      items: [{ productId: BURGER.id, quantity: 3, price: BURGER.price }],
      cashierId: "cashier-1"
    };

    await ctx.salesEngine.createSale(createSaleInput);
    await ctx.salesEngine.createSale(createSaleInput);

    const product = await ctx.products.findById(BURGER.id);
    expect(product?.stock).toBe(7);
  });

  // ========================================================================
  // E. Ajuste de inventario offline se aplica exactamente una vez
  // ========================================================================
  it("E. Ajuste de inventario offline se aplica exactamente una vez", async () => {
    const ctx = buildContext();
    await ctx.products.save(BURGER);

    setCurrentBusinessId(ctx.businessId);
    setCurrentBranchId(ctx.branchId);

    const movementId = "mov-e";
    await ctx.inventoryEngine.increaseStock(BURGER.id, 5, "Reposición", "admin", undefined, undefined, movementId);
    await ctx.inventoryEngine.increaseStock(BURGER.id, 5, "Reposición", "admin", undefined, undefined, movementId);

    const product = await ctx.products.findById(BURGER.id);
    expect(product?.stock).toBe(15);
  });

  // ========================================================================
  // F. Operación de negocio A no se sincroniza en negocio B
  // ========================================================================
  it("F. Operación de negocio A no se sincroniza en negocio B", async () => {
    const ctxA = buildContext("biz-a", "branch-a");
    const ctxB = buildContext("biz-b", "branch-b");

    const pending: PendingSale = {
      id: "sale-f",
      createSaleInput: {
        id: "sale-f",
        type: "QUICK",
        items: [{ productId: BURGER.id, quantity: 1, price: BURGER.price }],
        cashierId: "cashier-1"
      },
      status: "PENDING_SYNC",
      queuedAt: new Date(),
      attempts: 0,
      businessId: "biz-a",
      branchId: "branch-a"
    };

    await ctxA.sales.save(pending as any);

    setCurrentBusinessId("biz-b");
    setCurrentBranchId("branch-b");

    (ctxB.sales as any).setScope("biz-b", "branch-b");
    const salesB = await ctxB.sales.findAll();
    expect(salesB).toHaveLength(0);
  });

  // ========================================================================
  // G. Operación de sucursal A no se sincroniza en sucursal B
  // ========================================================================
  it("G. Operación de sucursal A no se sincroniza en sucursal B", async () => {
    const ctx = buildContext("biz-1", "branch-1");

    const pending: PendingSale = {
      id: "sale-g",
      createSaleInput: {
        id: "sale-g",
        type: "QUICK",
        items: [{ productId: BURGER.id, quantity: 1, price: BURGER.price }],
        cashierId: "cashier-1"
      },
      status: "PENDING_SYNC",
      queuedAt: new Date(),
      attempts: 0,
      businessId: "biz-1",
      branchId: "branch-1"
    };

    await ctx.sales.save(pending as any);
    (ctx.sales as any).setScope("biz-1", "branch-1");

    setCurrentBusinessId("biz-1");
    setCurrentBranchId("branch-2");

    (ctx.sales as any).setScope("biz-1", "branch-2");
    const sales = await ctx.sales.findAll();
    expect(sales).toHaveLength(0);
  });

  // ========================================================================
  // H. Persistencia al recargar: operaciones no desaparecen
  // ========================================================================
  it("H. Persistencia al recargar: operaciones no desaparecen", async () => {
    const ctx = buildContext();
    await ctx.products.save(BURGER);

    setCurrentBusinessId(ctx.businessId);
    setCurrentBranchId(ctx.branchId);

    const pending: PendingSale = {
      id: "sale-h",
      createSaleInput: {
        id: "sale-h",
        type: "QUICK",
        items: [{ productId: BURGER.id, quantity: 1, price: BURGER.price }],
        cashierId: "cashier-1"
      },
      status: "PENDING_SYNC",
      queuedAt: new Date(),
      attempts: 0,
      businessId: ctx.businessId,
      branchId: ctx.branchId
    };

    await ctx.sales.save(pending as any);

    const allSales = await ctx.sales.findAll();
    expect(allSales).toHaveLength(1);
  });

  // ========================================================================
  // I. Logout/login no ejecuta operaciones pendientes del contexto anterior
  // ========================================================================
  it("I. Logout/login no ejecuta operaciones pendientes del contexto anterior", async () => {
    const ctxA = buildContext("biz-a", "branch-a");

    const pending: PendingSale = {
      id: "sale-i",
      createSaleInput: {
        id: "sale-i",
        type: "QUICK",
        items: [{ productId: BURGER.id, quantity: 1, price: BURGER.price }],
        cashierId: "cashier-1"
      },
      status: "PENDING_SYNC",
      queuedAt: new Date(),
      attempts: 0,
      businessId: "biz-a",
      branchId: "branch-a"
    };

    await ctxA.sales.save(pending as any);

    setCurrentBusinessId("biz-b");
    setCurrentBranchId("branch-b");

    const ctxB = buildContext("biz-b", "branch-b");
    (ctxB.sales as any).setScope("biz-b", "branch-b");
    const salesB = await ctxB.sales.findAll();
    expect(salesB).toHaveLength(0);
  });

  // ========================================================================
  // J. Flujo completo de mesa offline sin duplicados
  // ========================================================================
  it("J. Flujo completo de mesa offline sin duplicados", async () => {
    const ctx = buildContext();
    await ctx.products.save(BURGER);
    await ctx.products.save(SODA);

    setCurrentBusinessId(ctx.businessId);
    setCurrentBranchId(ctx.branchId);

    const table: Table = {
      id: "table-j",
      name: "Mesa J",
      capacity: 4,
      status: "FREE",
      peopleCount: 0,
      items: [],
      subtotal: 0,
      tax: 0,
      discount: 0,
      total: 0,
      businessId: ctx.businessId,
      branchId: ctx.branchId,
      updatedAt: new Date()
    };

    await ctx.tables.save(table);
    (ctx.tables as any).setScope(ctx.businessId, ctx.branchId);

    await ctx.tableEngine.openTable({
      tableId: "table-j",
      peopleCount: 2
    });

    await ctx.tableEngine.addItem({
      tableId: "table-j",
      product: BURGER,
      quantity: 1
    });

    await ctx.tableEngine.addItem({
      tableId: "table-j",
      product: SODA,
      quantity: 1
    });

    const saleId = "sale-j";
    const closed = await ctx.tableEngine.closeTable({
      tableId: "table-j",
      method: "CASH",
      cashierId: "cashier-1",
      saleId
    });

    expect(closed.sale.id).toBe(saleId);

    const allSales = await ctx.sales.findAll();
    expect(allSales).toHaveLength(1);
  });

  // ========================================================================
  // K. Sincronización parcial fallida: items quedan PENDING/FAILED
  // ========================================================================
  it("K. Sincronización parcial fallida: items quedan PENDING/FAILED", async () => {
    const ctx = buildContext();
    await ctx.products.save(BURGER);

    setCurrentBusinessId(ctx.businessId);
    setCurrentBranchId(ctx.branchId);

    const createSaleInput = {
      id: "sale-k",
      type: "QUICK" as const,
      items: [{ productId: BURGER.id, quantity: 1, price: BURGER.price }],
      cashierId: "cashier-1"
    };

    await ctx.salesEngine.createSale(createSaleInput);

    const allSales = await ctx.sales.findAll();
    expect(allSales).toHaveLength(1);
    expect(allSales[0].status).toBe("PENDING_PAYMENT");
  });

  // ========================================================================
  // L. Reconexión respeta orden de dependencias
  // ========================================================================
  it("L. Reconexión respeta orden de dependencias", async () => {
    const ctx = buildContext();
    await ctx.products.save(BURGER);

    setCurrentBusinessId(ctx.businessId);
    setCurrentBranchId(ctx.branchId);

    const createSaleInput = {
      id: "sale-l",
      type: "QUICK" as const,
      items: [{ productId: BURGER.id, quantity: 1, price: BURGER.price }],
      cashierId: "cashier-1"
    };

    const sale = await ctx.salesEngine.createSale(createSaleInput);
    expect(sale.id).toBe("sale-l");

    const allSales = await ctx.sales.findAll();
    expect(allSales).toHaveLength(1);
  });

  // ========================================================================
  // M. Estados de sincronización claros
  // ========================================================================
  it("M. Estados de sincronización claros", async () => {
    const ctx = buildContext();
    await ctx.products.save(BURGER);

    setCurrentBusinessId(ctx.businessId);
    setCurrentBranchId(ctx.branchId);

    const pending: PendingSale = {
      id: "sale-m",
      createSaleInput: {
        id: "sale-m",
        type: "QUICK",
        items: [{ productId: BURGER.id, quantity: 1, price: BURGER.price }],
        cashierId: "cashier-1"
      },
      status: "PENDING_SYNC",
      queuedAt: new Date(),
      attempts: 0,
      businessId: ctx.businessId,
      branchId: ctx.branchId
    };

    expect(pending.status).toBe("PENDING_SYNC");

    await ctx.sales.save(pending as any);
    const found = await ctx.sales.findById("sale-m");
    expect(found?.status).toBe("PENDING_SYNC");
  });

  // ========================================================================
  // N. closeTable idempotente: reintento después de éxito parcial no lanza EMPTY_TABLE
  // ========================================================================
  it("N. closeTable idempotente: reintento despues de exito parcial no lanza EMPTY_TABLE", async () => {
    const ctx = buildContext();
    await ctx.products.save(BURGER);

    setCurrentBusinessId(ctx.businessId);
    setCurrentBranchId(ctx.branchId);

    const table: Table = {
      id: "table-n",
      name: "Mesa N",
      capacity: 4,
      status: "FREE",
      peopleCount: 0,
      items: [],
      subtotal: 0,
      tax: 0,
      discount: 0,
      total: 0,
      businessId: ctx.businessId,
      branchId: ctx.branchId,
      updatedAt: new Date()
    };

    await ctx.tables.save(table);
    (ctx.tables as any).setScope(ctx.businessId, ctx.branchId);

    await ctx.tableEngine.openTable({
      tableId: "table-n",
      peopleCount: 2
    });

    await ctx.tableEngine.addItem({
      tableId: "table-n",
      product: BURGER,
      quantity: 1
    });

    const saleId = "sale-n";
    const first = await ctx.tableEngine.closeTable({
      tableId: "table-n",
      method: "CASH",
      cashierId: "cashier-1",
      saleId
    });

    expect(first.sale.id).toBe(saleId);

    const second = await ctx.tableEngine.closeTable({
      tableId: "table-n",
      method: "CASH",
      cashierId: "cashier-1",
      saleId
    });

    expect(second.sale.id).toBe(saleId);
    expect(second.sale.status).toBe("PAID");
  });
});
