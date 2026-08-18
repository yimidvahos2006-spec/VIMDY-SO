import { describe, it, expect } from "vitest";

import { Product, Sale, CashMovement, KitchenOrder } from "../../src/core/entities/Entities";
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
import { FakeProductRepository } from "../fakes/FakeProductRepository";
import { InMemoryRepository } from "../fakes/InMemoryRepository";

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

  return { salesEngine, inventory, products, sales, receipts, cashMovements };
}

describe("Smoke: flujo real de POS", () => {
  it("crea, cobra y reintenta una venta sin duplicar inventario, caja ni comprobante", async () => {
    const { salesEngine, products, sales, receipts, cashMovements } = buildContext();

    const product: Product = {
      id: "pos-product",
      name: "Producto POS",
      categoryId: "cat-pos",
      price: 10000,
      stock: 10,
      minStock: 0,
      lastUpdated: new Date(),
      active: true
    };

    await products.save(product);

    const sale = await salesEngine.createSale({
      id: "sale-pos-flow",
      type: "QUICK",
      items: [{ productId: product.id, quantity: 2, price: product.price }],
      cashierId: "cashier-1",
      taxRate: 0
    });

    expect(sale.subtotal).toBe(20000);
    expect(sale.total).toBe(20000);
    expect((await products.findById(product.id))?.stock).toBe(8);

    const { sale: paidSale, payment } = await salesEngine.registerPayment(sale, "MIXED", {
      received: 20000,
      mixed: { cash: 10000, card: 10000 },
      reference: "ref-pos-flow"
    });

    expect(payment.method).toBe("MIXED");
    expect(payment.total).toBe(20000);
    expect(payment.received).toBe(20000);
    expect(payment.change).toBe(0);
    expect(paidSale.status).toBe("PAID");

    const receipt = await salesEngine.getReceiptBySaleId(paidSale.id);
    expect(receipt?.total).toBe(20000);
    expect((await sales.findAll())).toHaveLength(1);
    expect((await receipts.findAll())).toHaveLength(1);
    expect((await cashMovements.findAll())).toHaveLength(1);
    expect((await cashMovements.findAll())[0].amount).toBe(20000);

    const retriedSale = await salesEngine.createSale({
      id: "sale-pos-flow",
      type: "QUICK",
      items: [{ productId: product.id, quantity: 2, price: product.price }],
      cashierId: "cashier-1",
      taxRate: 0
    });

    expect(retriedSale.id).toBe(sale.id);
    expect((await products.findById(product.id))?.stock).toBe(8);
    expect((await sales.findAll())).toHaveLength(1);
    expect((await receipts.findAll())).toHaveLength(1);
    expect((await cashMovements.findAll())).toHaveLength(1);
  });

  it("rechaza ventas con producto inactivo o stock insuficiente sin modificar stock", async () => {
    const { salesEngine, products } = buildContext();

    const inactiveProduct: Product = {
      id: "inactive-product",
      name: "Producto inactivo",
      categoryId: "cat-pos",
      price: 5000,
      stock: 10,
      minStock: 0,
      lastUpdated: new Date(),
      active: false
    };

    await products.save(inactiveProduct);

    await expect(
      salesEngine.createSale({
        id: "sale-inactive",
        type: "QUICK",
        items: [{ productId: inactiveProduct.id, quantity: 1, price: inactiveProduct.price }],
        cashierId: "cashier-1",
        taxRate: 0
      })
    ).rejects.toThrow(/inactivo/);

    const insufficientProduct: Product = {
      id: "insufficient-product",
      name: "Producto insuficiente",
      categoryId: "cat-pos",
      price: 5000,
      stock: 2,
      minStock: 0,
      lastUpdated: new Date(),
      active: true
    };

    await products.save(insufficientProduct);

    await expect(
      salesEngine.createSale({
        id: "sale-insufficient",
        type: "QUICK",
        items: [{ productId: insufficientProduct.id, quantity: 3, price: insufficientProduct.price }],
        cashierId: "cashier-1",
        taxRate: 0
      })
    ).rejects.toThrow(/Stock insuficiente/);

    expect((await products.findById(inactiveProduct.id))?.stock).toBe(10);
    expect((await products.findById(insufficientProduct.id))?.stock).toBe(2);
  });
});
