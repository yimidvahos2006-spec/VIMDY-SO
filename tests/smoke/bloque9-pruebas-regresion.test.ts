// tests/smoke/bloque9-pruebas-regresion.test.ts
// ===========================================================================
// BLOQUE 9 — PRUEBAS DE REGRESIÓN OBLIGATORIAS
// Secciones 61, 62, 63 del plan maestro.
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

const CASHIER_ID = "cashier-regression-1";

function buildRegressionCtx() {
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

  return { salesEngine, products, cash, shiftEngine, shifts, inventory };
}

describe("BLOQUE 9 — Pruebas de regresion (plan maestro secciones 61-63)", () => {
  // =========================================================================
  // SECCION 61 — DATOS VACIOS
  // =========================================================================
  describe("seccion 61: datos vacios", () => {
    it("negocio sin productos abre caja sin errores ni basura", async () => {
      const ctx = buildRegressionCtx();

      const shift = await ctx.shiftEngine.openShift(CASHIER_ID, 50000, "Fondo inicial");

      const summary = await ctx.shiftEngine.getShiftSummary(shift.id);
      expect(summary.expectedAmount).toBe(50000);
      expect(summary.totalIncome).toBe(0);
    });

    it("caja sin movimientos muestra ceros, no ingredientes ni productos", async () => {
      const ctx = buildRegressionCtx();
      await ctx.shiftEngine.openShift(CASHIER_ID, 50000);

      const movements = await ctx.cash.getAllMovements();
      expect(movements).toHaveLength(0);
    });
  });

  // =========================================================================
  // SECCION 62 — INGREDIENTE FANTASMA EN CAJA (OBLIGATORIA)
  // =========================================================================
  describe("seccion 62: ingrediente fantasma en caja", () => {
    const PRODUCT_NORMAL: Product = {
      id: "prod-normal-62",
      name: "Hamburguesa",
      categoryId: "cat-1",
      price: 25000,
      stock: 100,
      minStock: 0,
      lastUpdated: new Date(),
      trackStock: true,
      requiresKitchen: false,
      isIngredient: false
    };

    const INGREDIENT: Product = {
      id: "ingrediente-62",
      name: "Carne",
      categoryId: "cat-ingredientes",
      price: 0,
      stock: 50,
      minStock: 0,
      lastUpdated: new Date(),
      trackStock: true,
      requiresKitchen: false,
      isIngredient: true
    };

    it("crear ingrediente y vender producto normal no genera movimiento de ingrediente en caja", async () => {
      const ctx = buildRegressionCtx();
      await ctx.products.save(PRODUCT_NORMAL);
      await ctx.products.save(INGREDIENT);

      const sale = await ctx.salesEngine.quickSale({
        source: [{ productId: PRODUCT_NORMAL.id, quantity: 1, price: 25000 }],
        cashierId: CASHIER_ID,
        taxRate: 0
      });

      const { payment } = await ctx.salesEngine.registerPayment(sale, "CASH", {
        received: 25000
      });

      const movements = await ctx.cash.getAllMovements();
      expect(movements).toHaveLength(1);
      expect(movements[0].type).toBe("IN");
      expect(movements[0].amount).toBe(25000);
      expect(movements[0].description).toMatch(/venta|sale|pago/i);
      expect((movements[0] as any).productId).toBeUndefined();
    });

    it("despues de eliminar todos los productos, caja sigue sin mostrar ingredientes ni basura", async () => {
      const ctx = buildRegressionCtx();
      await ctx.products.save(PRODUCT_NORMAL);
      await ctx.products.save(INGREDIENT);

      await ctx.products.delete(PRODUCT_NORMAL.id);
      await ctx.products.delete(INGREDIENT.id);

      const products = await ctx.products.findAll();
      expect(products).toHaveLength(0);

      await ctx.shiftEngine.openShift(CASHIER_ID, 50000);
      const movements = await ctx.cash.getAllMovements();
      expect(movements).toHaveLength(0);
    });
  });

  // =========================================================================
  // SECCION 63 — PRUEBA DE CARGA DE CAJA SIN query.eq
  // =========================================================================
  describe("seccion 63: carga de caja sin query.eq is not a function", () => {
    it("CashEngine carga turnos y movimientos sin errores de query", async () => {
      const ctx = buildRegressionCtx();

      const shift = await ctx.shiftEngine.openShift(CASHIER_ID, 50000, "Fondo inicial");
      await ctx.cash.registerIncome(30000, "Venta", "CASH");
      await ctx.cash.registerExpense(10000, "Retiro", "Gasto");

      const loadedShift = await ctx.shiftEngine.getCurrentShift(CASHIER_ID);
      expect(loadedShift).toBeDefined();
      expect(loadedShift?.status).toBe("OPEN");

      const summary = await ctx.shiftEngine.getShiftSummary(shift.id);
      expect(summary.expectedAmount).toBe(70000);
      expect(summary.totalIncome).toBe(30000);

      const movements = await ctx.cash.getAllMovements();
      expect(movements).toHaveLength(2);
    });
  });
});
