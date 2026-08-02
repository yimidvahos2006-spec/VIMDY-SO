// tests/smoke/doble-cobro-simultaneo.test.ts
/* ===========================================================================
   SMOKE TEST — Doble cobro SIMULTÁNEO de la misma venta
   ---------------------------------------------------------------------------
   venta-completa.test.ts ya prueba la idempotencia SECUENCIAL (cobrar,
   esperar a que termine, cobrar otra vez con la misma venta ya PAID).
   Este test cubre el caso más peligroso y menos obvio: dos llamadas a
   registerPayment() para la MISMA venta que arrancan CASI a la vez —dos
   pestañas del cajero, o un doble click justo antes de que el primer
   intento termine de escribir— y que por lo tanto AMBAS alcanzan a ver la
   venta todavía en PENDING_PAYMENT antes de que cualquiera de las dos
   termine de cobrar.

   Sin el fix de SalesEngine.registerPayment (captura de
   OptimisticLockError sobre el updateSale de status), la segunda llamada
   reventaría con un error de "choque de edición" en la cara del cajero
   por algo que en realidad ya cobró bien la otra pestaña. Con el fix,
   la perdedora de la carrera relee la venta, ve que ya quedó PAID/CLOSED
   y devuelve esa misma venta sin reintentar el cobro ni duplicar nada.

   Qué verifica:
     1. Ambas llamadas concurrentes resuelven exitosamente (ninguna lanza).
     2. La venta queda PAID una sola vez.
     3. Solo cae UN movimiento de caja (no se duplica el dinero).
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

  return { salesEngine, products, cart, cashMovements };
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

describe("Smoke: doble cobro simultáneo de la misma venta", () => {
  let ctx: ReturnType<typeof buildSalesEngine>;

  beforeEach(async () => {
    ctx = buildSalesEngine();
    await ctx.products.save(BURGER);
  });

  it("dos cobros concurrentes de la misma venta no duplican el dinero en caja ni truenan", async () => {
    ctx.cart.addItem(BURGER, 2);

    const sale = await ctx.salesEngine.quickSale({ cashierId: "cashier-1" });

    // Dos "pestañas" cobrando la MISMA venta casi a la vez: ninguna espera
    // a que la otra termine antes de arrancar (Promise.all, no secuencial).
    const [first, second] = await Promise.all([
      ctx.salesEngine.registerPayment(sale, "CASH"),
      ctx.salesEngine.registerPayment(sale, "CASH")
    ]);

    // Ninguna de las dos llamadas debe reventar con OptimisticLockError:
    // la perdedora de la carrera se resuelve sola releyendo la venta.
    expect(first.sale.status).toBe("PAID");
    expect(second.sale.status).toBe("PAID");

    // El dinero solo entra UNA vez a caja, sin importar cuál pestaña
    // "ganó" la escritura real.
    const movements = await ctx.cashMovements.findAll();
    expect(movements).toHaveLength(1);
    expect(movements[0].amount).toBe(sale.total);
  });
});