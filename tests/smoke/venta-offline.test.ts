// tests/smoke/venta-offline.test.ts
/* ===========================================================================
   SMOKE TEST — Venta offline (cola local + sincronización)
   ---------------------------------------------------------------------------
   CRÍTICO #7 del checklist de lanzamiento, mismo patrón que los otros 4
   smoke tests: engines reales (SalesEngine, InventoryEngine, CashEngine...)
   con dobles de prueba en memoria (tests/fakes/), sin tocar Supabase.

   Este archivo cubre el flujo de ventas sin conexión (Partes 2, 3 y 4 del
   plan de ventas offline):

     1. Si el cobro falla porque no hay red (isNetworkFailure() da true), la
        venta NO se pierde: se guarda en la cola local en estado
        PENDING_SYNC, y NO se toca inventario ni caja todavía (offline no
        existe una Sale real, ver PendingSale.ts).
     2. Al reconectar, la venta encolada se manda de verdad contra
        SalesEngine.createSale() (los MISMOS engines que usa el cobro
        online, igual que hace syncPendingSales.ts) y la cola queda vacía.
     3. Si la misma venta se sincroniza dos veces (ej. el navegador se
        cerró a mitad de la sincronización y se reintenta), la idempotencia
        por id (checklist crítico #4) evita que se duplique el inventario
        descontado o el ingreso en caja.

   NOTA TÉCNICA: no se importa el singleton real `pendingSalesStore` (usa
   IndexedDB vía PendingSaleRepository) ni `syncPendingSales.ts` (depende
   del contenedor de producción `container`), porque ambos son cosas de
   navegador/sesión real, no de este test en Node (ver vitest.config.ts:
   `environment: "node"`). En su lugar, este test arma su propia cola en
   memoria (misma forma que PendingSale) y reproduce exactamente la misma
   receta que usa syncOne() en syncPendingSales.ts: createSale() y, si
   aplica, registerPayment(), contra un SalesEngine armado con los mismos
   fakes que ya usa venta-completa.test.ts.

   La única pieza real de producción que si se importa es
   `isNetworkFailure()` (de offlineSale.ts, Parte 3) — es lógica pura de
   clasificación de errores y es justo lo que hay que probar en el punto
   1. Ese módulo importa `container` desde CompositionRoot.ts a nivel de
   import, y CompositionRoot arrastra el cliente real de Supabase (que
   exige variables VITE_* y explota fuera de un navegador real), así que
   se mockea ANTES del import — mismo patrón que login.test.ts mockea
   supabaseClient.ts.
=========================================================================== */

import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("../../src/infrastructure/di/CompositionRoot", () => ({
  container: {},
  productsReady: Promise.resolve()
}));

import { isNetworkFailure } from "../../src/core/services/offlineSale";

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
import { SalesEngine, CreateSaleInput } from "../../src/core/engines/SalesEngine";
import { PosCore } from "../../src/core/engines/PosCore";

import { InMemoryRepository } from "../fakes/InMemoryRepository";
import { FakeProductRepository } from "../fakes/FakeProductRepository";
import type { PendingSale } from "../../src/core/offline/PendingSale";

/** Mismo helper que venta-completa.test.ts: un SalesEngine real con dobles en memoria. */
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
    // Igual que en venta-completa.test.ts: este flujo no pasa por PosCore.
    {} as PosCore,
    audit
  );

  return { salesEngine, products, sales, cashMovements, businessId: "biz-1", branchId: "branch-1" };
}

/**
 * Encola una venta offline. Misma forma que pendingSalesStore.enqueue()
 * (Parte 2): guarda la "receta" (createSaleInput), no una Sale ya armada,
 * porque offline no hay nada real todavía (ver PendingSale.ts).
 */
function enqueue(queue: PendingSale[], input: CreateSaleInput, businessId = "biz-1", branchId = "branch-1"): PendingSale {
  const pendingSale: PendingSale = {
    id: input.id!,
    createSaleInput: input,
    payment: { method: "CASH" },
    status: "PENDING_SYNC",
    queuedAt: new Date(),
    attempts: 0,
    businessId,
    branchId
  };

  queue.push(pendingSale);
  return pendingSale;
}

/**
 * Reproduce EXACTAMENTE la receta de syncOne() en syncPendingSales.ts
 * (Parte 4): createSale() y, si la venta ya se había cobrado offline,
 * registerPayment() — contra los mismos engines reales que usa el cobro
 * online, nunca un camino paralelo.
 */
async function syncOne(salesEngine: SalesEngine, pending: PendingSale): Promise<Sale> {
  const sale = await salesEngine.createSale(pending.createSaleInput);

  if (pending.payment) {
    await salesEngine.registerPayment(sale, pending.payment.method, {
      received: pending.payment.received,
      reference: pending.payment.reference,
      mixed: pending.payment.mixed
    });
  }

  return sale;
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

describe("Smoke: venta offline (cola local + sincronización)", () => {
  let ctx: ReturnType<typeof buildSalesEngine>;
  let queue: PendingSale[];

  const OFFLINE_SALE_INPUT: CreateSaleInput = {
    id: "sale-offline-1",
    type: "QUICK",
    items: [{ productId: BURGER.id, quantity: 2, price: BURGER.price }],
    cashierId: "cashier-1"
  };

  beforeEach(async () => {
    ctx = buildSalesEngine();
    await ctx.products.save(BURGER);
    queue = [];
  });

  it("si el cobro falla por red, la venta queda en la cola local en PENDING_SYNC y no se pierde", async () => {
    // Simula el error real que dispararía el modo offline: un fetch
    // rechazado (Supabase caído / sin internet), no un error de negocio.
    const networkError = new TypeError("Failed to fetch");
    expect(isNetworkFailure(networkError)).toBe(true);

    const pending = enqueue(queue, OFFLINE_SALE_INPUT, ctx.businessId, ctx.branchId);

    expect(queue).toHaveLength(1);
    expect(pending.status).toBe("PENDING_SYNC");
    expect(pending.id).toBe(OFFLINE_SALE_INPUT.id);

    // Offline no existe una Sale real todavía: nada se tocó en el servidor.
    expect(await ctx.sales.findAll()).toHaveLength(0);
    const productBeforeSync = await ctx.products.findById(BURGER.id);
    expect(productBeforeSync?.stock).toBe(10);

    // Un error de negocio (ej. sin stock) NO debe clasificarse como falla
    // de red — si no, la Parte 4 reintentaría para siempre algo que nunca
    // va a funcionar.
    expect(isNetworkFailure(new Error("INSUFFICIENT_STOCK: sin stock"))).toBe(false);
  });

  it("al reconectar, sincroniza la venta contra los engines reales y la cola queda vacía", async () => {
    const pending = enqueue(queue, OFFLINE_SALE_INPUT, ctx.businessId, ctx.branchId);

    const sale = await syncOne(ctx.salesEngine, pending);
    queue = queue.filter((item) => item.id !== pending.id);

    expect(queue).toHaveLength(0);

    // OJO: syncOne() devuelve la Sale tal como la dejó createSale() (antes
    // de registerPayment), igual que el syncOne real en syncPendingSales.ts
    // — el estado PAID hay que confirmarlo releyendo el repositorio.
    expect(sale.status).toBe("PENDING_PAYMENT");
    const persisted = await ctx.sales.findById(OFFLINE_SALE_INPUT.id!);
    expect(persisted?.status).toBe("PAID");

    const productAfterSync = await ctx.products.findById(BURGER.id);
    expect(productAfterSync?.stock).toBe(8); // 10 - 2

    const movements = await ctx.cashMovements.findAll();
    expect(movements).toHaveLength(1);
    expect(movements[0].amount).toBe(sale.total);
  });

  it("si la misma venta se sincroniza dos veces (reintento), no duplica inventario ni caja", async () => {
    const pending = enqueue(queue, OFFLINE_SALE_INPUT, ctx.businessId, ctx.branchId);

    // Primer intento: se sincroniza normal.
    await syncOne(ctx.salesEngine, pending);

    // Segundo intento con la MISMA venta (mismo id) — ej. el navegador se
    // cerró justo después de sincronizar pero antes de que la cola se
    // alcanzara a vaciar, y al reabrir se reintenta la misma PendingSale.
    await syncOne(ctx.salesEngine, pending);

    // Checklist crítico #4: createSale() reconoce el id y devuelve la
    // venta ya existente sin volver a descontar inventario; registerPayment()
    // relee el estado real (ya PAID) y no vuelve a ingresar el dinero.
    expect(await ctx.sales.findAll()).toHaveLength(1);

    const productAfterRetry = await ctx.products.findById(BURGER.id);
    expect(productAfterRetry?.stock).toBe(8); // sigue en 8, no 6

    const movementsAfterRetry = await ctx.cashMovements.findAll();
    expect(movementsAfterRetry).toHaveLength(1);
  });
});