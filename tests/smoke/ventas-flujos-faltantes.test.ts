// tests/smoke/ventas-flujos-faltantes.test.ts
/* ===========================================================================
    SMOKE TEST — Flujos de venta faltantes
    ---------------------------------------------------------------------------
    Cubre los escenarios de FASE 3 que no tenían prueba explícita:

      8.  Venta con cliente asociado.
      11. Pago con tarjeta (con referencia).
      12. Pago mixto (efectivo + tarjeta).
      13. Cambio correcto en pago en efectivo.
      15. Cancelación de venta y restauración de inventario.
      25. Integridad de totales (cart total == sale total).
      +   Precio del carrito preservado en venta de mostrador.
      +   Notas por item preservadas en la venta.

    Todos usan engines reales con dobles de prueba en memoria, sin tocar
    Supabase.
   =========================================================================== */

import { describe, it, expect, beforeEach } from "vitest";

import { Product, Sale, Customer, CashMovement, KitchenOrder } from "../../src/core/entities/Entities";
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

import { InMemoryRepository } from "../fakes/InMemoryRepository";
import { FakeProductRepository } from "../fakes/FakeProductRepository";

function buildSalesEngine() {
  const products = new FakeProductRepository();
  const sales = new InMemoryRepository<Sale>("sales");
  const receipts = new InMemoryRepository<Receipt>("receipts");
  const kitchenOrders = new InMemoryRepository<KitchenOrder>("kitchen_orders");
  const cashMovements = new InMemoryRepository<CashMovement>("cash_movements");
  const customers = new InMemoryRepository<Customer>("customers");
  const movements = new InMemoryRepository<any>("inventory_movements");
  const auditLogs = new InMemoryRepository<any>("audit_logs");

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

  return { salesEngine, products, cart, cashMovements, customers };
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

describe("Smoke: flujos de venta faltantes", () => {
  let ctx: ReturnType<typeof buildSalesEngine>;

  beforeEach(async () => {
    ctx = buildSalesEngine();
    await ctx.products.save(BURGER);
    await ctx.products.save(SODA);
  });

  it("FASE 3: una venta con cliente asociado persiste el customerId correctamente", async () => {
    const customerId = "cust-1";
    await ctx.customers.save({
      id: customerId,
      name: "Cliente Test",
      email: "test@test.com",
      phone: "3000000000",
      points: 0,
      createdAt: new Date()
    } as any);

    ctx.cart.addItem(BURGER, 1);
    const sale = await ctx.salesEngine.quickSale({
      cashierId: "cashier-1",
      customerId
    });

    expect(sale.customerId).toBe(customerId);
    const persisted = await ctx.salesEngine.getSale(sale.id);
    expect(persisted?.customerId).toBe(customerId);
  });

  it("FASE 3: pago con tarjeta registra la venta en PAID y el movimiento de caja", async () => {
    ctx.cart.addItem(BURGER, 1);
    const sale = await ctx.salesEngine.quickSale({ cashierId: "cashier-1" });

    const { sale: paidSale } = await ctx.salesEngine.registerPayment(
      sale,
      "CARD",
      { reference: "TAR-12345" }
    );

    expect(paidSale.status).toBe("PAID");
    expect(paidSale.paymentMethod).toBe("CARD");

    const movements = await ctx.cashMovements.findAll();
    expect(movements).toHaveLength(1);
    expect(movements[0].amount).toBe(paidSale.total);
  });

  it("FASE 3: pago mixto (efectivo + tarjeta) cubre el total y registra el movimiento correcto", async () => {
    ctx.cart.addItem(BURGER, 1);
    const sale = await ctx.salesEngine.quickSale({ cashierId: "cashier-1" });

    const { sale: paidSale } = await ctx.salesEngine.registerPayment(
      sale,
      "MIXED",
      {
        received: sale.total,
        reference: "MIX-REF",
        mixed: { cash: 10000, card: sale.total - 10000 }
      }
    );

    expect(paidSale.status).toBe("PAID");
    expect(paidSale.paymentMethod).toBe("MIXED");

    const movements = await ctx.cashMovements.findAll();
    expect(movements).toHaveLength(1);
    expect(movements[0].amount).toBe(paidSale.total);
    expect(movements[0].paymentMethod).toBe("MIXED");
  });

  it("FASE 3: el cambio se calcula correctamente en pago en efectivo", async () => {
    ctx.cart.addItem(BURGER, 1);
    const sale = await ctx.salesEngine.quickSale({ cashierId: "cashier-1" });

    const received = sale.total + 5000;
    const { payment } = await ctx.salesEngine.registerPayment(sale, "CASH", { received });

    expect(payment.change).toBe(5000);
    expect(payment.received).toBe(received);
    expect(payment.total).toBe(sale.total);
  });

  it("FASE 3: cancelar una venta pagada restaura el inventario y deja la venta en CANCELLED", async () => {
    const stockBefore = (await ctx.products.findById(BURGER.id))?.stock ?? 0;
    ctx.cart.addItem(BURGER, 2);
    const sale = await ctx.salesEngine.quickSale({ cashierId: "cashier-1" });
    await ctx.salesEngine.registerPayment(sale, "CASH");

    const stockAfterSale = (await ctx.products.findById(BURGER.id))?.stock ?? 0;
    expect(stockAfterSale).toBe(stockBefore - 2);

    const cancelled = await ctx.salesEngine.cancelSale(sale.id, "Cliente se arrepintió", "cashier-1");

    expect(cancelled.status).toBe("CANCELLED");
    const stockAfterCancel = (await ctx.products.findById(BURGER.id))?.stock ?? 0;
    expect(stockAfterCancel).toBe(stockBefore);
  });

  it("FASE 3: el total de la venta coincide con el carrito (sin descuentos globales)", async () => {
    ctx.cart.addItem(BURGER, 2);
    ctx.cart.addItem(SODA, 1);

    const cartTotal = ctx.cart.getTotal();
    const sale = await ctx.salesEngine.quickSale({ cashierId: "cashier-1" });

    expect(sale.subtotal).toBeCloseTo(cartTotal, 0);
    expect(sale.total).toBeGreaterThan(0);
    expect(sale.total).toBeGreaterThanOrEqual(sale.subtotal!);
  });

  it("FASE 3: el precio del carrito se preserva en la venta de mostrador", async () => {
    const customPrice = 9999;
    ctx.cart.addItem({ ...BURGER, price: customPrice }, 1);

    const sale = await ctx.salesEngine.quickSale({ cashierId: "cashier-1" });

    expect(sale.items[0].price).toBe(customPrice);
    expect(sale.items[0].quantity).toBe(1);
    expect(sale.total).toBeGreaterThan(0);
  });

  it("FASE 3: las notas por item se preservan en la venta", async () => {
    const note = "sin cebolla, con hielo";
    const sale = await ctx.salesEngine.quickSale({
      cashierId: "cashier-1",
      source: [
        {
          productId: BURGER.id,
          quantity: 1,
          price: BURGER.price,
          note
        }
      ]
    });

    expect(sale.items[0].note).toBe(note);
  });
});
