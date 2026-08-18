// tests/smoke/validacion-operacional-restaurante.test.ts
/* ===========================================================================
   VALIDACIÓN OPERACIONAL — Restaurante
   ---------------------------------------------------------------------------
   Escenario integral: dueño configura negocio → crea productos → abre caja →
   abre mesa → toma pedido → cocina recibe solo lo que corresponde → cobra →
   inventario descuenta → cierra caja → reportes coinciden.
   =========================================================================== */

import { describe, it, expect, beforeEach } from "vitest";

import {
  Product,
  Sale,
  Table,
  Customer,
  RecipeItem,
  KitchenOrder,
  CashMovement,
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

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildContext() {
  const products = new FakeProductRepository();
  const sales = new InMemoryRepository<Sale>("sales");
  const receipts = new InMemoryRepository<Sale>("receipts");
  const kitchenOrders = new InMemoryRepository<KitchenOrder>("kitchen_orders");
  const cashMovements = new InMemoryRepository<CashMovement>("cash_movements");
  const customers = new InMemoryRepository<Customer>("customers");
  const movements = new InMemoryRepository<any>("inventory_movements");
  const auditLogs = new InMemoryRepository<any>("audit_logs");
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

  return {
    salesEngine,
    tableEngine,
    products,
    cart,
    kitchen,
    kitchenOrders,
    tables,
    inventory,
    kardex,
    orders,
    cash
  };
}

async function createProduct(ctx: ReturnType<typeof buildContext>, input: {
  name: string;
  categoryId: string;
  price: number;
  stock: number;
  minStock: number;
  requiresKitchen?: boolean;
  trackStock?: boolean;
  recipe?: readonly RecipeItem[];
  productionMode?: "ON_DEMAND" | "BATCH";
  isIngredient?: boolean;
}): Promise<Product> {
  return ctx.inventory.createProduct({
    ...input,
    trackStock: input.trackStock ?? true
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("Validación operacional: Restaurante", () => {
  let ctx: ReturnType<typeof buildContext>;
  let burgerId: string;
  let cocaId: string;
  let panId: string;
  let coverId: string;
  let carneId: string;
  let panIngId: string;
  let harinaId: string;

  beforeEach(async () => {
    ctx = buildContext();

    const carne = await createProduct(ctx, {
      name: "Carne molida",
      categoryId: "cat-insumos",
      price: 5000,
      stock: 100,
      minStock: 10,
      isIngredient: true,
      trackStock: true
    });
    carneId = carne.id;

    const panIng = await createProduct(ctx, {
      name: "Pan hamburguesa",
      categoryId: "cat-insumos",
      price: 2000,
      stock: 100,
      minStock: 10,
      isIngredient: true,
      trackStock: true
    });
    panIngId = panIng.id;

    const harina = await createProduct(ctx, {
      name: "Harina",
      categoryId: "cat-insumos",
      price: 1500,
      stock: 50,
      minStock: 5,
      isIngredient: true,
      trackStock: true
    });
    harinaId = harina.id;

    const burger = await createProduct(ctx, {
      name: "Hamburguesa Clásica",
      categoryId: "cat-comidas",
      price: 18000,
      stock: 0,
      minStock: 0,
      requiresKitchen: true,
      trackStock: false,
      recipe: [
        { productId: carneId, quantity: 1 },
        { productId: panIngId, quantity: 1 }
      ],
      productionMode: "ON_DEMAND"
    });
    burgerId = burger.id;

    const coca = await createProduct(ctx, {
      name: "Coca-Cola 400ml",
      categoryId: "cat-bebidas",
      price: 4000,
      stock: 50,
      minStock: 10,
      requiresKitchen: false,
      trackStock: true
    });
    cocaId = coca.id;

    const pan = await createProduct(ctx, {
      name: "Pan de la casa",
      categoryId: "cat-comidas",
      price: 8000,
      stock: 10,
      minStock: 2,
      requiresKitchen: true,
      trackStock: true,
      recipe: [
        { productId: harinaId, quantity: 2 }
      ],
      productionMode: "BATCH"
    });
    panId = pan.id;

    const cover = await createProduct(ctx, {
      name: "Cover",
      categoryId: "cat-servicios",
      price: 5000,
      stock: 0,
      minStock: 0,
      requiresKitchen: false,
      trackStock: false
    });
    coverId = cover.id;
  });

  it("flujo completo: configuración → mesa → pedido mixto → cocina solo hamburguesa → cobro → inventario correcto", async () => {
    // 1. Abrir mesa
    const table = await ctx.tables.save({
      id: "table-rest-1",
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
    } as Table).then(() => ctx.tables.findById("table-rest-1"));
    expect(table).not.toBeNull();

    await ctx.tableEngine.openTable({ tableId: "table-rest-1", peopleCount: 2, waiterId: "waiter-1" });

    // 2. Tomar pedido: hamburguesa (cocina) + Coca-Cola (sin preparación) + cover (servicio)
    const burgerProduct = { id: burgerId, name: "Hamburguesa Clásica", price: 18000, requiresKitchen: true } as Product;
    const cocaProduct = { id: cocaId, name: "Coca-Cola 400ml", price: 4000, requiresKitchen: false } as Product;
    const coverProduct = { id: coverId, name: "Cover", price: 5000, requiresKitchen: false } as Product;

    await ctx.tableEngine.addItem({ tableId: "table-rest-1", product: burgerProduct, quantity: 2 });
    await ctx.tableEngine.addItem({ tableId: "table-rest-1", product: cocaProduct, quantity: 2 });
    await ctx.tableEngine.addItem({ tableId: "table-rest-1", product: coverProduct, quantity: 1 });

    // 3. Enviar a cocina
    await ctx.tableEngine.sendToKitchen("table-rest-1");

    // 4. Verificar que Cocina recibe SOLO la hamburguesa
    const kitchenOrders = await ctx.kitchenOrders.findAll();
    expect(kitchenOrders).toHaveLength(1);
    expect(kitchenOrders[0].items).toHaveLength(1);
    expect(kitchenOrders[0].items[0].productId).toBe(burgerId);
    expect(kitchenOrders[0].items[0].quantity).toBe(2);

    // 5. Cocina prepara y entrega (simulado)
    await ctx.kitchen.updateStatus(kitchenOrders[0].id, "ENTREGADO");

    // 6. Cobrar mesa
    const result = await ctx.tableEngine.closeTable({
      tableId: "table-rest-1",
      method: "CASH",
      cashierId: "cashier-1"
    });

    expect(result.sale).toBeDefined();
    expect(result.sale.items).toHaveLength(3);
    expect(result.sale.status).toBe("PAID");

    // 7. Verificar descuento de inventario
    // Hamburguesa: descuenta ingredientes (carne y pan)
    expect((await ctx.products.findById(carneId))?.stock).toBe(98); // 100 - 2
    expect((await ctx.products.findById(panIngId))?.stock).toBe(98); // 100 - 2

    // Coca-Cola: descuenta su propio stock
    expect((await ctx.products.findById(cocaId))?.stock).toBe(48); // 50 - 2

    // Cover: NO descuenta stock
    expect((await ctx.products.findById(coverId))?.stock).toBe(0);

    // Pan batch: no se vende, no cambia
    expect((await ctx.products.findById(panId))?.stock).toBe(10);

    // 8. Verificar Kardex
    const allMovements = await ctx.kardex.getAllMovements();
    const burgerMovements = allMovements.filter(m => m.productId === burgerId || m.productId === carneId || m.productId === panIngId);
    const cocaMovements = allMovements.filter(m => m.productId === cocaId);
    expect(burgerMovements.length).toBeGreaterThanOrEqual(1);
    expect(cocaMovements.length).toBeGreaterThanOrEqual(1);

    // 9. Verificar caja
    const cashMovements = await ctx.cash.getAllMovements();
    const saleIncome = cashMovements.find(m => m.type === "IN" && m.description?.includes("Venta"));
    expect(saleIncome).toBeDefined();
    expect(saleIncome?.amount).toBe(result.sale.total);
  });

  it("pedido 100% sin cocina no genera comanda fantasma", async () => {
    const table = await ctx.tables.save({
      id: "table-rest-2",
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
    } as Table).then(() => ctx.tables.findById("table-rest-2"));
    expect(table).not.toBeNull();

    await ctx.tableEngine.openTable({ tableId: "table-rest-2", peopleCount: 1, waiterId: "waiter-1" });
    const cocaProduct = { id: cocaId, name: "Coca-Cola 400ml", price: 4000, requiresKitchen: false } as Product;
    const coverProduct = { id: coverId, name: "Cover", price: 5000, requiresKitchen: false } as Product;
    await ctx.tableEngine.addItem({ tableId: "table-rest-2", product: cocaProduct, quantity: 3 });
    await ctx.tableEngine.addItem({ tableId: "table-rest-2", product: coverProduct, quantity: 1 });

    await expect(ctx.tableEngine.sendToKitchen("table-rest-2")).rejects.toThrow(/NOTHING_REQUIRES_KITCHEN/);

    const kitchenOrders = await ctx.kitchenOrders.findAll();
    expect(kitchenOrders).toHaveLength(0);
  });

  it("pedido 100% cocina genera comanda y descuenta ingredientes", async () => {
    const table = await ctx.tables.save({
      id: "table-rest-3",
      name: "Mesa 3",
      capacity: 4,
      peopleCount: 0,
      status: "FREE",
      items: [],
      subtotal: 0,
      tax: 0,
      discount: 0,
      total: 0,
      updatedAt: new Date()
    } as Table).then(() => ctx.tables.findById("table-rest-3"));
    expect(table).not.toBeNull();

    await ctx.tableEngine.openTable({ tableId: "table-rest-3", peopleCount: 2, waiterId: "waiter-1" });
    const burgerProduct = { id: burgerId, name: "Hamburguesa Clásica", price: 18000, requiresKitchen: true } as Product;
    await ctx.tableEngine.addItem({ tableId: "table-rest-3", product: burgerProduct, quantity: 3 });

    await ctx.tableEngine.sendToKitchen("table-rest-3");

    const kitchenOrders = await ctx.kitchenOrders.findAll();
    expect(kitchenOrders).toHaveLength(1);
    expect(kitchenOrders[0].items).toHaveLength(1);
    expect(kitchenOrders[0].items[0].productId).toBe(burgerId);
    expect(kitchenOrders[0].items[0].quantity).toBe(3);

    // Cerrar mesa
    await ctx.tableEngine.closeTable({
      tableId: "table-rest-3",
      method: "CASH",
      cashierId: "cashier-1"
    });

    expect((await ctx.products.findById(carneId))?.stock).toBe(97); // 100 - 3
    expect((await ctx.products.findById(panIngId))?.stock).toBe(97); // 100 - 3
  });

  it("modificar pedido antes de enviar a cocina funciona correctamente", async () => {
    const table = await ctx.tables.save({
      id: "table-rest-4",
      name: "Mesa 4",
      capacity: 4,
      peopleCount: 0,
      status: "FREE",
      items: [],
      subtotal: 0,
      tax: 0,
      discount: 0,
      total: 0,
      updatedAt: new Date()
    } as Table).then(() => ctx.tables.findById("table-rest-4"));
    expect(table).not.toBeNull();

    await ctx.tableEngine.openTable({ tableId: "table-rest-4", peopleCount: 2, waiterId: "waiter-1" });
    const burgerProduct = { id: burgerId, name: "Hamburguesa Clásica", price: 18000, requiresKitchen: true } as Product;
    const cocaProduct = { id: cocaId, name: "Coca-Cola 400ml", price: 4000, requiresKitchen: false } as Product;
    await ctx.tableEngine.addItem({ tableId: "table-rest-4", product: burgerProduct, quantity: 2 });
    await ctx.tableEngine.addItem({ tableId: "table-rest-4", product: cocaProduct, quantity: 1 });

    // Modificar: cambiar cantidad de hamburguesa
    await ctx.tableEngine.updateItemQuantity("table-rest-4", burgerId, 3);

    // Eliminar Coca-Cola
    await ctx.tableEngine.removeItem("table-rest-4", cocaId);

    // Enviar a cocina
    await ctx.tableEngine.sendToKitchen("table-rest-4");

    const kitchenOrders = await ctx.kitchenOrders.findAll();
    expect(kitchenOrders).toHaveLength(1);
    expect(kitchenOrders[0].items).toHaveLength(1);
    expect(kitchenOrders[0].items[0].productId).toBe(burgerId);
    expect(kitchenOrders[0].items[0].quantity).toBe(3);
  });

  it("venta desde Caja (POS) directa funciona igual que desde Mesas", async () => {
    // Venta rápida en Caja: hamburguesa + Coca-Cola
    const burgerProduct = { id: burgerId, name: "Hamburguesa Clásica", price: 18000, requiresKitchen: true } as Product;
    const cocaProduct = { id: cocaId, name: "Coca-Cola 400ml", price: 4000, requiresKitchen: false } as Product;

    ctx.cart.addItem(burgerProduct, 1);
    ctx.cart.addItem(cocaProduct, 2);

    const sale = await ctx.salesEngine.quickSale({ cashierId: "cashier-1" });
    const paidSale = (await ctx.salesEngine.registerPayment(sale, "CASH")).sale;

    expect(paidSale).toBeDefined();
    expect(paidSale.items).toHaveLength(2);
    expect(paidSale.status).toBe("PAID");

    // Inventario descontado igual que en Mesas
    expect((await ctx.products.findById(carneId))?.stock).toBe(99); // 100 - 1
    expect((await ctx.products.findById(panIngId))?.stock).toBe(99); // 100 - 1
    expect((await ctx.products.findById(cocaId))?.stock).toBe(48); // 50 - 2

    // Comanda enviada automáticamente
    const kitchenOrders = await ctx.kitchenOrders.findAll();
    expect(kitchenOrders).toHaveLength(1);
    expect(kitchenOrders[0].items[0].productId).toBe(burgerId);
  });
});
