import { describe, it, expect, beforeEach } from "vitest";
import { InMemoryRepository } from "../fakes/InMemoryRepository";
import { FakeProductRepository } from "../fakes/FakeProductRepository";
import { SalesEngine, CreateSaleInput } from "../../src/core/engines/SalesEngine";
import { PaymentEngine } from "../../src/core/engines/PaymentEngine";
import { CashEngine } from "../../src/core/engines/CashEngine";
import { InventoryEngine } from "../../src/core/engines/InventoryEngine";
import { KardexEngine } from "../../src/core/engines/KardexEngine";
import { CartEngine } from "../../src/core/engines/CartEngine";
import { CustomerEngine } from "../../src/core/engines/CustomerEngine";
import { AlertEngine } from "../../src/core/engines/AlertEngine";
import { HealthEngine } from "../../src/core/engines/HealthEngine";
import { AuditEngine } from "../../src/core/engines/AuditEngine";
import { KitchenEngine } from "../../src/core/engines/KitchenEngine";
import { ReceiptEngine } from "../../src/core/engines/ReceiptEngine";
import { CategoryEngine } from "../../src/core/engines/CategoryEngine";
import { ShiftEngine } from "../../src/core/engines/ShiftEngine";
import { PosCore } from "../../src/core/engines/PosCore";
import type { Sale, CashMovement, Shift } from "../../src/core/entities/Entities";
import { setCurrentBusinessId, setCurrentBranchId } from "../../src/infrastructure/supabase/supabaseClient";
import type { PendingSale } from "../../src/core/offline/PendingSale";

const PRODUCT_ID = "prod-integridad-1";

function buildSalesEngine() {
  const products = new FakeProductRepository();
  const sales = new InMemoryRepository<Sale>("sales");
  const receipts = new InMemoryRepository<any>("receipts");
  const kitchenOrders = new InMemoryRepository<any>("kitchen_orders");
  const cashMovements = new InMemoryRepository<CashMovement>("cash_movements");
  const customers = new InMemoryRepository<any>("customers");
  const movements = new InMemoryRepository<any>("inventory_movements");
  const auditLogs = new InMemoryRepository<any>("audit_logs");
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
    audit,
    { defaultTaxRate: 19, defaultCustomerId: "customer-general", loyaltyPointsPerCurrencyUnit: 0.001 }
  );

  return { salesEngine, cash, cashMovements, products };
}

describe("Integridad financiera", () => {
  beforeEach(() => {
    setCurrentBusinessId("business-test");
    setCurrentBranchId("branch-test");
  });

  it("cancelSale revierte inventario y movimiento de caja cuando la venta estaba pagada", async () => {
    const ctx = buildSalesEngine();

    await ctx.products.save({
      id: PRODUCT_ID,
      name: "Producto Integridad",
      price: 100,
      categoryId: "cat-1",
      businessId: "business-test",
      branchId: "branch-test",
      stock: 10,
      minStock: 0,
      lastUpdated: new Date()
    });

    const sale = await ctx.salesEngine.createSale({
      items: [{ productId: PRODUCT_ID, quantity: 1, price: 100 }],
      type: "QUICK"
    });

    const { sale: paidSale } = await ctx.salesEngine.registerPayment(sale, "CASH", { received: 200 });
    expect(paidSale.status).toBe("PAID");

    const movementsBefore = await ctx.cash.getAllMovements();
    const incomeMovements = movementsBefore.filter((m: CashMovement) => m.type === "IN" && m.description?.includes(`Venta ${sale.code}`));
    expect(incomeMovements.length).toBe(1);
    expect(incomeMovements[0].amount).toBe(119);

    await ctx.salesEngine.cancelSale(paidSale.id, "Prueba integridad");

    const movementsAfter = await ctx.cash.getAllMovements();
    const expenseMovements = movementsAfter.filter((m: CashMovement) => m.type === "OUT" && m.description?.includes("Cancelación"));
    expect(expenseMovements.length).toBe(1);
    expect(expenseMovements[0].amount).toBe(119);
  });
});
