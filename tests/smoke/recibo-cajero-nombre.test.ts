import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { operationConfigStore } from "../../src/core/store/operationConfigStore";
import { kitchenOutputModeStore } from "../../src/core/store/kitchenOutputModeStore";
import { DEFAULT_OPERATION_CONFIG } from "../../src/core/config/operation";

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

  return { salesEngine, products, receipts, cart };
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

describe("Recibo: nombre del cajero", () => {
  let ctx: ReturnType<typeof buildSalesEngine>;

  beforeEach(async () => {
    operationConfigStore.set({
      ...DEFAULT_OPERATION_CONFIG,
      kitchenEnabled: true,
      kitchenOutputMode: "kds",
      kdsEnabled: true,
      salesChannels: ["presencial"]
    });
    kitchenOutputModeStore.set("pantalla");
    ctx = buildSalesEngine();
    await ctx.products.save(BURGER);
  });

  it("el recibo creado al cobrar usa el nombre de quien cobra, no su ID ni 'Administrador'", async () => {
    ctx.cart.addItem(BURGER, 1);
    const sale = await ctx.salesEngine.quickSale({ cashierId: "uuid-del-dueno" });

    const { sale: paid } = await ctx.salesEngine.registerPayment(sale, "CASH", {
      cashierName: "Yimid Vahos"
    });

    const receipt = await ctx.salesEngine.getReceiptBySaleId(paid.id);
    expect(receipt?.cashier).toBe("Yimid Vahos");
  });

  it("sin nombre disponible no imprime el ID interno ni inventa 'Administrador'", async () => {
    ctx.cart.addItem(BURGER, 1);
    const sale = await ctx.salesEngine.quickSale({ cashierId: "uuid-del-dueno" });

    const { sale: paid } = await ctx.salesEngine.registerPayment(sale, "CASH");

    const receipt = await ctx.salesEngine.getReceiptBySaleId(paid.id);
    expect(receipt?.cashier).toBe("—");
  });
});