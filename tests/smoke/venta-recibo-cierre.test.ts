import { describe, it, expect, beforeEach } from "vitest";

import { Product, Sale, CashMovement, Shift, KitchenOrder } from "../../src/core/entities/Entities";
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
import { ShiftEngine } from "../../src/core/engines/ShiftEngine";

import { InMemoryRepository } from "../fakes/InMemoryRepository";
import { FakeProductRepository } from "../fakes/FakeProductRepository";

function buildSalesAndShiftEngines() {
  const products = new FakeProductRepository();
  const sales = new InMemoryRepository<Sale>("sales");
  const receipts = new InMemoryRepository("receipts");
  const kitchenOrders = new InMemoryRepository<KitchenOrder>("kitchen_orders");
  const cashMovements = new InMemoryRepository<CashMovement>("cash_movements");
  const customers = new InMemoryRepository("customers");
  const movements = new InMemoryRepository("inventory_movements");
  const auditLogs = new InMemoryRepository("audit_logs");
  const shifts = new InMemoryRepository<Shift>("shifts");

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

  const shiftEngine = new ShiftEngine(shifts, cash);

  return { salesEngine, shiftEngine, products, cashMovements, receipts, cart };
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

describe("Smoke: venta con recibo y cierre de turno", () => {
  let ctx: ReturnType<typeof buildSalesAndShiftEngines>;

  beforeEach(async () => {
    ctx = buildSalesAndShiftEngines();
    await ctx.products.save(BURGER);
  });

  it("cierra el ciclo completo: abre turno, vende, cobra, genera recibo y cierra turno", async () => {
    const shift = await ctx.shiftEngine.openShift("cashier-1", 50000, "Apertura inicial");
    const cart = ctx.cart;
    cart.addItem(BURGER, 2);

    // quickSale usa el carrito interno del CartEngine, no el source.
    const sale = await ctx.salesEngine.quickSale({ cashierId: shift.cashierId });

    expect(sale.status).toBe("PENDING_PAYMENT");

    const productAfterSale = await ctx.products.findById(BURGER.id);
    expect(productAfterSale?.stock).toBe(8);

    const { sale: paidSale } = await ctx.salesEngine.registerPayment(sale, "CASH");
    expect(paidSale.status).toBe("PAID");

    // registerPayment ya genera el recibo automáticamente (ensureReceiptForPaidSale),
    // así que no hay que llamar generateReceipt manualmente — eso crearía un
    // segundo recibo con el mismo code pero distinto id.
    const receipt = await ctx.salesEngine.getReceiptBySaleId(paidSale.id);
    expect(receipt).toBeDefined();
    expect(receipt!.total).toBe(paidSale.total);
    expect(receipt!.code).toBe(paidSale.id);

    const summary = await ctx.shiftEngine.getShiftSummary(shift.id);
    expect(summary.totalIncome).toBe(paidSale.total);
    expect(summary.totalCashIncome).toBe(paidSale.total);

    const expectedAmount = shift.openingAmount + paidSale.total;
    const closedShift = await ctx.shiftEngine.closeShift(
      shift.id,
      expectedAmount + 1000,
      "Cierre con sobrante"
    );

    expect(closedShift.status).toBe("CLOSED");
    expect(closedShift.difference).toBe(1000);
    expect(closedShift.countedAmount).toBe(expectedAmount + 1000);
  });
});
