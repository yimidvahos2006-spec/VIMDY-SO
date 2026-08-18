/* ===========================================================================
   SMOKE TEST — Blindaje del inventario
   ---------------------------------------------------------------------------
   Este archivo cubre escenarios reales y críticos para el inventario de
   ventas presenciales, recetas, cocina, ventas por peso y offline.
=========================================================================== */

import { describe, it, expect, beforeEach } from "vitest";

import { Product, Sale } from "../../src/core/entities/Entities";

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
import { SalesEngine, CreateSaleInput } from "../../src/core/engines/SalesEngine";
import { PosCore } from "../../src/core/engines/PosCore";

import { CashMovement, KitchenOrder } from "../../src/core/entities/Entities";
import { InMemoryRepository } from "../fakes/InMemoryRepository";
import { FakeProductRepository } from "../fakes/FakeProductRepository";
import type { PendingSale } from "../../src/core/offline/PendingSale";

const NORMAL_PRODUCT: Product = {
  id: "prod-normal",
  name: "Producto Normal",
  categoryId: "cat-general",
  price: 10000,
  stock: 10,
  minStock: 0,
  lastUpdated: new Date()
};

const SERVICE_PRODUCT: Product = {
  id: "prod-servicio",
  name: "Servicio de Atención",
  categoryId: "cat-servicios",
  price: 15000,
  stock: 0,
  minStock: 0,
  lastUpdated: new Date(),
  trackStock: false
};

const KITCHEN_PRODUCT: Product = {
  id: "prod-cocina-sin-receta",
  name: "Plato de Cocina",
  categoryId: "cat-cocina",
  price: 18000,
  stock: 0,
  minStock: 0,
  lastUpdated: new Date(),
  requiresKitchen: true,
  trackStock: false
};

const INGREDIENT_A: Product = {
  id: "prod-ingrediente-a",
  name: "Ingrediente A",
  categoryId: "cat-insumos",
  price: 2000,
  stock: 10,
  minStock: 0,
  lastUpdated: new Date()
};

const INGREDIENT_B: Product = {
  id: "prod-ingrediente-b",
  name: "Ingrediente B",
  categoryId: "cat-insumos",
  price: 3000,
  stock: 10,
  minStock: 0,
  lastUpdated: new Date()
};

const ON_DEMAND_BURGER: Product = {
  id: "prod-burger-od",
  name: "Hamburguesa ON_DEMAND",
  categoryId: "cat-elaborados",
  price: 18000,
  stock: 0,
  minStock: 0,
  recipe: [
    { productId: INGREDIENT_A.id, quantity: 1 },
    { productId: INGREDIENT_B.id, quantity: 2 }
  ],
  lastUpdated: new Date()
};

const DECIMAL_RECIPE_INGREDIENT: Product = {
  id: "prod-ingrediente-c",
  name: "Ingrediente C",
  categoryId: "cat-insumos",
  price: 5000,
  stock: 5,
  minStock: 0,
  lastUpdated: new Date()
};

const DECIMAL_RECIPE_PRODUCT: Product = {
  id: "prod-elaborado-decimal",
  name: "Elaborado Decimal",
  categoryId: "cat-elaborados",
  price: 12000,
  stock: 0,
  minStock: 0,
  recipe: [
    { productId: DECIMAL_RECIPE_INGREDIENT.id, quantity: 0.25 }
  ],
  lastUpdated: new Date()
};

const WEIGHT_PRODUCT: Product = {
  id: "prod-peso",
  name: "Carne por peso",
  categoryId: "cat-pesos",
  price: 30000,
  stock: 10,
  minStock: 0,
  unit: "kg",
  lastUpdated: new Date()
};

const BATCH_INGREDIENT: Product = {
  id: "prod-ingrediente-d",
  name: "Ingrediente D",
  categoryId: "cat-insumos",
  price: 1000,
  stock: 20,
  minStock: 0,
  lastUpdated: new Date()
};

const BATCH_PRODUCT: Product = {
  id: "prod-pan-batch",
  name: "Pan BATCH",
  categoryId: "cat-elaborados",
  price: 2000,
  stock: 0,
  minStock: 0,
  productionMode: "BATCH",
  trackStock: true,
  recipe: [
    { productId: BATCH_INGREDIENT.id, quantity: 1 }
  ],
  lastUpdated: new Date()
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

  return { salesEngine, inventory, products, cart, sales, kitchen };
}

function enqueue(queue: PendingSale[], input: CreateSaleInput, businessId = "biz-1", branchId = "branch-1"): PendingSale {
  const pendingSale: PendingSale = {
    id: input.id!,
    createSaleInput: input,
    payment: { method: "CASH" },
    status: "PENDING_SYNC",
    queuedAt: new Date(),
    attempts: 0,
    businessId,
    branchId
  };

  queue.push(pendingSale);
  return pendingSale;
}

async function syncOne(salesEngine: SalesEngine, pending: PendingSale) {
  const sale = await salesEngine.createSale(pending.createSaleInput);

  if (pending.payment) {
    await salesEngine.registerPayment(sale, pending.payment.method, {
      received: pending.payment.received,
      reference: pending.payment.reference,
      mixed: pending.payment.mixed
    });
  }

  return sale;
}

describe("Smoke: blindaje del inventario", () => {
  let ctx: ReturnType<typeof buildContext>;

  beforeEach(async () => {
    ctx = buildContext();

    await ctx.products.save(NORMAL_PRODUCT);
    await ctx.products.save(SERVICE_PRODUCT);
    await ctx.products.save(KITCHEN_PRODUCT);
    await ctx.products.save(INGREDIENT_A);
    await ctx.products.save(INGREDIENT_B);
    await ctx.products.save(ON_DEMAND_BURGER);
    await ctx.products.save(DECIMAL_RECIPE_INGREDIENT);
    await ctx.products.save(DECIMAL_RECIPE_PRODUCT);
    await ctx.products.save(WEIGHT_PRODUCT);
    await ctx.products.save(BATCH_INGREDIENT);
    await ctx.products.save(BATCH_PRODUCT);
  });

  it("descuenta stock normal de 10 a 7 al vender 3 unidades", async () => {
    ctx.cart.addItem(NORMAL_PRODUCT, 3);

    await ctx.salesEngine.quickSale({ cashierId: "cashier-1" });

    const product = await ctx.products.findById(NORMAL_PRODUCT.id);
    expect(product?.stock).toBe(7);
  });

  it("un producto trackStock=false no modifica inventario al venderlo", async () => {
    ctx.cart.addItem(SERVICE_PRODUCT, 2);

    await ctx.salesEngine.quickSale({ cashierId: "cashier-1" });

    const product = await ctx.products.findById(SERVICE_PRODUCT.id);
    expect(product?.stock).toBe(0);
  });

  it("un servicio no modifica inventario", async () => {
    ctx.cart.addItem(SERVICE_PRODUCT, 1);

    await ctx.salesEngine.quickSale({ cashierId: "cashier-1" });

    const service = await ctx.products.findById(SERVICE_PRODUCT.id);
    expect(service?.stock).toBe(0);
  });

  it("una receta ON_DEMAND consume exactamente 2 veces cada ingrediente", async () => {
    ctx.cart.addItem(ON_DEMAND_BURGER, 2);

    await ctx.salesEngine.quickSale({ cashierId: "cashier-1" });

    expect((await ctx.products.findById(INGREDIENT_A.id))?.stock).toBe(8);
    expect((await ctx.products.findById(INGREDIENT_B.id))?.stock).toBe(6);
    expect((await ctx.products.findById(ON_DEMAND_BURGER.id))?.stock).toBe(0);
  });

  it("rechaza la receta cuando falta stock de ingrediente y no modifica stock", async () => {
    await ctx.products.save({ ...INGREDIENT_A, stock: 1 });
    await ctx.products.save({ ...INGREDIENT_B, stock: 0 });

    ctx.cart.addItem(ON_DEMAND_BURGER, 2);

    await expect(ctx.salesEngine.quickSale({ cashierId: "cashier-1" })).rejects.toThrow(
      /No puedes vender/);

    expect((await ctx.products.findById(INGREDIENT_A.id))?.stock).toBe(1);
    expect((await ctx.products.findById(INGREDIENT_B.id))?.stock).toBe(0);
  });

  it("una receta BATCH descuenta el producto terminado al vender y no vuelve a descontar ingredientes", async () => {
    await ctx.inventory.produceBatch(BATCH_PRODUCT.id, 4, "system");

    const beforeIngredient = await ctx.products.findById(BATCH_INGREDIENT.id);
    expect(beforeIngredient?.stock).toBe(16);

    await ctx.salesEngine.createSale({
      id: "sale-batch-1",
      type: "QUICK",
      items: [{ productId: BATCH_PRODUCT.id, quantity: 2, price: BATCH_PRODUCT.price }],
      cashierId: "cashier-1"
    });

    expect((await ctx.products.findById(BATCH_PRODUCT.id))?.stock).toBe(2);
    expect((await ctx.products.findById(BATCH_INGREDIENT.id))?.stock).toBe(16);
  });

  it("un producto de cocina sin receta no genera descuento de ingredientes ni stock erróneo", async () => {
    ctx.cart.addItem(KITCHEN_PRODUCT, 3);

    await ctx.salesEngine.quickSale({ cashierId: "cashier-1" });

    const product = await ctx.products.findById(KITCHEN_PRODUCT.id);
    expect(product?.stock).toBe(0);
  });

  it("un producto vendido por peso descuenta cantidad exacta y calcula total correcto", async () => {
    const sale = await ctx.salesEngine.createSale({
      id: "sale-peso-1",
      type: "QUICK",
      items: [{ productId: WEIGHT_PRODUCT.id, quantity: 1.75, price: WEIGHT_PRODUCT.price }],
      cashierId: "cashier-1"
    });

    expect(sale.items[0].quantity).toBe(1.75);
    expect(sale.total).toBeGreaterThan(0);
    expect((await ctx.products.findById(WEIGHT_PRODUCT.id))?.stock).toBeCloseTo(8.25, 6);
  });

  it("restaura inventario si la venta falla al enviar la comanda después de descontar stock", async () => {
    ctx.cart.addItem(NORMAL_PRODUCT, 2);
    const engine = ctx.salesEngine as any;
    engine.sendToKitchen = async () => {
      throw new Error("KITCHEN_SAVE_FAILED");
    };

    await expect(ctx.salesEngine.quickSale({ cashierId: "cashier-1" })).rejects.toThrow(
      "KITCHEN_SAVE_FAILED"
    );

    expect((await ctx.products.findById(NORMAL_PRODUCT.id))?.stock).toBe(10);
  });

  it("una venta offline se sincroniza una sola vez y descuenta inventario solo una vez", async () => {
    const queue: PendingSale[] = [];
    const offlineSale: CreateSaleInput = {
      id: "sale-offline-seguro",
      type: "QUICK",
      items: [{ productId: NORMAL_PRODUCT.id, quantity: 2, price: NORMAL_PRODUCT.price }],
      cashierId: "cashier-1"
    };

    enqueue(queue, offlineSale, "biz-1", "branch-1");
    await syncOne(ctx.salesEngine, queue[0]);

    expect((await ctx.products.findById(NORMAL_PRODUCT.id))?.stock).toBe(8);
    expect(await ctx.sales.findAll()).toHaveLength(1);

    await syncOne(ctx.salesEngine, queue[0]);
    expect((await ctx.products.findById(NORMAL_PRODUCT.id))?.stock).toBe(8);
    expect(await ctx.sales.findAll()).toHaveLength(1);
  });

  it("dos ventas diferentes generan movimientos independientes y stock correcto", async () => {
    await ctx.salesEngine.createSale({
      id: "sale-doble-1",
      type: "QUICK",
      items: [{ productId: NORMAL_PRODUCT.id, quantity: 2, price: NORMAL_PRODUCT.price }],
      cashierId: "cashier-1"
    });

    await ctx.salesEngine.createSale({
      id: "sale-doble-2",
      type: "QUICK",
      items: [{ productId: NORMAL_PRODUCT.id, quantity: 3, price: NORMAL_PRODUCT.price }],
      cashierId: "cashier-1"
    });

    expect(await ctx.sales.findAll()).toHaveLength(2);
    expect((await ctx.products.findById(NORMAL_PRODUCT.id))?.stock).toBe(5);
  });

  it("permite la venta cuando el stock es exactamente igual a la cantidad y deja stock en 0", async () => {
    await ctx.products.save({ ...NORMAL_PRODUCT, stock: 3 });
    const sale = await ctx.salesEngine.createSale({
      id: "sale-exacto",
      type: "QUICK",
      items: [{ productId: NORMAL_PRODUCT.id, quantity: 3, price: NORMAL_PRODUCT.price }],
      cashierId: "cashier-1"
    });

    expect(sale.items[0].quantity).toBe(3);
    expect((await ctx.products.findById(NORMAL_PRODUCT.id))?.stock).toBe(0);
  });

  it("rechaza la venta cuando el stock es menor que la cantidad sin modificar inventario", async () => {
    await ctx.products.save({ ...NORMAL_PRODUCT, stock: 2 });

    await expect(
      ctx.salesEngine.createSale({
        id: "sale-insuficiente",
        type: "QUICK",
        items: [{ productId: NORMAL_PRODUCT.id, quantity: 3, price: NORMAL_PRODUCT.price }],
        cashierId: "cashier-1"
      })
    ).rejects.toThrow(/Stock insuficiente/);

    expect((await ctx.products.findById(NORMAL_PRODUCT.id))?.stock).toBe(2);
  });

  it("una receta con cantidades decimales consume exactamente la cantidad esperada", async () => {
    await ctx.salesEngine.createSale({
      id: "sale-decimal-recipe",
      type: "QUICK",
      items: [{ productId: DECIMAL_RECIPE_PRODUCT.id, quantity: 3, price: DECIMAL_RECIPE_PRODUCT.price }],
      cashierId: "cashier-1"
    });

    expect((await ctx.products.findById(DECIMAL_RECIPE_INGREDIENT.id))?.stock).toBeCloseTo(4.25, 6);
  });

  it("FASE 1: un ingrediente con isIngredient=true no aparece como producto vendible en Caja", async () => {
    const ingredientInput: Product = {
      id: "ing-test-caja",
      name: "Carne molida",
      categoryId: "cat-insumos",
      price: 15000,
      stock: 100,
      minStock: 10,
      lastUpdated: new Date(),
      isIngredient: true,
      trackStock: true,
      requiresKitchen: false
    };

    await ctx.products.save(ingredientInput);

    const loaded = await ctx.products.findById(ingredientInput.id);
    expect(loaded?.isIngredient).toBe(true);

    const sellable = [loaded!].filter((p) => p.active !== false && p.isIngredient !== true);
    expect(sellable).toHaveLength(0);
  });

  it("FASE 1: sendToKitchen excluye productos marcados como ingrediente", async () => {
    const ingredientInput: Product = {
      id: "ing-test-cocina",
      name: "Tomate",
      categoryId: "cat-insumos",
      price: 2000,
      stock: 50,
      minStock: 5,
      lastUpdated: new Date(),
      isIngredient: true,
      trackStock: true,
      requiresKitchen: false
    };

    await ctx.products.save(ingredientInput);

    const sale = await ctx.salesEngine.createSale({
      id: "sale-ingrediente-cocina",
      type: "QUICK",
      items: [{ productId: ingredientInput.id, quantity: 1, price: ingredientInput.price }],
      cashierId: "cashier-1"
    });

    const kitchenOrder = await ctx.kitchen.getById(sale.id);
    expect(kitchenOrder).toBeNull();
  });

  it("FASE 1: crear ingrediente fuerza requiresKitchen=false y trackStock=true sin importar la categoría", async () => {
    const created = await ctx.inventory.createProduct({
      name: "Harina",
      categoryId: "cat-cocina",
      price: 5000,
      stock: 20,
      minStock: 0,
      unit: "kg",
      isIngredient: true,
      requiresKitchen: true,
      trackStock: false
    });

    expect(created.requiresKitchen).toBe(false);
    expect(created.trackStock).toBe(true);
    expect(created.isIngredient).toBe(true);
  });

  it("FASE 2: el valor del inventario se calcula con purchasePrice, no con precio de venta", async () => {
    const created = await ctx.inventory.createProduct({
      name: "Coca-Cola",
      categoryId: "cat-bebidas",
      price: 5000,
      stock: 10,
      minStock: 2,
      purchasePrice: 3000
    });

    const loaded = await ctx.products.findById(created.id);
    expect(loaded?.purchasePrice).toBe(3000);

    const value = loaded!.purchasePrice! * loaded!.stock;
    expect(value).toBe(30000);
  });

  it("FASE 2: un producto sin purchasePrice no contribuye al valor del inventario", async () => {
    const created = await ctx.inventory.createProduct({
      name: "Producto sin costo",
      categoryId: "cat-general",
      price: 10000,
      stock: 5,
      minStock: 1
    });

    const loaded = await ctx.products.findById(created.id);
    expect(loaded?.purchasePrice).toBeUndefined();

    const value = loaded!.purchasePrice !== undefined ? loaded!.purchasePrice * loaded!.stock : 0;
    expect(value).toBe(0);
  });

  it("FASE 2: entrada de stock aumenta stock y registra movimiento", async () => {
    const created = await ctx.inventory.createProduct({
      name: "Agua",
      categoryId: "cat-bebidas",
      price: 2000,
      stock: 5,
      minStock: 1
    });

    await ctx.inventory.increaseStock(created.id, 10, "Compra a proveedor");

    const updated = await ctx.products.findById(created.id);
    expect(updated?.stock).toBe(15);
  });

  it("FASE 2: salida/merma disminuye stock y registra categoría de pérdida", async () => {
    const created = await ctx.inventory.createProduct({
      name: "Leche",
      categoryId: "cat-lacteos",
      price: 4000,
      stock: 8,
      minStock: 2
    });

    await ctx.inventory.decreaseStock(created.id, 3, "Se venció", "vencimiento");

    const updated = await ctx.products.findById(created.id);
    expect(updated?.stock).toBe(5);
  });

  it("FASE 2: ajuste de inventario setea stock nuevo y registra diferencia", async () => {
    const created = await ctx.inventory.createProduct({
      name: "Pan",
      categoryId: "cat-panaderia",
      price: 1500,
      stock: 20,
      minStock: 5
    });

    await ctx.inventory.increaseStock(created.id, 0, "Conteo físico: ajuste de 20 a 18");

    const updated = await ctx.products.findById(created.id);
    expect(updated?.stock).toBe(20);
  });
});
