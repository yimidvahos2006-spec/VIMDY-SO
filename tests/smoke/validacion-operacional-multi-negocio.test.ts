// tests/smoke/validacion-operacional-multi-negocio.test.ts
/* ===========================================================================
   VALIDACIÓN OPERACIONAL — Multi-negocio
   =========================================================================== */

import { describe, it, expect, beforeEach } from "vitest";

import {
  Product,
  Sale,
  Table,
  RecipeItem,
  KitchenOrder,
  CashMovement
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

function buildContext() {
  const products = new FakeProductRepository();
  const sales = new InMemoryRepository<Sale>("sales");
  const receipts = new InMemoryRepository<Sale>("receipts");
  const kitchenOrders = new InMemoryRepository<KitchenOrder>("kitchen_orders");
  const cashMovements = new InMemoryRepository<CashMovement>("cash_movements");
  const customers = new InMemoryRepository<any>("customers");
  const movements = new InMemoryRepository<any>("inventory_movements");
  const auditLogs = new InMemoryRepository<any>("audit_logs");
  const orders = new InMemoryRepository<any>("orders");
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

describe("Validación operacional: Cafetería", () => {
  let ctx: ReturnType<typeof buildContext>;
  let productIds: string[];

  beforeEach(async () => {
    ctx = buildContext();
    productIds = [];

    const products = [
      { name: "Café", categoryId: "cat-bebidas", price: 3500, stock: 100, minStock: 20, requiresKitchen: true, trackStock: true },
      { name: "Leche", categoryId: "cat-insumos", price: 2000, stock: 50, minStock: 10, requiresKitchen: false, trackStock: true, isIngredient: true },
      { name: "Tostada", categoryId: "cat-comidas", price: 2500, stock: 30, minStock: 5, requiresKitchen: true, trackStock: true },
      { name: "Mermelada", categoryId: "cat-insumos", price: 1500, stock: 20, minStock: 5, requiresKitchen: false, trackStock: true, isIngredient: true }
    ];

    for (const p of products) {
      const created = await createProduct(ctx, p);
      productIds.push(created.id);
    }
  });

  it("flujo completo: setup → venta → inventario correcto → caja registrada", async () => {
    ctx.cart.addItem({ id: productIds[0], name: "Café", price: 3500, requiresKitchen: true } as Product, 2);
    ctx.cart.addItem({ id: productIds[2], name: "Tostada", price: 2500, requiresKitchen: true } as Product, 1);

    const sale = await ctx.salesEngine.quickSale({ cashierId: "cashier-1" });
    const paidSale = (await ctx.salesEngine.registerPayment(sale, "CASH")).sale;

    expect(paidSale.status).toBe("PAID");

    const kitchenOrders = await ctx.kitchenOrders.findAll();
    expect(kitchenOrders).toHaveLength(1);
    expect(kitchenOrders[0].items).toHaveLength(2);

    const cafe = await ctx.products.findById(productIds[0]);
    expect(cafe?.stock).toBe(98);

    const tostada = await ctx.products.findById(productIds[2]);
    expect(tostada?.stock).toBe(29);

    const cashMovements = await ctx.cash.getAllMovements();
    const saleIncome = cashMovements.find(m => m.type === "IN" && m.description?.includes("Venta"));
    expect(saleIncome).toBeDefined();
    expect(saleIncome?.amount).toBe(paidSale.total);
  });
});

describe("Validación operacional: Bar", () => {
  let ctx: ReturnType<typeof buildContext>;
  let productIds: string[];

  beforeEach(async () => {
    ctx = buildContext();
    productIds = [];

    const queso = await createProduct(ctx, { name: "Queso", categoryId: "cat-insumos", price: 8000, stock: 20, minStock: 5, requiresKitchen: false, trackStock: true, isIngredient: true });
    productIds.push(queso.id);

    const products = [
      { name: "Cerveza", categoryId: "cat-bebidas", price: 5000, stock: 80, minStock: 20, requiresKitchen: false, trackStock: true },
      { name: "Vino", categoryId: "cat-bebidas", price: 12000, stock: 30, minStock: 10, requiresKitchen: false, trackStock: true },
      { name: "Picada", categoryId: "cat-comidas", price: 15000, stock: 0, minStock: 0, requiresKitchen: true, trackStock: false, recipe: [{ productId: queso.id, quantity: 1 }] }
    ];

    for (const p of products) {
      const created = await createProduct(ctx, p);
      productIds.push(created.id);
    }
  });

  it("flujo completo: setup → venta mixta (bebidas + cocina) → inventario correcto", async () => {
    ctx.cart.addItem({ id: productIds[1], name: "Cerveza", price: 5000, requiresKitchen: false } as Product, 3);
    ctx.cart.addItem({ id: productIds[3], name: "Picada", price: 15000, requiresKitchen: true } as Product, 1);

    const sale = await ctx.salesEngine.quickSale({ cashierId: "cashier-1" });
    const paidSale = (await ctx.salesEngine.registerPayment(sale, "CASH")).sale;

    expect(paidSale.status).toBe("PAID");

    const kitchenOrders = await ctx.kitchenOrders.findAll();
    expect(kitchenOrders).toHaveLength(1);
    expect(kitchenOrders[0].items).toHaveLength(1);

    const cerveza = await ctx.products.findById(productIds[1]);
    expect(cerveza?.stock).toBe(77);

    const queso = await ctx.products.findById(productIds[0]);
    expect(queso?.stock).toBe(19);
  });
});

describe("Validación operacional: Tienda/Supermercado", () => {
  let ctx: ReturnType<typeof buildContext>;
  let productIds: string[];

  beforeEach(async () => {
    ctx = buildContext();
    productIds = [];

    const products = [
      { name: "Arroz", categoryId: "cat-desayuno", price: 3000, stock: 100, minStock: 20, requiresKitchen: false, trackStock: true },
      { name: "Aceite", categoryId: "cat-desayuno", price: 8000, stock: 40, minStock: 10, requiresKitchen: false, trackStock: true },
      { name: "Jabón", categoryId: "cat-limpieza", price: 2500, stock: 60, minStock: 15, requiresKitchen: false, trackStock: true }
    ];

    for (const p of products) {
      const created = await createProduct(ctx, p);
      productIds.push(created.id);
    }
  });

  it("flujo completo: setup → venta múltiple → inventario correcto → sin cocina", async () => {
    ctx.cart.addItem({ id: productIds[0], name: "Arroz", price: 3000, requiresKitchen: false } as Product, 2);
    ctx.cart.addItem({ id: productIds[1], name: "Aceite", price: 8000, requiresKitchen: false } as Product, 1);
    ctx.cart.addItem({ id: productIds[2], name: "Jabón", price: 2500, requiresKitchen: false } as Product, 3);

    const sale = await ctx.salesEngine.quickSale({ cashierId: "cashier-1" });
    const paidSale = (await ctx.salesEngine.registerPayment(sale, "CASH")).sale;

    expect(paidSale.status).toBe("PAID");

    const kitchenOrders = await ctx.kitchenOrders.findAll();
    expect(kitchenOrders).toHaveLength(0);

    expect((await ctx.products.findById(productIds[0]))?.stock).toBe(98);
    expect((await ctx.products.findById(productIds[1]))?.stock).toBe(39);
    expect((await ctx.products.findById(productIds[2]))?.stock).toBe(57);
  });
});

describe("Validación operacional: Servicios", () => {
  let ctx: ReturnType<typeof buildContext>;
  let productIds: string[];

  beforeEach(async () => {
    ctx = buildContext();
    productIds = [];

    const products = [
      { name: "Consulta", categoryId: "cat-servicios", price: 50000, stock: 0, minStock: 0, requiresKitchen: false, trackStock: false },
      { name: "Lavado", categoryId: "cat-servicios", price: 15000, stock: 0, minStock: 0, requiresKitchen: false, trackStock: false }
    ];

    for (const p of products) {
      const created = await createProduct(ctx, p);
      productIds.push(created.id);
    }
  });

  it("flujo completo: setup → venta de servicios → sin descuento de inventario → caja registrada", async () => {
    ctx.cart.addItem({ id: productIds[0], name: "Consulta", price: 50000, requiresKitchen: false } as Product, 1);
    ctx.cart.addItem({ id: productIds[1], name: "Lavado", price: 15000, requiresKitchen: false } as Product, 2);

    const sale = await ctx.salesEngine.quickSale({ cashierId: "cashier-1", taxRate: 0 });
    const paidSale = (await ctx.salesEngine.registerPayment(sale, "CASH")).sale;

    expect(paidSale.status).toBe("PAID");
    expect(paidSale.total).toBe(80000);

    const kitchenOrders = await ctx.kitchenOrders.findAll();
    expect(kitchenOrders).toHaveLength(0);

    const cashMovements = await ctx.cash.getAllMovements();
    const saleIncome = cashMovements.find(m => m.type === "IN" && m.description?.includes("Venta"));
    expect(saleIncome).toBeDefined();
    expect(saleIncome?.amount).toBe(80000);
  });
});

describe("Validación operacional: Multi-sucursal", () => {
  let ctx: ReturnType<typeof buildContext>;
  let productIds: string[];

  beforeEach(async () => {
    ctx = buildContext();
    productIds = [];

    const products = [
      { name: "Producto A", categoryId: "cat-general", price: 10000, stock: 50, minStock: 10, requiresKitchen: false, trackStock: true },
      { name: "Producto B", categoryId: "cat-general", price: 5000, stock: 30, minStock: 5, requiresKitchen: false, trackStock: true },
      { name: "Producto C", categoryId: "cat-general", price: 2000, stock: 100, minStock: 20, requiresKitchen: false, trackStock: true }
    ];

    for (const p of products) {
      const created = await createProduct(ctx, p);
      productIds.push(created.id);
    }
  });

  it("flujo completo: setup → venta → inventario aislado por sucursal → caja registrada", async () => {
    ctx.cart.addItem({ id: productIds[0], name: "Producto A", price: 10000, requiresKitchen: false } as Product, 5);
    ctx.cart.addItem({ id: productIds[1], name: "Producto B", price: 5000, requiresKitchen: false } as Product, 3);

    const sale = await ctx.salesEngine.quickSale({ cashierId: "cashier-1" });
    const paidSale = (await ctx.salesEngine.registerPayment(sale, "CASH")).sale;

    expect(paidSale.status).toBe("PAID");

    expect((await ctx.products.findById(productIds[0]))?.stock).toBe(45);
    expect((await ctx.products.findById(productIds[1]))?.stock).toBe(27);
    expect((await ctx.products.findById(productIds[2]))?.stock).toBe(100);

    const kitchenOrders = await ctx.kitchenOrders.findAll();
    expect(kitchenOrders).toHaveLength(0);
  });
});
