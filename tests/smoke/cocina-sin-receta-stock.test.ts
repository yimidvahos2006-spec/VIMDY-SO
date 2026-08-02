// tests/smoke/cocina-sin-receta-stock.test.ts
/* ===========================================================================
   SMOKE TEST — trackStock=false no debe bloquear la venta (bug del video
   2026-07-31)
   ---------------------------------------------------------------------------
   Antes: InventoryEngine.buildConsumptionTargets() ignoraba por completo
   Product.trackStock. Cualquier producto SIN receta (ej. un plato de
   "Cocina" simple como "Caldo de Costilla", preparado al momento y sin
   stock físico que contar) se trataba igual que un producto de Inventario:
   exigía stock suficiente antes de cobrar. Como estos productos nacen con
   stock 0 (el formulario ni siquiera muestra el campo de stock para tipo
   Cocina/Servicio), la venta quedaba bloqueada PARA SIEMPRE con
   "INSUFFICIENT_STOCK", sin ninguna forma de arreglarlo desde la UI.

   Esta prueba confirma que:
   1. Un producto con trackStock=false y stock=0 SÍ se puede vender
      (consumeForSale no lo rechaza y no descuenta su stock).
   2. Un producto con trackStock=true (o sin definir, el default de
      siempre) sigue exigiendo y descontando stock exactamente igual que
      antes — este fix no debe romper productos de Inventario reales.
   3. restoreForSale (cancelaciones/reembolsos) tampoco repone stock de un
      producto trackStock=false, por simetría con lo que nunca se descontó.
=========================================================================== */

import { describe, it, expect, beforeEach } from "vitest";

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

// Plato tipo "Cocina" sin receta, preparado al momento: nace con stock 0
// porque el negocio no lleva un conteo de porciones — exactamente el caso
// del video (Caldo de Costilla).
const CALDO_DE_COSTILLA: Product = {
  id: "prod-caldo-costilla",
  name: "Caldo de Costilla",
  categoryId: "cat-comidas",
  price: 15000,
  stock: 0,
  minStock: 0,
  lastUpdated: new Date(),
  requiresKitchen: true,
  trackStock: false
};

// Producto de Inventario normal: debe seguir exigiendo/descontando stock
// exactamente como siempre.
const GASEOSA: Product = {
  id: "prod-gaseosa",
  name: "Gaseosa embotellada 400ml",
  categoryId: "cat-bebidas",
  price: 4000,
  stock: 5,
  minStock: 2,
  lastUpdated: new Date(),
  requiresKitchen: false,
  trackStock: true
};

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

  return { salesEngine, inventory, products, cart };
}

describe("Smoke: trackStock=false no bloquea la venta de un plato sin receta", () => {
  let ctx: ReturnType<typeof buildContext>;

  beforeEach(async () => {
    ctx = buildContext();
    await ctx.products.save(CALDO_DE_COSTILLA);
    await ctx.products.save(GASEOSA);
  });

  it("un plato de Cocina sin receta y stock=0 SÍ se puede cobrar", async () => {
    ctx.cart.addItem(CALDO_DE_COSTILLA, 2);

    await expect(ctx.salesEngine.quickSale({ cashierId: "cashier-1" })).resolves.toBeDefined();

    const stillZero = await ctx.products.findById(CALDO_DE_COSTILLA.id);
    expect(stillZero?.stock).toBe(0); // nunca se descuenta: no se maneja stock propio.
  });

  it("un producto de Inventario normal sigue exigiendo y descontando stock igual que siempre", async () => {
    ctx.cart.addItem(GASEOSA, 2);

    await ctx.salesEngine.quickSale({ cashierId: "cashier-1" });

    const updated = await ctx.products.findById(GASEOSA.id);
    expect(updated?.stock).toBe(3); // 5 - 2

    // Y si no hay suficiente stock, se sigue rechazando la venta.
    ctx.cart.addItem(GASEOSA, 10);
    await expect(ctx.salesEngine.quickSale({ cashierId: "cashier-1" })).rejects.toThrow(
      /Stock insuficiente/
    );
  });

  it("restoreForSale no infla el stock de un producto trackStock=false", async () => {
    await ctx.inventory.restoreForSale(
      [{ productId: CALDO_DE_COSTILLA.id, quantity: 3 }],
      "Cancelación de prueba"
    );

    const product = await ctx.products.findById(CALDO_DE_COSTILLA.id);
    expect(product?.stock).toBe(0);
  });
});