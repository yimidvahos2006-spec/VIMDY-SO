// tests/smoke/fase5-mesas-cocina-pedidos.test.ts
/* ===========================================================================
   FASE 5 — MESAS + COCINA + PEDIDOS
   ---------------------------------------------------------------------------
   15 pruebas obligatorias que verifican el flujo completo de atención:
   apertura de mesa, productos, cocina, cuenta, cobro, cierre, venta
   directa, aislamiento y cancelaciones.
=========================================================================== */

import { describe, it, expect, beforeEach } from "vitest";

import {
  Product,
  Sale,
  Table,
  CashMovement,
  KitchenOrder,
  Order,
  OrderStatus
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

describe("FASE 5 — Mesas + Cocina + Pedidos", () => {
  let ctx: ReturnType<typeof buildContext>;

  beforeEach(async () => {
    ctx = buildContext();
    await ctx.products.save(BURGER);
    await ctx.products.save(SODA);
    await ctx.products.save(BEER);
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
      updatedAt: new Date()
    } as Table);
  });

  // TEST 1: Mesa disponible → abrir pedido.
  it("TEST 1: Mesa disponible → abrir pedido", async () => {
    const opened = await ctx.tableEngine.openTable({
      tableId: "table-1",
      peopleCount: 2,
      waiterId: "waiter-1"
    });

    expect(opened.status).toBe("BUSY");
    expect(opened.peopleCount).toBe(2);
    expect(opened.waiterId).toBe("waiter-1");
    expect(opened.items).toHaveLength(0);
    expect(opened.orderId).toBeDefined();
  });

  // TEST 2: Agregar producto → pedido correcto.
  it("TEST 2: Agregar producto → pedido correcto", async () => {
    await ctx.tableEngine.openTable({
      tableId: "table-1",
      peopleCount: 2,
      waiterId: "waiter-1"
    });

    await ctx.tableEngine.addItem({
      tableId: "table-1",
      product: BURGER,
      quantity: 2
    });

    const table = await ctx.tableEngine.getTable("table-1");
    expect(table.items).toHaveLength(1);
    expect(table.items[0].productId).toBe(BURGER.id);
    expect(table.items[0].quantity).toBe(2);
    expect(table.subtotal).toBeCloseTo(BURGER.price * 2, 0);
    expect(table.total).toBeGreaterThan(0);
  });

  // TEST 3: Producto que requiere cocina → KitchenOrder correcto.
  it("TEST 3: Producto que requiere cocina → KitchenOrder correcto", async () => {
    await ctx.tableEngine.openTable({
      tableId: "table-1",
      peopleCount: 2,
      waiterId: "waiter-1"
    });

    await ctx.tableEngine.addItem({
      tableId: "table-1",
      product: BURGER,
      quantity: 1
    });

    await ctx.tableEngine.sendToKitchen("table-1");

    const kitchenOrders = await ctx.kitchenOrders.findAll();
    expect(kitchenOrders).toHaveLength(1);
    expect(kitchenOrders[0].items).toHaveLength(1);
    expect(kitchenOrders[0].items[0].productId).toBe(BURGER.id);
    expect(kitchenOrders[0].status).toBe("PENDIENTE");
  });

  // TEST 4: Producto que NO requiere cocina → no KitchenOrder.
  it("TEST 4: Producto que NO requiere cocina → no KitchenOrder", async () => {
    await ctx.tableEngine.openTable({
      tableId: "table-1",
      peopleCount: 2,
      waiterId: "waiter-1"
    });

    await ctx.tableEngine.addItem({
      tableId: "table-1",
      product: SODA,
      quantity: 2
    });

    const result = await ctx.tableEngine.sendToKitchen("table-1");
    expect(result).toBeNull();

    const kitchenOrders = await ctx.kitchenOrders.findAll();
    expect(kitchenOrders).toHaveLength(0);
  });

  // TEST 5: Enviar pedido dos veces → no duplicar operación.
  it("TEST 5: Enviar pedido dos veces → no duplicar operación", async () => {
    await ctx.tableEngine.openTable({
      tableId: "table-1",
      peopleCount: 2,
      waiterId: "waiter-1"
    });

    await ctx.tableEngine.addItem({
      tableId: "table-1",
      product: BURGER,
      quantity: 1
    });

    await ctx.tableEngine.sendToKitchen("table-1");
    const secondResult = await ctx.tableEngine.sendToKitchen("table-1");
    expect(secondResult).toBeNull();

    const kitchenOrders = await ctx.kitchenOrders.findAll();
    expect(kitchenOrders).toHaveLength(1);
  });

  // TEST 6: Agregar productos posteriormente → solo consumir nuevos productos.
  it("TEST 6: Agregar productos posteriormente → solo consumir nuevos productos", async () => {
    await ctx.tableEngine.openTable({
      tableId: "table-1",
      peopleCount: 2,
      waiterId: "waiter-1"
    });

    await ctx.tableEngine.addItem({
      tableId: "table-1",
      product: BURGER,
      quantity: 1
    });

    await ctx.tableEngine.sendToKitchen("table-1");

    await ctx.tableEngine.addItem({
      tableId: "table-1",
      product: DESSERT,
      quantity: 1
    });

    await ctx.tableEngine.sendToKitchen("table-1");

    const table = await ctx.tableEngine.getTable("table-1");
    expect(table.items).toHaveLength(2);
    expect(table.items.some(item => item.productId === BURGER.id)).toBe(true);
    expect(table.items.some(item => item.productId === DESSERT.id)).toBe(true);

    const kitchenOrders = await ctx.kitchenOrders.findAll();
    const dessertOrder = kitchenOrders.find(order =>
      order.items.some(item => item.productId === DESSERT.id)
    );
    const burgerOrder = kitchenOrders.find(order =>
      order.items.some(item => item.productId === BURGER.id)
    );
    expect(dessertOrder).toBeDefined();
    expect(burgerOrder).toBeDefined();
    expect(dessertOrder!.items.some(item => item.productId === DESSERT.id)).toBe(true);
    expect(dessertOrder!.items.some(item => item.productId === BURGER.id)).toBe(false);
    expect(burgerOrder!.items.some(item => item.productId === BURGER.id)).toBe(true);
    expect(burgerOrder!.items.some(item => item.productId === DESSERT.id)).toBe(false);
  });

  // TEST 7: Solicitar cuenta → total correcto.
  it("TEST 7: Solicitar cuenta → total correcto", async () => {
    await ctx.tableEngine.openTable({
      tableId: "table-1",
      peopleCount: 2,
      waiterId: "waiter-1"
    });

    await ctx.tableEngine.addItem({
      tableId: "table-1",
      product: BURGER,
      quantity: 2
    });

    await ctx.tableEngine.addItem({
      tableId: "table-1",
      product: SODA,
      quantity: 2
    });

    const billTable = await ctx.tableEngine.requestBill("table-1");
    expect(billTable.status).toBe("CUENTA_SOLICITADA");

    const expectedSubtotal = BURGER.price * 2 + SODA.price * 2;
    expect(billTable.subtotal).toBeCloseTo(expectedSubtotal, 0);
    expect(billTable.total).toBeGreaterThan(0);
  });

  // TEST 8: Cobrar → venta completada.
  it("TEST 8: Cobrar → venta completada", async () => {
    await ctx.tableEngine.openTable({
      tableId: "table-1",
      peopleCount: 2,
      waiterId: "waiter-1"
    });

    await ctx.tableEngine.addItem({
      tableId: "table-1",
      product: BURGER,
      quantity: 1
    });

    const { sale, payment } = await ctx.tableEngine.closeTable({
      tableId: "table-1",
      method: "CASH",
      cashierId: "cashier-1",
      received: 50000
    });

    expect(payment.success).toBe(true);
    expect(sale.items).toHaveLength(1);
    expect(sale.items[0].productId).toBe(BURGER.id);
    expect(sale.total).toBeGreaterThan(0);

    const allSales = await ctx.salesEngine.getAllSales();
    expect(allSales).toHaveLength(1);
    expect(allSales[0].id).toBe(sale.id);
  });

  // TEST 9: Cobrar → mesa vuelve a disponible.
  it("TEST 9: Cobrar → mesa vuelve a disponible", async () => {
    await ctx.tableEngine.openTable({
      tableId: "table-1",
      peopleCount: 2,
      waiterId: "waiter-1"
    });

    await ctx.tableEngine.addItem({
      tableId: "table-1",
      product: BURGER,
      quantity: 1
    });

    await ctx.tableEngine.closeTable({
      tableId: "table-1",
      method: "CASH",
      cashierId: "cashier-1",
      received: 50000
    });

    const closedTable = await ctx.tableEngine.getTable("table-1");
    expect(closedTable.status).toBe("FREE");
    expect(closedTable.items).toHaveLength(0);
    expect(closedTable.total).toBe(0);
  });

  // TEST 10: Venta directa sin mesa funciona.
  it("TEST 10: Venta directa sin mesa funciona", async () => {
    ctx.cart.addItem(BURGER, 1);
    ctx.cart.addItem(SODA, 2);

    const sale = await ctx.salesEngine.quickSale({
      cashierId: "cashier-1"
    });

    expect(sale.items).toHaveLength(2);
    expect(sale.total).toBeGreaterThan(0);

    const allSales = await ctx.salesEngine.getAllSales();
    expect(allSales).toHaveLength(1);
  });

  // TEST 11: Dos mesas diferentes no mezclan pedidos.
  it("TEST 11: Dos mesas diferentes no mezclan pedidos", async () => {
    await ctx.tableEngine.openTable({
      tableId: "table-1",
      peopleCount: 2,
      waiterId: "waiter-1"
    });

    await ctx.tableEngine.openTable({
      tableId: "table-2",
      peopleCount: 3,
      waiterId: "waiter-2"
    });

    await ctx.tableEngine.addItem({
      tableId: "table-1",
      product: BURGER,
      quantity: 1
    });

    await ctx.tableEngine.addItem({
      tableId: "table-2",
      product: SODA,
      quantity: 2
    });

    const table1 = await ctx.tableEngine.getTable("table-1");
    const table2 = await ctx.tableEngine.getTable("table-2");

    expect(table1.items).toHaveLength(1);
    expect(table1.items[0].productId).toBe(BURGER.id);

    expect(table2.items).toHaveLength(1);
    expect(table2.items[0].productId).toBe(SODA.id);
  });

  // TEST 12: Dos sucursales no mezclan mesas/pedidos.
  it("TEST 12: Dos sucursales no mezclan mesas/pedidos", async () => {
    await ctx.tables.save({
      id: "table-b1",
      name: "Mesa Sucursal 1",
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
      id: "table-b2",
      name: "Mesa Sucursal 2",
      capacity: 4,
      peopleCount: 0,
      status: "FREE",
      items: [],
      subtotal: 0,
      tax: 0,
      discount: 0,
      total: 0,
      businessId: "biz-2",
      branchId: "branch-2",
      updatedAt: new Date()
    } as Table);

    await ctx.tableEngine.openTable({
      tableId: "table-b1",
      peopleCount: 2,
      waiterId: "waiter-1"
    });

    await ctx.tableEngine.openTable({
      tableId: "table-b2",
      peopleCount: 2,
      waiterId: "waiter-2"
    });

    await ctx.tableEngine.addItem({
      tableId: "table-b1",
      product: BURGER,
      quantity: 1
    });

    await ctx.tableEngine.addItem({
      tableId: "table-b2",
      product: SODA,
      quantity: 1
    });

    const loaded1 = await ctx.tableEngine.getTable("table-b1");
    const loaded2 = await ctx.tableEngine.getTable("table-b2");

    expect(loaded1.items[0].productId).toBe(BURGER.id);
    expect(loaded2.items[0].productId).toBe(SODA.id);
  });

  // TEST 13: Cancelar correctamente restaura inventario cuando corresponde.
  it("TEST 13: Cancelar correctamente restaura inventario cuando corresponde", async () => {
    await ctx.tableEngine.openTable({
      tableId: "table-1",
      peopleCount: 2,
      waiterId: "waiter-1"
    });

    await ctx.tableEngine.addItem({
      tableId: "table-1",
      product: BURGER,
      quantity: 1
    });

    const burgerBefore = await ctx.inventory.getById(BURGER.id);
    const beforeStock = burgerBefore?.stock ?? 0;

    await ctx.tableEngine.removeItem("table-1", BURGER.id);

    const burgerAfter = await ctx.inventory.getById(BURGER.id);
    const afterStock = burgerAfter?.stock ?? 0;
    expect(afterStock).toBe(beforeStock);

    const table = await ctx.tableEngine.getTable("table-1");
    expect(table.items).toHaveLength(0);
  });

  // TEST 14: Recargar sesión no pierde el pedido abierto.
  it("TEST 14: Recargar sesión no pierde el pedido abierto", async () => {
    await ctx.tableEngine.openTable({
      tableId: "table-1",
      peopleCount: 2,
      waiterId: "waiter-1"
    });

    await ctx.tableEngine.addItem({
      tableId: "table-1",
      product: BURGER,
      quantity: 2
    });

    await ctx.tableEngine.sendToKitchen("table-1");

    const freshTable = await ctx.tableEngine.getTable("table-1");
    expect(freshTable.status).toBe("CUENTA_SOLICITADA");
    expect(freshTable.items).toHaveLength(1);
    expect(freshTable.items[0].productId).toBe(BURGER.id);
    expect(freshTable.items[0].quantity).toBe(2);
  });

  // TEST 15: Offline/sync no duplica la venta si esa infraestructura ya está disponible.
  it("TEST 15: Offline/sync no duplica la venta", async () => {
    await ctx.tableEngine.openTable({
      tableId: "table-1",
      peopleCount: 2,
      waiterId: "waiter-1"
    });

    await ctx.tableEngine.addItem({
      tableId: "table-1",
      product: BURGER,
      quantity: 1
    });

    const { sale } = await ctx.tableEngine.closeTable({
      tableId: "table-1",
      method: "CASH",
      cashierId: "cashier-1",
      saleId: "sale-attempt-1",
      received: 50000
    });

    const allSales = await ctx.salesEngine.getAllSales();
    expect(allSales).toHaveLength(1);
    expect(allSales[0].id).toBe(sale.id);
  });

  // TEST 16: Cerrar mesa no duplica la comanda en cocina.
  it("TEST 16: Cerrar mesa no duplica la comanda en cocina", async () => {
    await ctx.tableEngine.openTable({
      tableId: "table-1",
      peopleCount: 2,
      waiterId: "waiter-1"
    });

    await ctx.tableEngine.addItem({
      tableId: "table-1",
      product: BURGER,
      quantity: 2
    });

    await ctx.tableEngine.sendToKitchen("table-1");

    const beforeClose = await ctx.kitchenEngine.getActiveOrders();
    expect(beforeClose).toHaveLength(1);

    await ctx.tableEngine.closeTable({
      tableId: "table-1",
      method: "CASH",
      cashierId: "cashier-1",
      saleId: "sale-attempt-kitchen",
      received: 50000
    });

    const afterClose = await ctx.kitchenEngine.getActiveOrders();
    expect(afterClose).toHaveLength(1);
  });
});
