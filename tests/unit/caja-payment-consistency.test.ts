// tests/unit/caja-payment-consistency.test.ts
/* ===========================================================================
   UNIT/INTEGRATION TESTS — Caja payment atomicity, idempotency, concurrency
   ---------------------------------------------------------------------------
   Tests the real SalesEngine + CashEngine + InMemoryRepository stack for:
     A. pago normal
     B. pago + cambio
     C. doble click (idempotency retry)
     D. retry después de fallo
     E. dos llamadas simultáneas (same + different sale)
     F. pago fallido restaura inventario
     G. venta PAID no puede cobrarse dos veces
     H. paymentMethod persistido tras pago
     I. pago sin turno (fallback path no exige turno; RPC sí — verificado en SQL)
     J. reembolso tras pago
     K. reembolso parcial
     L. cancelación tras pago
=========================================================================== */

import { describe, it, expect, beforeEach, vi } from "vitest";

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

  return { salesEngine, products, cart, kitchenOrders, cashMovements, cash, sales };
}

const BURGER: Product = {
  id: "prod-burger-audit",
  name: "Hamburguesa Clásica",
  categoryId: "cat-comidas",
  price: 18000,
  stock: 10,
  minStock: 2,
  lastUpdated: new Date(),
};

describe("Caja: atomicidad e idempotencia de pagos", () => {
  let ctx: ReturnType<typeof buildSalesEngine>;

  beforeEach(async () => {
    ctx = buildSalesEngine();
    await ctx.products.save(BURGER);
  });

  it("A. pago normal: inventario, cocina y caja consistentes", async () => {
    ctx.cart.addItem(BURGER, 2);
    const sale = await ctx.salesEngine.quickSale({ cashierId: "cashier-1" });

    expect(sale.status).toBe("PENDING_PAYMENT");
    expect((await ctx.products.findById(BURGER.id))?.stock).toBe(8);

    const { sale: paidSale } = await ctx.salesEngine.registerPayment(sale, "CASH");

    expect(paidSale.status).toBe("PAID");
    const movements = await ctx.cashMovements.findAll();
    expect(movements).toHaveLength(1);
    expect(movements[0].type).toBe("IN");
    expect(movements[0].amount).toBe(sale.total);
    expect(movements[0].paymentMethod).toBe("CASH");
  });

  it("B. pago + cambio: se registran 2 movimientos (IN + OUT)", async () => {
    ctx.cart.addItem(BURGER, 1);
    const sale = await ctx.salesEngine.quickSale({ cashierId: "cashier-1" });

    const received = sale.total + 5000;
    const { sale: paidSale } = await ctx.salesEngine.registerPayment(
      sale, "CASH", { received }
    );

    expect(paidSale.status).toBe("PAID");
    const movements = await ctx.cashMovements.findAll();
    expect(movements).toHaveLength(2);

    const income = movements.find(m => m.type === "IN");
    const change = movements.find(m => m.type === "OUT");
    expect(income?.amount).toBe(sale.total);
    expect(change?.amount).toBe(5000);
  });

  it("C. doble click: retry de pago con la misma venta no duplica caja", async () => {
    ctx.cart.addItem(BURGER, 2);
    const sale = await ctx.salesEngine.quickSale({ cashierId: "cashier-1" });

    const { sale: paidSale } = await ctx.salesEngine.registerPayment(sale, "CASH");
    expect(paidSale.status).toBe("PAID");

    // IDEMPOTENCIA: reintento con la misma venta (ya PAID) → early return, no nuevo movimiento
    await ctx.salesEngine.registerPayment(paidSale, "CASH");

    const movements = await ctx.cashMovements.findAll();
    expect(movements).toHaveLength(1);
  });

  it("D. retry después de fallo: restaura inventario y luego paga", async () => {
    ctx.cart.addItem(BURGER, 2);
    const sale = await ctx.salesEngine.quickSale({ cashierId: "cashier-1" });

    // Mock que falla la primera vez, luego usa la implementación real
    vi.spyOn(ctx.cash, "registerSalePaymentAtomic").mockImplementationOnce(async () => {
      throw new Error("CASH_RPC_FAILED");
    });

    // Primer intento: falla, inventario restaurado
    await expect(ctx.salesEngine.registerPayment(sale, "CASH")).rejects.toThrow("CASH_RPC_FAILED");
    expect((await ctx.products.findById(BURGER.id))?.stock).toBe(10); // restaurado

    // Segundo intento: éxito
    const { sale: paidSale2 } = await ctx.salesEngine.registerPayment(sale, "CASH");
    expect(paidSale2.status).toBe("PAID");
    // Stock restaurado en el fallo y no readquirido en el retry (registerPayment no descuenta)
    expect((await ctx.products.findById(BURGER.id))?.stock).toBe(10);

    const movements = await ctx.cashMovements.findAll();
    expect(movements).toHaveLength(1); // solo un movimiento después del retry exitoso
  });

  it("E. dos llamadas simultáneas: venta diferente coexiste", async () => {
    ctx.cart.addItem(BURGER, 1);
    const sale1 = await ctx.salesEngine.quickSale({ cashierId: "cashier-1" });

    ctx.cart.clear();
    ctx.cart.addItem(BURGER, 2);
    const sale2 = await ctx.salesEngine.quickSale({ cashierId: "cashier-1" });

    await Promise.all([
      ctx.salesEngine.registerPayment(sale1, "CASH"),
      ctx.salesEngine.registerPayment(sale2, "CASH"),
    ]);

    const movements = await ctx.cashMovements.findAll();
    expect(movements).toHaveLength(2);
    expect(movements[0].amount).toBe(sale1.total);
    expect(movements[1].amount).toBe(sale2.total);
  });

  it("F. pago fallido: inventario restaurado, venta sigue PENDING_PAYMENT", async () => {
    ctx.cart.addItem(BURGER, 2);
    const sale = await ctx.salesEngine.quickSale({ cashierId: "cashier-1" });
    expect((await ctx.products.findById(BURGER.id))?.stock).toBe(8);

    vi.spyOn(ctx.cash, "registerSalePaymentAtomic").mockRejectedValue(
      new Error("RPC_TIMEOUT")
    );

    await expect(ctx.salesEngine.registerPayment(sale, "CASH")).rejects.toThrow(
      "RPC_TIMEOUT"
    );

    // Inventario restaurado
    expect((await ctx.products.findById(BURGER.id))?.stock).toBe(10);

    // Venta sigue PENDING_PAYMENT
    const unfreshSale = await ctx.salesEngine.getSale(sale.id);
    expect(unfreshSale?.status).toBe("PENDING_PAYMENT");

    // No movimientos de caja
    const movements = await ctx.cashMovements.findAll();
    expect(movements).toHaveLength(0);
  });

  it("G. venta PAID no puede cobrarse dos veces", async () => {
    ctx.cart.addItem(BURGER, 1);
    const sale = await ctx.salesEngine.quickSale({ cashierId: "cashier-1" });

    await ctx.salesEngine.registerPayment(sale, "CASH");

    // Reintento: el early return en registerPayment maneja esto
    const { sale: retriedSale } = await ctx.salesEngine.registerPayment(sale, "CASH");
    expect(retriedSale.status).toBe("PAID");

    // Solo 1 movimiento
    const movements = await ctx.cashMovements.findAll();
    expect(movements).toHaveLength(1);
  });

  it("H. paymentMethod se persiste después del pago", async () => {
    ctx.cart.addItem(BURGER, 1);
    const sale = await ctx.salesEngine.quickSale({ cashierId: "cashier-1" });

    const { sale: paidSale } = await ctx.salesEngine.registerPayment(sale, "CASH");
    expect(paidSale.paymentMethod).toBe("CASH");

    // Verificar que está persistido en el repositorio
    const stored = await ctx.sales.findById(sale.id);
    expect(stored?.paymentMethod).toBe("CASH");
    expect(stored?.status).toBe("PAID");
  });

  it("I. pago por transferencia queda pendiente y no genera movimiento financiero", async () => {
    ctx.cart.addItem(BURGER, 1);
    const sale = await ctx.salesEngine.quickSale({ cashierId: "cashier-1" });

    const { sale: pendingSale, payment } = await ctx.salesEngine.registerPayment(
      sale,
      "TRANSFER",
      { reference: "transfer-pending-001" }
    );

    expect(payment.success).toBe(false);
    expect(payment.verificationStatus).toBe("PENDING_VERIFICATION");
    expect(pendingSale.status).toBe("PENDING_PAYMENT");
    expect(pendingSale.paymentStatus).toBe("PENDING_VERIFICATION");
    expect((await ctx.cashMovements.findAll())).toHaveLength(0);
  });

  it("I.1 pago QR queda pendiente y no genera movimiento financiero", async () => {
    ctx.cart.addItem(BURGER, 1);
    const sale = await ctx.salesEngine.quickSale({ cashierId: "cashier-1" });

    const { sale: pendingSale, payment } = await ctx.salesEngine.registerPayment(
      sale,
      "QR",
      { reference: "qr-pending-001" }
    );

    expect(payment.success).toBe(false);
    expect(payment.verificationStatus).toBe("PENDING_VERIFICATION");
    expect(pendingSale.status).toBe("PENDING_PAYMENT");
    expect(pendingSale.paymentStatus).toBe("PENDING_VERIFICATION");
    expect((await ctx.cashMovements.findAll())).toHaveLength(0);
  });

  it("J. una referencia de tarjeta no confirma el pago ni registra caja", async () => {
    ctx.cart.addItem(BURGER, 1);
    const sale = await ctx.salesEngine.quickSale({ cashierId: "cashier-1" });

    const { sale: pendingSale, payment } = await ctx.salesEngine.registerPayment(sale, "CARD", {
      received: sale.total,
      reference: "card-ref-001",
    });

    expect(payment.success).toBe(false);
    expect(payment.verificationStatus).toBe("PENDING_VERIFICATION");
    expect(pendingSale.status).toBe("PENDING_PAYMENT");
    expect(pendingSale.paymentStatus).toBe("PENDING_VERIFICATION");
    expect(await ctx.cashMovements.findAll()).toHaveLength(0);
  });

  it("K. reembolso total después de pago: stock restaurado, egreso en caja", async () => {
    ctx.cart.addItem(BURGER, 2);
    const stockBefore = (await ctx.products.findById(BURGER.id))?.stock ?? 0;
    const sale = await ctx.salesEngine.quickSale({ cashierId: "cashier-1" });

    const { sale: paidSale } = await ctx.salesEngine.registerPayment(sale, "CASH");
    expect(paidSale.status).toBe("PAID");
    expect((await ctx.products.findById(BURGER.id))?.stock).toBe(stockBefore - 2);

    const { sale: refunded } = await ctx.salesEngine.refundSale(
      paidSale.id, "Reembolso total", "cashier-1"
    );
    expect(refunded.status).toBe("REFUNDED");

    const movements = await ctx.cashMovements.findAll();
    const income = movements.filter(m => m.type === "IN");
    const expense = movements.filter(m => m.type === "OUT");
    expect(income).toHaveLength(1); // ingreso original
    expect(expense.length).toBeGreaterThanOrEqual(1); // egreso de reembolso

    // Stock restaurado
    expect((await ctx.products.findById(BURGER.id))?.stock).toBe(stockBefore);
  });

  it("bloquea reembolsos de pagos externos sin cambiar caja, inventario ni venta", async () => {
    ctx.cart.addItem(BURGER, 1);
    const sale = await ctx.salesEngine.quickSale({ cashierId: "cashier-1" });
    const { sale: paidSale } = await ctx.salesEngine.registerPayment(sale, "CASH");
    const latestPaidSale = await ctx.sales.findById(paidSale.id);
    if (!latestPaidSale) {
      throw new Error("TEST_SALE_NOT_FOUND");
    }
    await ctx.sales.update({ ...latestPaidSale, paymentMethod: "CARD" });
    const externalSale = await ctx.sales.findById(paidSale.id);
    if (!externalSale) {
      throw new Error("TEST_SALE_NOT_FOUND");
    }

    const stockBeforeRefund = (await ctx.products.findById(BURGER.id))?.stock;
    const movementsBeforeRefund = await ctx.cashMovements.findAll();

    await expect(
      ctx.salesEngine.refundSale(externalSale.id, "Reembolso tarjeta", "cashier-1")
    ).rejects.toThrow("EXTERNAL_REFUND_REQUIRES_PROVIDER_CONFIRMATION");
    await expect(
      ctx.salesEngine.partialRefundSale(
        externalSale.id,
        [{ productId: BURGER.id, quantity: 1 }],
        "Reembolso parcial tarjeta",
        "cashier-1"
      )
    ).rejects.toThrow("EXTERNAL_REFUND_REQUIRES_PROVIDER_CONFIRMATION");

    const unchangedSale = await ctx.sales.findById(externalSale.id);
    expect(unchangedSale?.status).toBe("PAID");
    expect(unchangedSale?.refunds ?? []).toHaveLength(0);
    expect((await ctx.products.findById(BURGER.id))?.stock).toBe(stockBeforeRefund);
    expect(await ctx.cashMovements.findAll()).toEqual(movementsBeforeRefund);
  });

  it("L. reembolso parcial después de pago: stock parcialmente restaurado", async () => {
    ctx.cart.addItem(BURGER, 2);
    const stockBefore = (await ctx.products.findById(BURGER.id))?.stock ?? 0;
    const sale = await ctx.salesEngine.quickSale({ cashierId: "cashier-1" });

    const { sale: paidSale } = await ctx.salesEngine.registerPayment(sale, "CASH");

    const { sale: refunded, amount } = await ctx.salesEngine.partialRefundSale(
      paidSale.id, [{ productId: BURGER.id, quantity: 1 }], "Reembolso 1/2", "cashier-1"
    );
    expect(refunded.status).toBe("PAID"); // parcial: sale mantiene PAID hasta refund total
    expect(amount).toBeGreaterThan(0);

    // Stock parcialmente restaurado (1 de 2 unidades)
    expect((await ctx.products.findById(BURGER.id))?.stock).toBe(stockBefore - 1);
  });

  it("M. cancelación después de pago: stock restaurado, venta CANCELLED", async () => {
    ctx.cart.addItem(BURGER, 2);
    const stockBefore = (await ctx.products.findById(BURGER.id))?.stock ?? 0;
    const sale = await ctx.salesEngine.quickSale({ cashierId: "cashier-1" });

    await ctx.salesEngine.registerPayment(sale, "CASH");

    const cancelled = await ctx.salesEngine.cancelSale(
      sale.id, "Cancelado por auditoría", "cashier-1"
    );
    expect(cancelled.status).toBe("CANCELLED");

    // Stock restaurado
    expect((await ctx.products.findById(BURGER.id))?.stock).toBe(stockBefore);

    // Movementos: 1 IN (venta) + 1 OUT (cancelación)
    const movements = await ctx.cashMovements.findAll();
    const income = movements.find(m => m.type === "IN");
    const expense = movements.find(m => m.type === "OUT" && m.description?.includes("Cancelación"));
    expect(income).toBeDefined();
    expect(expense).toBeDefined();
  });
});
