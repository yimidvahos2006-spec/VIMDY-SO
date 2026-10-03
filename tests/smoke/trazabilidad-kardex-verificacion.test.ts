// tests/smoke/trazabilidad-kardex-verificacion.test.ts
/* ===========================================================================
   SMOKE TEST — Verificación de trazabilidad en el Kardex al reembolsar
   ---------------------------------------------------------------------------
   Corrige un falso positivo: SalesEngine.verifyInventoryTrail() preguntaba
   por el Kardex de `item.productId` (el producto TAL COMO se vendió), sin
   importar si ese producto tiene receta o no maneja stock propio. Eso
   generaba SIEMPRE un warning "Sin trazabilidad" para cualquier producto con
   receta (el movimiento real queda en los INGREDIENTES, no en el producto) y
   para productos sin stock propio (Servicio / cocina sin stock: por diseño
   nunca se registra ningún movimiento).

   Este test prueba que, tras la corrección (InventoryEngine.
   resolveExpectedTrailTargets — misma resolución que usa consumeForSale para
   descontar de verdad), la verificación pregunta por los productos REALES:

     1. Coca-Cola (stock directo)              -> vender/reembolsar: sin warning.
     2. Pizza (receta general)                  -> vender/reembolsar: sin warning.
     3. Pizza + tamaño (receta propia del size)  -> vender/reembolsar: sin warning.
     4. Pizza + extra (ingrediente del extra)    -> vender/reembolsar: sin warning.
     5. Domicilio (Servicio, sin stock propio)   -> vender/reembolsar: sin warning.
     6. Movimiento de un ingrediente borrado a propósito -> SÍ debe avisar.
=========================================================================== */

import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";

import { Product, Sale, KitchenOrder, CashMovement } from "../../src/core/entities/Entities";

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
import { InMemoryMovementRepository } from "../fakes/InMemoryMovementRepository";
import { FakeProductRepository } from "../fakes/FakeProductRepository";
import { FakeCashMovementRepository } from "../fakes/FakeCashMovementRepository";

function buildSalesEngine() {
  const products = new FakeProductRepository();
  const sales = new InMemoryRepository<Sale>("sales");
  const receipts = new InMemoryRepository("receipts");
  const kitchenOrders = new InMemoryRepository<KitchenOrder>("kitchen_orders");
  const cashMovements = new FakeCashMovementRepository(sales as any, products);
  const customers = new InMemoryRepository("customers");
  const movements = new InMemoryMovementRepository();
  const auditLogs = new InMemoryRepository("audit_logs");

  const kardex = new KardexEngine(movements);
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

  return { salesEngine, inventory, products, movements };
}

/* --------------------------------------------------------------------------
   Fixtures — mismos productos que el resto de la suite de Inventario
   Inteligente, más un "Domicilio" tipo Servicio (sin stock propio).
-------------------------------------------------------------------------- */
const MASA: Product = {
  id: "ing-masa", name: "Masa", categoryId: "cat-insumos",
  price: 0, stock: 5000, minStock: 0, lastUpdated: new Date(), unit: "g"
};
const SALSA: Product = {
  id: "ing-salsa", name: "Salsa", categoryId: "cat-insumos",
  price: 0, stock: 5000, minStock: 0, lastUpdated: new Date(), unit: "g"
};
const QUESO: Product = {
  id: "ing-queso", name: "Queso mozzarella", categoryId: "cat-insumos",
  price: 0, stock: 5000, minStock: 0, lastUpdated: new Date(), unit: "g"
};
const TOCINETA: Product = {
  id: "ing-tocineta", name: "Tocineta", categoryId: "cat-insumos",
  price: 0, stock: 5000, minStock: 0, lastUpdated: new Date(), unit: "g"
};

const COCA_COLA: Product = {
  id: "prod-coca-cola", name: "Coca-Cola", categoryId: "cat-bebidas",
  price: 4000, stock: 50, minStock: 5, lastUpdated: new Date(), unit: "unidad"
};

const PIZZA: Product = {
  id: "prod-pizza",
  name: "Pizza",
  categoryId: "cat-comidas",
  price: 25000,
  stock: 999, // producto con receta: no maneja su propio stock, solo sus ingredientes
  minStock: 0,
  lastUpdated: new Date(),
  recipe: [
    { productId: MASA.id, quantity: 180 },
    { productId: SALSA.id, quantity: 60 },
    { productId: QUESO.id, quantity: 120 }
  ],
  sizes: [
    {
      id: "size-grande",
      name: "Pizza Grande",
      priceDelta: 12000,
      recipe: [
        { productId: MASA.id, quantity: 350 },
        { productId: SALSA.id, quantity: 80 },
        { productId: QUESO.id, quantity: 250 }
      ]
    }
  ],
  extras: [
    {
      id: "extra-tocineta",
      name: "Tocineta",
      priceDelta: 4000,
      recipe: [{ productId: TOCINETA.id, quantity: 40 }]
    }
  ]
};

// Servicio: sin receta y sin stock propio (trackStock: false), igual que
// "Domicilio" en el documento de Inventario. No se espera NINGÚN movimiento
// de Kardex ni al vender ni al reembolsar.
const DOMICILIO: Product = {
  id: "prod-domicilio",
  name: "Domicilio",
  categoryId: "cat-servicios",
  price: 5000,
  stock: 0,
  minStock: 0,
  lastUpdated: new Date(),
  trackStock: false
};

describe("Smoke: verificación de trazabilidad en el Kardex al reembolsar", () => {
  let ctx: ReturnType<typeof buildSalesEngine>;
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    ctx = buildSalesEngine();
    for (const p of [MASA, SALSA, QUESO, TOCINETA, COCA_COLA, PIZZA, DOMICILIO]) {
      await ctx.products.save(p);
    }
    // logWarning() de opsLogger llama a console.warn — espiamos ahí para
    // detectar "Sin trazabilidad en Kardex" sin acoplarnos a Supabase.
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  function trailWarnings(): string[] {
    return warnSpy.mock.calls
      .map(call => String(call[1] ?? ""))
      .filter(message => message.includes("Sin trazabilidad en Kardex"));
  }

  it("1. Coca-Cola (stock directo): vender y reembolsar no genera warning", async () => {
    const sale = await ctx.salesEngine.quickSale({
      cashierId: "cashier-1",
      source: [{ productId: COCA_COLA.id, quantity: 2 }]
    });
    const { sale: paidSale } = await ctx.salesEngine.registerPayment(sale, "CASH");

    await ctx.salesEngine.refundSale(paidSale.id, "Cliente se arrepintió", "cashier-1");

    expect(trailWarnings()).toEqual([]);
    const coca = await ctx.products.findById(COCA_COLA.id);
    expect(coca?.stock).toBe(50); // se descontó al vender y se repuso al reembolsar
  });

  it("2. Pizza (receta general): vender y reembolsar no genera warning", async () => {
    const sale = await ctx.salesEngine.quickSale({
      cashierId: "cashier-1",
      source: [{ productId: PIZZA.id, quantity: 1 }] // sin tamaño ni extras -> receta general
    });
    const { sale: paidSale } = await ctx.salesEngine.registerPayment(sale, "CASH");

    await ctx.salesEngine.refundSale(paidSale.id, "Pizza llegó fría", "cashier-1");

    expect(trailWarnings()).toEqual([]);
    const masa = await ctx.products.findById(MASA.id);
    expect(masa?.stock).toBe(5000); // repuesto tras el reembolso
  });

  it("3. Pizza + tamaño (receta propia del size): vender y reembolsar no genera warning", async () => {
    const sale = await ctx.salesEngine.quickSale({
      cashierId: "cashier-1",
      source: [
        {
          productId: PIZZA.id,
          quantity: 1,
          price: 25000 + 12000,
          name: "Pizza (Grande)",
          selectedSize: {
            id: "size-grande",
            name: "Pizza Grande",
            priceDelta: 12000,
            recipe: [
              { productId: MASA.id, quantity: 350 },
              { productId: SALSA.id, quantity: 80 },
              { productId: QUESO.id, quantity: 250 }
            ]
          }
        }
      ]
    });
    const { sale: paidSale } = await ctx.salesEngine.registerPayment(sale, "CASH");

    await ctx.salesEngine.refundSale(paidSale.id, "No le gustó el tamaño", "cashier-1");

    expect(trailWarnings()).toEqual([]);
    const masa = await ctx.products.findById(MASA.id);
    expect(masa?.stock).toBe(5000);
  });

  it("4. Pizza + extra (ingrediente del extra): vender y reembolsar no genera warning", async () => {
    const sale = await ctx.salesEngine.quickSale({
      cashierId: "cashier-1",
      source: [
        {
          productId: PIZZA.id,
          quantity: 1,
          price: 25000 + 4000,
          name: "Pizza + Tocineta",
          selectedExtras: [
            { id: "extra-tocineta", name: "Tocineta", priceDelta: 4000, recipe: [{ productId: TOCINETA.id, quantity: 40 }] }
          ]
        }
      ]
    });
    const { sale: paidSale } = await ctx.salesEngine.registerPayment(sale, "CASH");

    // Reembolso parcial también pasa por verifyInventoryTrail.
    await ctx.salesEngine.partialRefundSale(
      paidSale.id,
      [{ productId: PIZZA.id, quantity: 1 }],
      "Sin tocineta esta vez",
      "cashier-1"
    );

    expect(trailWarnings()).toEqual([]);
    const tocineta = await ctx.products.findById(TOCINETA.id);
    expect(tocineta?.stock).toBe(5000);
  });

  it("5. Domicilio (Servicio, sin stock propio): vender y reembolsar no genera warning", async () => {
    const sale = await ctx.salesEngine.quickSale({
      cashierId: "cashier-1",
      source: [{ productId: DOMICILIO.id, quantity: 1 }]
    });
    const { sale: paidSale } = await ctx.salesEngine.registerPayment(sale, "CASH");

    await ctx.salesEngine.refundSale(paidSale.id, "Pedido cancelado", "cashier-1");

    // Por diseño, nunca hubo movimiento de Kardex que verificar.
    expect(trailWarnings()).toEqual([]);
  });

  it("6. Movimiento de ingrediente borrado a propósito: SÍ debe generar warning", async () => {
    const sale = await ctx.salesEngine.quickSale({
      cashierId: "cashier-1",
      source: [{ productId: PIZZA.id, quantity: 1 }]
    });
    const { sale: paidSale } = await ctx.salesEngine.registerPayment(sale, "CASH");

    // Sabotaje deliberado: borramos el movimiento de Kardex de un
    // ingrediente real (Masa) que sí se descontó al vender, simulando una
    // pérdida de trazabilidad real (ej. fila borrada a mano, bug de
    // escritura). El stock de Masa sigue descontado, pero su rastro
    // desapareció -- este es el caso que el warning SÍ debe atrapar.
    const masaMovements = await ctx.movements.findByProduct(MASA.id);
    expect(masaMovements.length).toBeGreaterThan(0);
    for (const m of masaMovements) {
      await ctx.movements.delete(m.id);
    }

    await ctx.salesEngine.refundSale(paidSale.id, "Pizza llegó fría", "cashier-1");

    const warnings = trailWarnings();
    expect(warnings.length).toBeGreaterThan(0);
    expect(warnings.some(w => w.includes(MASA.id))).toBe(true);
  });
});