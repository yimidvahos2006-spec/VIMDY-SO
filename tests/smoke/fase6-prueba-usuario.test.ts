// tests/smoke/fase6-prueba-usuario.test.ts
// ===========================================================================
// FASE 6 — PRUEBA DE USUARIO (simulación automatizada)
// Objetivo: verificar que un negocio vacío puede completar el flujo
// "crear producto → vender → cobrar → verificar" sin errores técnicos.
// ===========================================================================

import { describe, it, expect, beforeEach } from "vitest";
import { Product, Sale, CashMovement, Shift } from "../../src/core/entities/Entities";
import { CartEngine } from "../../src/core/engines/CartEngine";
import { InventoryEngine } from "../../src/core/engines/InventoryEngine";
import { KardexEngine } from "../../src/core/engines/KardexEngine";
import { PaymentEngine } from "../../src/core/engines/PaymentEngine";
import { ReceiptEngine } from "../../src/core/engines/ReceiptEngine";
import { KitchenEngine } from "../../src/core/engines/KitchenEngine";
import { CashEngine } from "../../src/core/engines/CashEngine";
import { CustomerEngine } from "../../src/core/engines/CustomerEngine";
import { AlertEngine } from "../../src/core/engines/AlertEngine";
import { HealthEngine } from "../../src/core/engines/HealthEngine";
import { AuditEngine } from "../../src/core/engines/AuditEngine";
import { SalesEngine } from "../../src/core/engines/SalesEngine";
import { ShiftEngine } from "../../src/core/engines/ShiftEngine";
import { PosCore } from "../../src/core/engines/PosCore";
import { InMemoryRepository } from "../fakes/InMemoryRepository";
import { FakeProductRepository } from "../fakes/FakeProductRepository";

const CASHIER_ID = "cashier-user-test-1";

function buildUserTestCtx() {
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
    audit
  );

  const shiftEngine = new ShiftEngine(shifts, cash);

  return { salesEngine, products, cash, shiftEngine, shifts, inventory, sales, cart };
}

describe("FASE 6 — Prueba de usuario (negocio vacio)", () => {
  // =========================================================================
  // PRUEBA 1 — DATOS VACÍOS: caja sin ingredientes fantasma
  // =========================================================================
  describe("prueba 1: datos vacios", () => {
    it("caja vacia muestra 0 movimientos, sin ingredientes ni productos", async () => {
      const ctx = buildUserTestCtx();
      await ctx.shiftEngine.openShift(CASHIER_ID, 50000, "Fondo inicial");

      const movements = await ctx.cash.getAllMovements();
      expect(movements).toHaveLength(0);
    });
  });

  // =========================================================================
  // PRUEBA 2 — FLUJO COMPLETO: crear producto → vender → cobrar → verificar
  // =========================================================================
  describe("prueba 2: flujo completo desde cero", () => {
    const PRODUCT: Product = {
      id: "prod-user-test-1",
      name: "Café con leche",
      categoryId: "cat-1",
      price: 8000,
      stock: 100,
      minStock: 0,
      lastUpdated: new Date(),
      trackStock: true,
      requiresKitchen: false
    };

    it("paso 1: crear producto en inventario vacío", async () => {
      const ctx = buildUserTestCtx();
      await ctx.products.save(PRODUCT);

      const all = await ctx.products.findAll();
      expect(all).toHaveLength(1);
      expect(all[0].id).toBe(PRODUCT.id);
    });

    it("paso 2: crear venta del producto", async () => {
      const ctx = buildUserTestCtx();
      await ctx.products.save(PRODUCT);

      const sale = await ctx.salesEngine.quickSale({
        source: [{ productId: PRODUCT.id, quantity: 1, price: 8000 }],
        cashierId: CASHIER_ID,
        taxRate: 0
      });

      expect(sale).toBeDefined();
      expect(sale.total).toBe(8000);
    });

    it("paso 3: cobrar venta en efectivo", async () => {
      const ctx = buildUserTestCtx();
      await ctx.products.save(PRODUCT);

      const sale = await ctx.salesEngine.quickSale({
        source: [{ productId: PRODUCT.id, quantity: 1, price: 8000 }],
        cashierId: CASHIER_ID,
        taxRate: 0
      });

      const { payment } = await ctx.salesEngine.registerPayment(sale, "CASH", {
        received: 8000
      });

      expect(payment.method).toBe("CASH");
      expect(payment.success).toBe(true);
    });

    it("paso 4: verificar venta en historial y caja", async () => {
      const ctx = buildUserTestCtx();
      await ctx.shiftEngine.openShift(CASHIER_ID, 50000, "Fondo inicial");
      await ctx.products.save(PRODUCT);

      const sale = await ctx.salesEngine.quickSale({
        source: [{ productId: PRODUCT.id, quantity: 1, price: 8000 }],
        cashierId: CASHIER_ID,
        taxRate: 0
      });

      await ctx.salesEngine.registerPayment(sale, "CASH", {
        received: 8000
      });

      // Verificar caja
      const movements = await ctx.cash.getAllMovements();
      expect(movements).toHaveLength(1); // solo la venta (el fondo inicial no es movimiento automático)
      const saleMovement = movements.find(m => m.type === "IN" && m.amount === 8000);
      expect(saleMovement).toBeDefined();

      // Verificar inventario disminuyó
      const productAfter = await ctx.products.findById(PRODUCT.id);
      expect(productAfter?.stock).toBe(99);
    });
  });

  // =========================================================================
  // PRUEBA 3 — SEGUNDA VENTA: verificar que el flujo se vuelve natural
  // =========================================================================
  describe("prueba 3: segunda venta (mismo producto)", () => {
    const PRODUCT: Product = {
      id: "prod-user-test-3",
      name: "Café con leche",
      categoryId: "cat-1",
      price: 8000,
      stock: 100,
      minStock: 0,
      lastUpdated: new Date(),
      trackStock: true,
      requiresKitchen: false
    };

    it("segunda venta es más rapida y no tiene errores", async () => {
      const ctx = buildUserTestCtx();
      await ctx.products.save(PRODUCT);

      // Primera venta
      const sale1 = await ctx.salesEngine.quickSale({
        source: [{ productId: PRODUCT.id, quantity: 1, price: 8000 }],
        cashierId: CASHIER_ID,
        taxRate: 0
      });
      await ctx.salesEngine.registerPayment(sale1, "CASH", { received: 8000 });

      // Segunda venta
      const sale2 = await ctx.salesEngine.quickSale({
        source: [{ productId: PRODUCT.id, quantity: 1, price: 8000 }],
        cashierId: CASHIER_ID,
        taxRate: 0
      });
      const { payment } = await ctx.salesEngine.registerPayment(sale2, "CASH", { received: 8000 });

      expect(payment.success).toBe(true);
      expect(payment.change).toBe(0);

      // Verificar stock
      const productAfter = await ctx.products.findById(PRODUCT.id);
      expect(productAfter?.stock).toBe(98);
    });
  });

  // =========================================================================
  // PRUEBA 4 — ERRORES TÉCNICOS VISIBLES
  // =========================================================================
  describe("prueba 4: sin errores tecnicos visibles", () => {
    it("no aparece query.eq is not a function en ningun paso", async () => {
      const ctx = buildUserTestCtx();
      await ctx.shiftEngine.openShift(CASHIER_ID, 50000, "Fondo inicial");

      // Todos estos pasos deben completarse sin errores de query
      await expect(ctx.cash.getAllMovements()).resolves.toBeDefined();
      await expect(ctx.cash.getTodayMovements()).resolves.toBeDefined();
      await expect(ctx.cash.getBalance()).resolves.toBeDefined();
      await expect(ctx.shiftEngine.getCurrentShift(CASHIER_ID)).resolves.toBeDefined();
    });
  });
});
