// tests/smoke/reembolso-parcial.test.ts
/* ===========================================================================
   SMOKE TEST — Reembolso parcial
   ---------------------------------------------------------------------------
   Bloqueante #3 de la auditoría: "SalesEngine solo puede reembolsar la
   venta completa; no hay forma de devolver 1 o 2 productos de una venta
   con varios ítems." Este test cubre el método nuevo que cierra ese hueco:
   SalesEngine.partialRefundSale().

   Qué cubre (con dobles de prueba en memoria, sin tocar Supabase):
     1. Una venta de 2 productos distintos se cobra normalmente.
     2. Se reembolsa parcialmente solo 1 unidad de 1 de los productos:
        - el inventario repone SOLO esa unidad, no la venta entera.
        - cae en caja un egreso por el monto proporcional (no el total
          de la venta).
        - la venta queda en el mismo status (PAID/CLOSED), no REFUNDED,
          porque todavía quedan unidades sin devolver.
     3. getRefundableQuantities() refleja lo ya devuelto y no permite
        pedir de nuevo más de lo que queda.
     4. Si se termina de devolver TODO lo que quedaba, la venta pasa a
        REFUNDED sola, igual que un reembolso total.
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

  return { salesEngine, products, cart, kitchenOrders, cashMovements };
}

const BURGER: Product = {
  id: "prod-burger",
  name: "Hamburguesa Clásica",
  categoryId: "cat-comidas",
  price: 18000,
  stock: 10,
  minStock: 2,
  lastUpdated: new Date()
};

const SODA: Product = {
  id: "prod-soda",
  name: "Gaseosa 400ml",
  categoryId: "cat-bebidas",
  price: 4000,
  stock: 20,
  minStock: 4,
  lastUpdated: new Date()
};

describe("Smoke: reembolso parcial", () => {
  let ctx: ReturnType<typeof buildSalesEngine>;
  let paidSale: Sale;

  beforeEach(async () => {
    ctx = buildSalesEngine();
    await ctx.products.save(BURGER);
    await ctx.products.save(SODA);

    // 2 hamburguesas + 3 gaseosas, cobradas de una.
    ctx.cart.addItem(BURGER, 2);
    ctx.cart.addItem(SODA, 3);

    const created = await ctx.salesEngine.quickSale({ cashierId: "cashier-1" });
    const { sale } = await ctx.salesEngine.registerPayment(created, "CASH");
    paidSale = sale;
  });

  it("devuelve solo la cantidad pedida, no la venta entera", async () => {
    const burgerBeforeRefund = await ctx.products.findById(BURGER.id);
    expect(burgerBeforeRefund?.stock).toBe(8); // 10 - 2

    const { sale: refundedSale, amount } = await ctx.salesEngine.partialRefundSale(
      paidSale.id,
      [{ productId: BURGER.id, quantity: 1 }],
      "Cliente devolvió una hamburguesa",
      "cashier-1"
    );

    // La venta sigue viva (todavía quedan 1 hamburguesa y 3 gaseosas sin
    // devolver) — NO pasa a REFUNDED por un reembolso parcial a medias.
    expect(refundedSale.status).toBe("PAID");
    expect(refundedSale.refunds).toHaveLength(1);
    expect(refundedSale.refunds?.[0].items).toEqual([
      { productId: BURGER.id, quantity: 1 }
    ]);

    // El monto reembolsado es proporcional a 1 hamburguesa, no al total
    // de la venta ($18.000 + su parte de impuesto, no los $18.000+$12.000
    // completos de la venta).
    expect(amount).toBeGreaterThan(0);
    expect(amount).toBeLessThan(paidSale.total);

    // Solo se repuso al inventario 1 hamburguesa, no las 2 originales.
    const burgerAfterRefund = await ctx.products.findById(BURGER.id);
    expect(burgerAfterRefund?.stock).toBe(9); // 8 + 1, no 10

    // La gaseosa no se tocó — no era parte de este reembolso.
    const sodaAfterRefund = await ctx.products.findById(SODA.id);
    expect(sodaAfterRefund?.stock).toBe(17); // sin cambios

    // Cayó un egreso en caja por el monto parcial (además del ingreso
    // original del cobro) — 2 movimientos en total, no el reembolso
    // completo de la venta.
    const movements = await ctx.cashMovements.findAll();
    expect(movements).toHaveLength(2);
    const refundMovement = movements.find(m => m.type === "OUT");
    expect(refundMovement?.amount).toBe(amount);
  });

  it("no deja devolver más unidades de las que quedan disponibles", async () => {
    await ctx.salesEngine.partialRefundSale(
      paidSale.id,
      [{ productId: BURGER.id, quantity: 1 }],
      "Primera devolución",
      "cashier-1"
    );

    // Ya solo queda 1 hamburguesa reembolsable (compró 2, devolvió 1).
    const stillRefundableSale = await ctx.salesEngine.getSale(paidSale.id);
    const refundable = ctx.salesEngine.getRefundableQuantities(stillRefundableSale!);
    expect(refundable[BURGER.id]).toBe(1);

    // Pedir 2 más (cuando solo queda 1) se rechaza.
    await expect(
      ctx.salesEngine.partialRefundSale(
        paidSale.id,
        [{ productId: BURGER.id, quantity: 2 }],
        "Intento de devolver de más",
        "cashier-1"
      )
    ).rejects.toThrow(/REFUND_EXCEEDS_AVAILABLE/);
  });

  it("si se termina de devolver todo lo que quedaba, la venta pasa a REFUNDED sola", async () => {
    // Devuelve TODO lo que se compró, en 2 reembolsos parciales separados
    // (como si el cliente volviera dos veces).
    await ctx.salesEngine.partialRefundSale(
      paidSale.id,
      [{ productId: BURGER.id, quantity: 2 }],
      "Devuelve las 2 hamburguesas",
      "cashier-1"
    );

    const { sale: finalSale } = await ctx.salesEngine.partialRefundSale(
      paidSale.id,
      [{ productId: SODA.id, quantity: 3 }],
      "Devuelve las 3 gaseosas",
      "cashier-1"
    );

    expect(finalSale.status).toBe("REFUNDED");
    expect(finalSale.refunds).toHaveLength(2);

    // Con la venta ya en REFUNDED, un reembolso adicional (total o
    // parcial) debe rechazarse — no se puede reembolsar dos veces.
    await expect(
      ctx.salesEngine.partialRefundSale(
        paidSale.id,
        [{ productId: BURGER.id, quantity: 1 }],
        "Intento tardío",
        "cashier-1"
      )
    ).rejects.toThrow(/SALE_NOT_PAID/);
  });
});