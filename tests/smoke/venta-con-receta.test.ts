// tests/smoke/venta-con-receta.test.ts
/* ===========================================================================
   SMOKE TEST — Venta con receta y venta por peso
   ---------------------------------------------------------------------------
   Cubre los casos críticos de inventario real para productos elaborados
   y para productos vendidos por peso/volumen.

   Qué cubre:
     1. Un producto con receta ON_DEMAND descuenta solo sus ingredientes y
        no inventa descuento sobre el producto terminado.
     2. Una venta falla si falta algún ingrediente de la receta.
     3. Un producto vendido por peso descuenta la cantidad real y calcula
        el precio correcto.
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
import { SalesEngine } from "../../src/core/engines/SalesEngine";
import { PosCore } from "../../src/core/engines/PosCore";

import { CashMovement, KitchenOrder } from "../../src/core/entities/Entities";
import { InMemoryRepository } from "../fakes/InMemoryRepository";
import { FakeProductRepository } from "../fakes/FakeProductRepository";

const BREAD: Product = {
  id: "prod-pan",
  name: "Pan",
  categoryId: "cat-pan",
  price: 1000,
  stock: 50,
  minStock: 5,
  lastUpdated: new Date()
};

const MEAT: Product = {
  id: "prod-carne",
  name: "Carne",
  categoryId: "cat-insumos",
  price: 30000,
  stock: 20,
  minStock: 5,
  lastUpdated: new Date()
};

const CHEESE: Product = {
  id: "prod-queso",
  name: "Queso",
  categoryId: "cat-insumos",
  price: 8000,
  stock: 20,
  minStock: 5,
  lastUpdated: new Date()
};

const BURGER: Product = {
  id: "prod-burger",
  name: "Hamburguesa Premium",
  categoryId: "cat-comidas",
  price: 18000,
  stock: 0,
  minStock: 0,
  recipe: [
    { productId: BREAD.id, quantity: 1 },
    { productId: MEAT.id, quantity: 1 },
    { productId: CHEESE.id, quantity: 1 }
  ],
  lastUpdated: new Date()
};

const BEEF_BY_WEIGHT: Product = {
  id: "prod-carne-kg",
  name: "Carne a peso",
  categoryId: "cat-carnes",
  price: 30000,
  stock: 10,
  minStock: 1,
  unit: "kg",
  lastUpdated: new Date()
};

function buildSalesEngine() {
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

  return { salesEngine, products, cart };
}

describe("Smoke: venta con receta y venta por peso", () => {
  let ctx: ReturnType<typeof buildSalesEngine>;

  beforeEach(async () => {
    ctx = buildSalesEngine();
    await ctx.products.save(BREAD);
    await ctx.products.save(MEAT);
    await ctx.products.save(CHEESE);
    await ctx.products.save(BURGER);
    await ctx.products.save(BEEF_BY_WEIGHT);
  });

  it("descuenta solo los ingredientes de una receta ON_DEMAND y no el producto terminado", async () => {
    ctx.cart.addItem(BURGER, 2);

    const sale = await ctx.salesEngine.quickSale({ cashierId: "cashier-1" });

    expect(sale.items).toHaveLength(1);
    expect(sale.items[0].quantity).toBe(2);

    const burgerAfterSale = await ctx.products.findById(BURGER.id);
    expect(burgerAfterSale?.stock).toBe(0);

    const breadAfterSale = await ctx.products.findById(BREAD.id);
    const meatAfterSale = await ctx.products.findById(MEAT.id);
    const cheeseAfterSale = await ctx.products.findById(CHEESE.id);

    expect(breadAfterSale?.stock).toBe(48);
    expect(meatAfterSale?.stock).toBe(18);
    expect(cheeseAfterSale?.stock).toBe(18);
  });

  it("rechaza la venta de un producto con receta si falta stock de algún ingrediente", async () => {
    await ctx.products.save({ ...MEAT, stock: 1 });
    await ctx.products.save({ ...CHEESE, stock: 0 });

    ctx.cart.addItem(BURGER, 2);

    await expect(ctx.salesEngine.quickSale({ cashierId: "cashier-1" })).rejects.toThrow(
      /No puedes vender/);

    const breadAfterFail = await ctx.products.findById(BREAD.id);
    const meatAfterFail = await ctx.products.findById(MEAT.id);
    const cheeseAfterFail = await ctx.products.findById(CHEESE.id);

    expect(breadAfterFail?.stock).toBe(50);
    expect(meatAfterFail?.stock).toBe(1);
    expect(cheeseAfterFail?.stock).toBe(0);
  });

  it("descuenta correctamente un producto vendido por peso y calcula el precio total", async () => {
    const sale = await ctx.salesEngine.createSale({
      id: "sale-weight-1",
      type: "QUICK",
      items: [
        {
          productId: BEEF_BY_WEIGHT.id,
          quantity: 1.75,
          price: BEEF_BY_WEIGHT.price
        }
      ],
      cashierId: "cashier-1"
    });

    expect(sale.items[0].quantity).toBe(1.75);
    expect(sale.total).toBeGreaterThan(0);
    expect(sale.total).toBe(BEEF_BY_WEIGHT.price * 1.75 + (sale.tax ?? 0));

    const beefAfterSale = await ctx.products.findById(BEEF_BY_WEIGHT.id);
    expect(beefAfterSale?.stock).toBeCloseTo(8.25, 6);
  });
});
