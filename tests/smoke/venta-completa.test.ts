// tests/smoke/venta-completa.test.ts
/* ===========================================================================
   SMOKE TEST — Venta completa
   ---------------------------------------------------------------------------
   CRÍTICO #7 del checklist de lanzamiento: "Pruebas automáticas mínimas de
   los 4 flujos que si se rompen, se rompe el negocio del cliente". Este es
   el flujo #1: una venta de mostrador de principio a fin.

   Qué cubre (con dobles de prueba en memoria, sin tocar Supabase):
     1. Se agrega un producto al carrito y se cobra con quickSale().
     2. El inventario se descuenta la cantidad correcta (consumeForSale ->
        adjustStock).
     3. Se genera una comanda de cocina en estado PENDIENTE con los items
        correctos.
     4. registerPayment() deja la venta en PAID y registra el movimiento de
        caja por el monto exacto.
     5. Si el cobro se reintenta con la MISMA venta (ej. el datáfono se cae
        y el cajero le da "Cobrar" dos veces), NO se duplica el ingreso en
        caja — el checklist crítico #4 (idempotencia) sigue funcionando.

   Si cualquiera de estas 5 cosas se rompe, se rompe la caja registradora
   del cliente un viernes en la noche — por eso es "smoke test" y no
   "nice to have".
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
    // PosCore nunca se invoca en este flujo: quickSale() usa el carrito
    // (`cart`) como fuente por defecto, no PosCore. Un stub basta.
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

describe("Smoke: venta completa (mostrador)", () => {
  let ctx: ReturnType<typeof buildSalesEngine>;

  beforeEach(async () => {
    ctx = buildSalesEngine();
    await ctx.products.save(BURGER);
  });

  it("cobra una venta de principio a fin: inventario, cocina y caja quedan consistentes", async () => {
    ctx.cart.addItem(BURGER, 2);

    const sale = await ctx.salesEngine.quickSale({ cashierId: "cashier-1" });

    expect(sale.status).toBe("PENDING_PAYMENT");
    expect(sale.items).toHaveLength(1);
    expect(sale.items[0].quantity).toBe(2);
    expect(sale.total).toBeGreaterThan(0);

    // 1) Inventario descontado.
    const productAfterSale = await ctx.products.findById(BURGER.id);
    expect(productAfterSale?.stock).toBe(8); // 10 - 2

    // 2) Comanda de cocina creada en PENDIENTE.
    const kitchenOrders = await ctx.kitchenOrders.findAll();
    expect(kitchenOrders).toHaveLength(1);
    expect(kitchenOrders[0].status).toBe("PENDIENTE");

    // 3) Cobro: la venta queda PAID y cae exactamente 1 movimiento de caja.
    const { sale: paidSale } = await ctx.salesEngine.registerPayment(sale, "CASH");

    expect(paidSale.status).toBe("PAID");

    const movementsAfterPay = await ctx.cashMovements.findAll();
    expect(movementsAfterPay).toHaveLength(1);
    expect(movementsAfterPay[0].amount).toBe(sale.total);

    // 4) IDEMPOTENCIA (checklist crítico #4): si el cajero reintenta el
    // cobro de la MISMA venta (ej. el datáfono se cayó y no está seguro de
    // si ya cobró), no debe duplicarse el dinero en caja.
    await ctx.salesEngine.registerPayment(paidSale, "CASH");

    const movementsAfterRetry = await ctx.cashMovements.findAll();
    expect(movementsAfterRetry).toHaveLength(1);
  });

  it("rechaza la venta si no hay stock suficiente (no deja el carrito a medias)", async () => {
    ctx.cart.addItem(BURGER, 999);

    // validateSale() (llamado desde createSale ANTES de tocar inventario)
    // rechaza con este mensaje en español — el código INSUFFICIENT_STOCK
    // solo aparece si el descuento atómico falla DESPUÉS de pasar esta
    // validación previa (condición de carrera), que no es este caso.
    await expect(ctx.salesEngine.quickSale({ cashierId: "cashier-1" })).rejects.toThrow(
      /VALIDATION_ERROR.*[Ss]tock insuficiente/
    );

    // El stock no debe haber cambiado: la venta se rechazó ANTES de tocar
    // inventario (ver validateSale -> validateInventory en SalesEngine).
    const productAfterFailedSale = await ctx.products.findById(BURGER.id);
    expect(productAfterFailedSale?.stock).toBe(10);
  });
});