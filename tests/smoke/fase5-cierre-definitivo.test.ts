// tests/smoke/fase5-cierre-definitivo.test.ts
/* ===========================================================================
   FASE 5 — CIERRE DEFINITIVO: multi-tenant cocina, envío sin duplicados,
   atomicidad openTable/closeTable.
=========================================================================== */

import { describe, it, expect, beforeEach, vi } from "vitest";

import {
  Product,
  Sale,
  Table,
  CashMovement,
  KitchenOrder,
  Order,
  OrderStatus,
  InventoryMovement
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

function buildContext(businessId = "biz-1", branchId = "branch-1") {
  const products = new FakeProductRepository();
  const sales = new InMemoryRepository<Sale>("sales");
  const receipts = new InMemoryRepository("receipts");
  const kitchenOrders = new InMemoryRepository<KitchenOrder>("kitchen_orders");
  const cashMovements = new InMemoryRepository<CashMovement>("cash_movements");
  const customers = new InMemoryRepository("customers");
  const movements = new InMemoryRepository<InventoryMovement>("inventory_movements");
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
    businessId,
    branchId
  };
}

describe("FASE 5 — Cierre definitivo: cocina multi-tenant, envío sin duplicados, atomicidad", () => {
  // ========================================================================
  // 1. KITCHENORDER MULTI-TENANT
  // ========================================================================
  describe("KitchenOrder multi-tenant", () => {
    it("dos negocios no ven las comandas del otro", async () => {
      const ctxA = buildContext("biz-A", "branch-A");
      const ctxB = buildContext("biz-B", "branch-B");

      await ctxA.products.save(BURGER);
      await ctxB.products.save(BURGER);

      await ctxA.tables.save({
        id: "table-a",
        name: "Mesa A",
        capacity: 4,
        peopleCount: 0,
        status: "FREE",
        items: [],
        subtotal: 0,
        tax: 0,
        discount: 0,
        total: 0,
        businessId: "biz-A",
        branchId: "branch-A",
        updatedAt: new Date()
      } as Table);

      await ctxB.tables.save({
        id: "table-b",
        name: "Mesa B",
        capacity: 4,
        peopleCount: 0,
        status: "FREE",
        items: [],
        subtotal: 0,
        tax: 0,
        discount: 0,
        total: 0,
        businessId: "biz-B",
        branchId: "branch-B",
        updatedAt: new Date()
      } as Table);

      await ctxA.tableEngine.openTable({ tableId: "table-a", peopleCount: 2, waiterId: "w1" });
      await ctxA.tableEngine.addItem({ tableId: "table-a", product: BURGER, quantity: 1 });
      await ctxA.tableEngine.sendToKitchen("table-a");

      await ctxB.tableEngine.openTable({ tableId: "table-b", peopleCount: 2, waiterId: "w2" });
      await ctxB.tableEngine.addItem({ tableId: "table-b", product: BURGER, quantity: 1 });
      await ctxB.tableEngine.sendToKitchen("table-b");

      const ordersA = await ctxA.kitchenOrders.findAll();
      const ordersB = await ctxB.kitchenOrders.findAll();

      expect(ordersA).toHaveLength(1);
      expect(ordersB).toHaveLength(1);
      expect(ordersA[0].businessId).toBe("biz-A");
      expect(ordersB[0].businessId).toBe("biz-B");
    });

    it("dos sucursales no ven las comandas de la otra", async () => {
      const ctx = buildContext("biz-1", "branch-1");

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
        businessId: "biz-1",
        branchId: "branch-1",
        updatedAt: new Date()
      } as Table);

      await ctx.tables.save({
        id: "table-2",
        name: "Mesa 2",
        capacity: 4,
        peopleCount: 0,
        status: "FREE",
        items: [],
        subtotal: 0,
        tax: 0,
        discount: 0,
        total: 0,
        businessId: "biz-1",
        branchId: "branch-2",
        updatedAt: new Date()
      } as Table);

      await ctx.tableEngine.openTable({ tableId: "table-1", peopleCount: 2, waiterId: "w1" });
      await ctx.tableEngine.addItem({ tableId: "table-1", product: BURGER, quantity: 1 });
      await ctx.tableEngine.sendToKitchen("table-1");

      await ctx.tableEngine.openTable({ tableId: "table-2", peopleCount: 2, waiterId: "w2" });
      await ctx.tableEngine.addItem({ tableId: "table-2", product: BURGER, quantity: 1 });
      await ctx.tableEngine.sendToKitchen("table-2");

      const allOrders = await ctx.kitchenOrders.findAll();
      expect(allOrders).toHaveLength(2);
      expect(allOrders.map(o => o.branchId).sort()).toEqual(["branch-1", "branch-2"]);
    });
  });

  // ========================================================================
  // 2. ENVÍO A COCINA SIN DUPLICADOS
  // ========================================================================
  describe("Envío a cocina sin duplicados", () => {
    it("reenviar el mismo pedido no crea comandas nuevas", async () => {
      const ctx = buildContext();
      await ctx.products.save(BURGER);

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

      await ctx.tableEngine.openTable({ tableId: "table-1", peopleCount: 2, waiterId: "w1" });
      await ctx.tableEngine.addItem({ tableId: "table-1", product: BURGER, quantity: 1 });
      await ctx.tableEngine.sendToKitchen("table-1");
      await expect(ctx.tableEngine.sendToKitchen("table-1")).rejects.toThrow(
        /NOTHING_REQUIRES_KITCHEN/
      );

      const orders = await ctx.kitchenOrders.findAll();
      expect(orders).toHaveLength(1);
    });

    it("agregar productos después del primer envío solo envía los nuevos", async () => {
      const ctx = buildContext();
      await ctx.products.save(BURGER);
      await ctx.products.save(DESSERT);

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

      await ctx.tableEngine.openTable({ tableId: "table-1", peopleCount: 2, waiterId: "w1" });
      await ctx.tableEngine.addItem({ tableId: "table-1", product: BURGER, quantity: 1 });
      await ctx.tableEngine.sendToKitchen("table-1");

      await ctx.tableEngine.addItem({ tableId: "table-1", product: DESSERT, quantity: 1 });
      await ctx.tableEngine.sendToKitchen("table-1");

      const orders = await ctx.kitchenOrders.findAll();
      const burgerOrder = orders.find(o => o.items.some(i => i.productId === BURGER.id));
      const dessertOrder = orders.find(o => o.items.some(i => i.productId === DESSERT.id));

      expect(burgerOrder).toBeDefined();
      expect(dessertOrder).toBeDefined();
      expect(burgerOrder!.items.some(i => i.productId === BURGER.id)).toBe(true);
      expect(burgerOrder!.items.some(i => i.productId === DESSERT.id)).toBe(false);
      expect(dessertOrder!.items.some(i => i.productId === DESSERT.id)).toBe(true);
      expect(dessertOrder!.items.some(i => i.productId === BURGER.id)).toBe(false);
    });

    it("agregar el mismo producto varias veces no lo reenvía", async () => {
      const ctx = buildContext();
      await ctx.products.save(BURGER);

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

      await ctx.tableEngine.openTable({ tableId: "table-1", peopleCount: 2, waiterId: "w1" });
      await ctx.tableEngine.addItem({ tableId: "table-1", product: BURGER, quantity: 1 });
      await ctx.tableEngine.sendToKitchen("table-1");

      await ctx.tableEngine.addItem({ tableId: "table-1", product: BURGER, quantity: 2 });
      await ctx.tableEngine.sendToKitchen("table-1");

      const orders = await ctx.kitchenOrders.findAll();
      expect(orders).toHaveLength(2);

      const firstOrder = orders[0];
      const secondOrder = orders[1];

      expect(firstOrder.items[0].productId).toBe(BURGER.id);
      expect(firstOrder.items[0].quantity).toBe(1);

      expect(secondOrder.items[0].productId).toBe(BURGER.id);
      expect(secondOrder.items[0].quantity).toBe(2);
    });
  });

  // ========================================================================
  // 3. ATOMICIDAD / CONSISTENCIA DE openTable Y closeTable
  // ========================================================================
  describe("Atomicidad de openTable", () => {
    it("fallo durante createOrder no deja la mesa BUSY", async () => {
      const ctx = buildContext();
      const orderEngine = ctx.orderEngine as any;
      const originalCreateOrder = orderEngine.createOrder.bind(orderEngine);

      orderEngine.createOrder = vi.fn(async () => {
        throw new Error("ORDER_DB_DOWN");
      });

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

      await expect(
        ctx.tableEngine.openTable({ tableId: "table-1", peopleCount: 2, waiterId: "w1" })
      ).rejects.toThrow("ORDER_CREATION_FAILED");

      const table = await ctx.tableEngine.getTable("table-1");
      expect(table.status).toBe("FREE");
    });

    it("reintento de openTable con el mismo operationId después de fallo funciona", async () => {
      const ctx = buildContext();
      let attempts = 0;
      const orderEngine = ctx.orderEngine as any;
      const originalCreateOrder = orderEngine.createOrder.bind(orderEngine);

      orderEngine.createOrder = vi.fn(async () => {
        attempts++;
        if (attempts === 1) {
          throw new Error("ORDER_DB_DOWN");
        }
        return originalCreateOrder({ source: "TABLE", tableId: "table-1", waiterId: "w1" });
      });

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

      const operationId = "open-attempt-1";

      await expect(
        ctx.tableEngine.openTable({ tableId: "table-1", peopleCount: 2, waiterId: "w1", operationId })
      ).rejects.toThrow("ORDER_CREATION_FAILED");

      const reopened = await ctx.tableEngine.openTable({
        tableId: "table-1",
        peopleCount: 2,
        waiterId: "w1",
        operationId
      });

      expect(reopened.status).toBe("BUSY");
      expect(reopened.orderId).toBeDefined();
    });
  });

  describe("Atomicidad de closeTable", () => {
    it("fallo durante registerPayment devuelve la mesa a su estado anterior", async () => {
      const ctx = buildContext();
      const salesEngine = ctx.salesEngine as any;

      vi.spyOn(salesEngine, "tableSale").mockImplementation(async () => {
        throw new Error("PAYMENT_GATEWAY_DOWN");
      });

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

      await ctx.tableEngine.openTable({ tableId: "table-1", peopleCount: 2, waiterId: "w1" });
      await ctx.tableEngine.addItem({ tableId: "table-1", product: BURGER, quantity: 1 });
      await ctx.tableEngine.requestBill("table-1");

      await expect(
        ctx.tableEngine.closeTable({
          tableId: "table-1",
          method: "CASH",
          cashierId: "c1",
          received: 50000
        })
      ).rejects.toThrow("PAYMENT_GATEWAY_DOWN");

      const table = await ctx.tableEngine.getTable("table-1");
      expect(table.status).toBe("CUENTA_SOLICITADA");
    });

    it("reintento de closeTable con el mismo saleId después de fallo cierra correctamente", async () => {
      const ctx = buildContext();
      const salesEngine = ctx.salesEngine as any;
      const originalTableSale = salesEngine.tableSale.bind(salesEngine);

      let attempts = 0;
      vi.spyOn(salesEngine, "tableSale").mockImplementation(async (input: any) => {
        attempts++;
        if (attempts === 1) {
          throw new Error("PAYMENT_GATEWAY_DOWN");
        }
        return originalTableSale(input);
      });

      await ctx.products.save(BURGER);

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

      await ctx.tableEngine.openTable({ tableId: "table-1", peopleCount: 2, waiterId: "w1" });
      await ctx.tableEngine.addItem({ tableId: "table-1", product: BURGER, quantity: 1 });

      const saleId = "sale-attempt-1";

      await expect(
        ctx.tableEngine.closeTable({
          tableId: "table-1",
          method: "CASH",
          cashierId: "c1",
          saleId,
          received: 50000
        })
      ).rejects.toThrow("PAYMENT_GATEWAY_DOWN");

      const { sale } = await ctx.tableEngine.closeTable({
        tableId: "table-1",
        method: "CASH",
        cashierId: "c1",
        saleId,
        received: 50000
      });

      expect(sale.id).toBeDefined();

      const table = await ctx.tableEngine.getTable("table-1");
      expect(table.status).toBe("FREE");
    });
  });

  // ========================================================================
  // 4. FLUJO COMPLETO DE MESA (venta completa)
  // ========================================================================
  describe("Venta completa de mesa", () => {
    it("flujo completo: abrir → agregar → enviar cocina → agregar más → cobrar → mesa libre", async () => {
      const ctx = buildContext();
      await ctx.products.save(BURGER);
      await ctx.products.save(SODA);
      await ctx.products.save(DESSERT);

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

      const opened = await ctx.tableEngine.openTable({ tableId: "table-1", peopleCount: 3, waiterId: "w1" });
      expect(opened.status).toBe("BUSY");
      expect(opened.orderId).toBeDefined();

      await ctx.tableEngine.addItem({ tableId: "table-1", product: BURGER, quantity: 2 });
      await ctx.tableEngine.addItem({ tableId: "table-1", product: SODA, quantity: 2 });
      await ctx.tableEngine.sendToKitchen("table-1");

      await ctx.tableEngine.addItem({ tableId: "table-1", product: DESSERT, quantity: 1 });
      await ctx.tableEngine.requestBill("table-1");

      const { sale } = await ctx.tableEngine.closeTable({
        tableId: "table-1",
        method: "CASH",
        cashierId: "c1",
        received: 100000
      });

      expect(sale.items).toHaveLength(3);

      const closed = await ctx.tableEngine.getTable("table-1");
      expect(closed.status).toBe("FREE");
      expect(closed.items).toHaveLength(0);
    });
  });
});
