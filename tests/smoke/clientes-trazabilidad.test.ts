// tests/smoke/clientes-trazabilidad.test.ts
/* ===========================================================================
   FASE 6 — CLIENTES + TRAZABILIDAD DE VENTAS
   ---------------------------------------------------------------------------
   Cubre los escenarios obligatorios:

     1.  Crear cliente.
     2.  Editar cliente.
     3.  Buscar cliente.
     4.  Asociar cliente a venta.
     5.  Venta sin cliente.
     6.  Historial correcto.
     7.  Dos clientes no mezclan compras.
     8.  Dos negocios no comparten clientes.
     9.  Dos sucursales no mezclan clientes.
    10.  Reintento/idempotencia.
    11.  La venta sigue funcionando aunque no tenga cliente.
    12.  El dashboard recibe datos provenientes de ventas reales.

   Todos usan engines reales con dobles de prueba en memoria, sin tocar
   Supabase.
   =========================================================================== */

import { describe, it, expect, beforeEach } from "vitest";

import {
  Product,
  Sale,
  Customer,
  CashMovement,
  KitchenOrder,
  Alert
} from "../../src/core/entities/Entities";
import { Receipt } from "../../src/core/engines/ReceiptEngine";
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
import { DashboardEngine } from "../../src/core/engines/DashboardEngine";
import { AIEngine } from "../../src/core/engines/AIEngine";
import { RecipeEngine } from "../../src/core/engines/RecipeEngine";

import { InMemoryRepository } from "../fakes/InMemoryRepository";
import { FakeProductRepository } from "../fakes/FakeProductRepository";
import { FakeSaleRepository } from "../fakes/FakeSaleRepository";
import { setCurrentBusinessId, setCurrentBranchId } from "../../src/infrastructure/supabase/supabaseClient";

function buildContext(businessId = "biz-1", branchId = "branch-1") {
  const products = new FakeProductRepository();
  const sales = new FakeSaleRepository();
  const receipts = new InMemoryRepository<Receipt>("receipts");
  const kitchenOrders = new InMemoryRepository<KitchenOrder>("kitchen_orders");
  const cashMovements = new InMemoryRepository<CashMovement>("cash_movements");
  const customers = new InMemoryRepository<Customer>("customers");
  const movements = new InMemoryRepository<any>("inventory_movements");
  const auditLogs = new InMemoryRepository<any>("audit_logs");
  const alerts = new InMemoryRepository<Alert>("alerts");

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

  const customerEngine = new CustomerEngine(customers as any, sales as any);
  const dashboardEngine = new DashboardEngine(
    products,
    sales as any,
    customers as any,
    kitchenOrders,
    alerts as any,
    new HealthEngine(),
    new AIEngine(),
    inventory,
    new RecipeEngine(products)
  );

  return {
    products,
    salesEngine,
    customerEngine,
    dashboardEngine,
    cart,
    cashMovements,
    customers: customers as any,
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

describe("FASE 6 — Clientes + Trazabilidad de ventas", () => {
  // ========================================================================
  // 1. Crear cliente
  // ========================================================================
  it("1. Crear cliente", async () => {
    const ctx = buildContext();
    await ctx.products.save(BURGER);

    const customer: Customer = {
      id: "cust-1",
      name: "Cliente Test",
      email: "test@test.com",
      phone: "3000000000",
      points: 0,
      createdAt: new Date(),
      businessId: ctx.businessId,
      branchId: ctx.branchId
    };

    await ctx.customerEngine.save(customer);

    const found = await ctx.customerEngine.getCustomerProfile(customer.id);
    expect(found.customer.id).toBe("cust-1");
    expect(found.customer.name).toBe("Cliente Test");
    expect(found.customer.businessId).toBe(ctx.businessId);
    expect(found.customer.branchId).toBe(ctx.branchId);
  });

  // ========================================================================
  // 2. Editar cliente
  // ========================================================================
  it("2. Editar cliente", async () => {
    const ctx = buildContext();

    const customer: Customer = {
      id: "cust-2",
      name: "Cliente Original",
      email: "orig@test.com",
      phone: "3000000000",
      points: 0,
      createdAt: new Date(),
      businessId: ctx.businessId,
      branchId: ctx.branchId
    };

    await ctx.customerEngine.save(customer);

    const updated: Customer = {
      ...customer,
      name: "Cliente Editado",
      phone: "3111111111"
    };

    await ctx.customerEngine.update(updated);

    const found = await ctx.customerEngine.getCustomerProfile(customer.id);
    expect(found.customer.name).toBe("Cliente Editado");
    expect(found.customer.phone).toBe("3111111111");
  });

  // ========================================================================
  // 3. Buscar cliente
  // ========================================================================
  it("3. Buscar cliente por nombre, teléfono o email", async () => {
    const ctx = buildContext();

    const customer: Customer = {
      id: "cust-3",
      name: "María García",
      email: "maria@test.com",
      phone: "3000000000",
      points: 0,
      createdAt: new Date(),
      businessId: ctx.businessId,
      branchId: ctx.branchId
    };

    await ctx.customerEngine.save(customer);
    await ctx.customers.save(customer);

    const all = await ctx.customerEngine.getAllCustomers();
    const found = all.filter(
      (c: any) =>
        c.name.toLowerCase().includes("maría") ||
        c.phone?.includes("3000000000") ||
        c.email?.includes("maria@test.com")
    );

    expect(found).toHaveLength(1);
    expect(found[0].id).toBe("cust-3");
  });

  // ========================================================================
  // 4. Asociar cliente a venta
  // ========================================================================
  it("4. Asociar cliente a venta", async () => {
    const ctx = buildContext();
    await ctx.products.save(BURGER);

    const customer: Customer = {
      id: "cust-4",
      name: "Cliente Venta",
      email: "venta@test.com",
      phone: "3000000000",
      points: 0,
      createdAt: new Date(),
      businessId: ctx.businessId,
      branchId: ctx.branchId
    };

    await ctx.customerEngine.save(customer);

    ctx.cart.addItem(BURGER, 1);
    const sale = await ctx.salesEngine.quickSale({
      cashierId: "cashier-1",
      customerId: customer.id
    });

    expect(sale.customerId).toBe(customer.id);

    const persisted = await ctx.salesEngine.getSale(sale.id);
    expect(persisted?.customerId).toBe(customer.id);
  });

  // ========================================================================
  // 5. Venta sin cliente
  // ========================================================================
  it("5. Venta sin cliente funciona correctamente", async () => {
    const ctx = buildContext();
    await ctx.products.save(BURGER);
    await ctx.products.save(SODA);

    ctx.cart.addItem(BURGER, 1);
    ctx.cart.addItem(SODA, 1);

    const sale = await ctx.salesEngine.quickSale({
      cashierId: "cashier-1"
    });

    expect(sale.customerId).toBe("CLIENTE_GENERAL");

    const persisted = await ctx.salesEngine.getSale(sale.id);
    expect(persisted?.customerId).toBe("CLIENTE_GENERAL");
  });

  // ========================================================================
  // 6. Historial correcto
  // ========================================================================
  it("6. Historial de compras correcto", async () => {
    const ctx = buildContext();
    await ctx.products.save(BURGER);
    await ctx.products.save(SODA);

    const customer: Customer = {
      id: "cust-6",
      name: "Cliente Historial",
      email: "hist@test.com",
      phone: "3000000000",
      points: 0,
      createdAt: new Date(),
      businessId: ctx.businessId,
      branchId: ctx.branchId
    };

    await ctx.customerEngine.save(customer);

    ctx.cart.addItem(BURGER, 1);
    const sale1 = await ctx.salesEngine.quickSale({
      cashierId: "cashier-1",
      customerId: customer.id
    });

    ctx.cart.clear();
    ctx.cart.addItem(SODA, 2);
    const sale2 = await ctx.salesEngine.quickSale({
      cashierId: "cashier-1",
      customerId: customer.id
    });

    const profile = await ctx.customerEngine.getCustomerProfile(customer.id);

    expect(profile.sales).toHaveLength(2);
    expect(profile.ltv).toBe(sale1.total + sale2.total);
    expect(profile.customer.id).toBe(customer.id);
  });

  // ========================================================================
  // 7. Dos clientes no mezclan compras
  // ========================================================================
  it("7. Dos clientes no mezclan compras", async () => {
    const ctx = buildContext();
    await ctx.products.save(BURGER);

    const customerA: Customer = {
      id: "cust-7a",
      name: "Cliente A",
      email: "a@test.com",
      phone: "3000000000",
      points: 0,
      createdAt: new Date(),
      businessId: ctx.businessId,
      branchId: ctx.branchId
    };

    const customerB: Customer = {
      id: "cust-7b",
      name: "Cliente B",
      email: "b@test.com",
      phone: "3111111111",
      points: 0,
      createdAt: new Date(),
      businessId: ctx.businessId,
      branchId: ctx.branchId
    };

    await ctx.customerEngine.save(customerA);
    await ctx.customerEngine.save(customerB);

    ctx.cart.addItem(BURGER, 1);
    const saleA = await ctx.salesEngine.quickSale({
      cashierId: "cashier-1",
      customerId: customerA.id
    });

    ctx.cart.clear();
    ctx.cart.addItem(BURGER, 1);
    const saleB = await ctx.salesEngine.quickSale({
      cashierId: "cashier-1",
      customerId: customerB.id
    });

    const salesA = await ctx.salesEngine.getSalesByCustomer(customerA.id);
    const salesB = await ctx.salesEngine.getSalesByCustomer(customerB.id);

    expect(salesA).toHaveLength(1);
    expect(salesA[0].id).toBe(saleA.id);
    expect(salesB).toHaveLength(1);
    expect(salesB[0].id).toBe(saleB.id);
  });

  // ========================================================================
  // 8. Dos negocios no comparten clientes
  // ========================================================================
  it("8. Dos negocios no comparten clientes", async () => {
    const ctxA = buildContext("biz-a", "branch-a");
    const ctxB = buildContext("biz-b", "branch-b");

    const customerA: Customer = {
      id: "cust-8a",
      name: "Cliente Negocio A",
      email: "a@test.com",
      phone: "3000000000",
      points: 0,
      createdAt: new Date(),
      businessId: "biz-a",
      branchId: "branch-a"
    };

    const customerB: Customer = {
      id: "cust-8b",
      name: "Cliente Negocio B",
      email: "b@test.com",
      phone: "3111111111",
      points: 0,
      createdAt: new Date(),
      businessId: "biz-b",
      branchId: "branch-b"
    };

    await ctxA.customerEngine.save(customerA);
    await ctxB.customerEngine.save(customerB);

    (ctxA.customers as any).setScope("biz-a", "branch-a");
    (ctxB.customers as any).setScope("biz-b", "branch-b");

    const allA = await ctxA.customerEngine.getAllCustomers();
    expect(allA).toHaveLength(1);
    expect(allA[0].id).toBe("cust-8a");

    const allB = await ctxB.customerEngine.getAllCustomers();
    expect(allB).toHaveLength(1);
    expect(allB[0].id).toBe("cust-8b");
  });

  // ========================================================================
  // 9. Dos sucursales no mezclan clientes
  // ========================================================================
  it("9. Dos sucursales no mezclan clientes", async () => {
    const ctx = buildContext("biz-1", "branch-1");

    const customer1: Customer = {
      id: "cust-9-1",
      name: "Cliente Sucursal 1",
      email: "s1@test.com",
      phone: "3000000000",
      points: 0,
      createdAt: new Date(),
      businessId: "biz-1",
      branchId: "branch-1"
    };

    const customer2: Customer = {
      id: "cust-9-2",
      name: "Cliente Sucursal 2",
      email: "s2@test.com",
      phone: "3111111111",
      points: 0,
      createdAt: new Date(),
      businessId: "biz-1",
      branchId: "branch-2"
    };

    await ctx.customerEngine.save(customer1);
    await ctx.customerEngine.save(customer2);

    (ctx.customers as any).setScope("biz-1", "branch-1");

    const all1 = await ctx.customerEngine.getAllCustomers();
    expect(all1).toHaveLength(1);
    expect(all1[0].id).toBe("cust-9-1");

    (ctx.customers as any).setScope("biz-1", "branch-2");

    const all2 = await ctx.customerEngine.getAllCustomers();
    expect(all2).toHaveLength(1);
    expect(all2[0].id).toBe("cust-9-2");
  });

  // ========================================================================
  // 10. Reintento / idempotencia
  // ========================================================================
  it("10. Reintento de creación de cliente no duplica", async () => {
    const ctx = buildContext();

    const customer: Customer = {
      id: "cust-10",
      name: "Cliente Idempotente",
      email: "idem@test.com",
      phone: "3000000000",
      points: 0,
      createdAt: new Date(),
      businessId: ctx.businessId,
      branchId: ctx.branchId
    };

    await ctx.customerEngine.save(customer);
    await ctx.customerEngine.save(customer);

    const all = await ctx.customerEngine.getAllCustomers();
    expect(all).toHaveLength(1);
    expect(all[0].id).toBe("cust-10");
  });

  // ========================================================================
  // 11. La venta sigue funcionando aunque no tenga cliente
  // ========================================================================
  it("11. La venta sigue funcionando aunque no tenga cliente", async () => {
    const ctx = buildContext();
    await ctx.products.save(BURGER);
    await ctx.products.save(SODA);

    ctx.cart.addItem(BURGER, 1);
    ctx.cart.addItem(SODA, 1);

    const sale = await ctx.salesEngine.quickSale({
      cashierId: "cashier-1",
      taxRate: 0
    });

    expect(sale.customerId).toBe("CLIENTE_GENERAL");
    expect(sale.items).toHaveLength(2);
    expect(sale.total).toBe(BURGER.price + SODA.price);
  });

  // ========================================================================
  // 12. El dashboard recibe datos provenientes de ventas reales
  // ========================================================================
  it("12. El dashboard recibe datos provenientes de ventas reales", async () => {
    const ctx = buildContext();
    await ctx.products.save(BURGER);

    const customer: Customer = {
      id: "cust-12",
      name: "Cliente Dashboard",
      email: "dash@test.com",
      phone: "3000000000",
      points: 0,
      createdAt: new Date(),
      businessId: ctx.businessId,
      branchId: ctx.branchId
    };

    await ctx.customerEngine.save(customer);

    ctx.cart.addItem(BURGER, 2);
    const sale = await ctx.salesEngine.quickSale({
      cashierId: "cashier-1",
      customerId: customer.id,
      taxRate: 0
    });

    const summary = await ctx.dashboardEngine.getExecutiveSummary();

    const totalSales = summary.sales.reduce((sum, sale) => sum + sale.total, 0);
    expect(totalSales).toBe(sale.total);
    expect(summary.customers).toHaveLength(1);
    expect(summary.customers[0].id).toBe(customer.id);
  });
});
