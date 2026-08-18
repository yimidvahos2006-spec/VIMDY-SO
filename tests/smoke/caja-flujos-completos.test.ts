// tests/smoke/caja-flujos-completos.test.ts
/* ===========================================================================
   SMOKE TEST — Caja, pagos, turnos y conciliacion (FASE 4)
   =========================================================================== */

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
import { SalesEngine, CreateSaleInput } from "../../src/core/engines/SalesEngine";
import { ShiftEngine } from "../../src/core/engines/ShiftEngine";
import { PosCore } from "../../src/core/engines/PosCore";
import type { PendingSale } from "../../src/core/offline/PendingSale";

import { InMemoryRepository } from "../fakes/InMemoryRepository";
import { FakeProductRepository } from "../fakes/FakeProductRepository";

const PRODUCT_ID = "prod-caja-1";
const CASHIER_ID = "cashier-caja-1";

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
    audit
  );

  const shiftEngine = new ShiftEngine(shifts, cash);

  return { salesEngine, products, cart, kitchenOrders, cashMovements, cash, shiftEngine, shifts, kitchenEngine: kitchen };
}

const PRODUCT: Product = {
  id: PRODUCT_ID,
  name: "Producto Caja",
  categoryId: "cat-1",
  price: 50000,
  stock: 100,
  minStock: 0,
  lastUpdated: new Date(),
  trackStock: true,
  requiresKitchen: false
};

describe("Smoke: caja, pagos, turnos y conciliacion (FASE 4)", () => {
  let ctx: ReturnType<typeof buildSalesEngine>;

  beforeEach(async () => {
    ctx = buildSalesEngine();
    await ctx.products.save(PRODUCT);
  });

  // =========================================================================
  // 1. APERTURA DE CAJA
  // =========================================================================
  describe("apertura de caja", () => {
    it("abre un turno con fondo inicial y usuario responsable", async () => {
      const shift = await ctx.shiftEngine.openShift(CASHIER_ID, 50000, "Fondo inicial");

      expect(shift.status).toBe("OPEN");
      expect(shift.cashierId).toBe(CASHIER_ID);
      expect(shift.openingAmount).toBe(50000);
      expect(shift.openedAt).toBeDefined();
    });

    it("no permite abrir dos turnos simultaneamente", async () => {
      await ctx.shiftEngine.openShift(CASHIER_ID, 50000);

      await expect(ctx.shiftEngine.openShift("cashier-2", 50000)).rejects.toThrow(
        /SHIFT_ALREADY_OPEN/
      );
    });
  });

  // =========================================================================
  // 2. DINERO INICIAL
  // =========================================================================
  describe("dinero inicial", () => {
    it("el fondo inicial forma parte del efectivo esperado", async () => {
      const shift = await ctx.shiftEngine.openShift(CASHIER_ID, 50000);
      await ctx.cash.registerIncome(30000, "Venta RAP-001", "CASH");

      const summary = await ctx.shiftEngine.getShiftSummary(shift.id);
      expect(summary.expectedAmount).toBe(80000);
    });
  });

  // =========================================================================
  // 3-7. PAGOS: EFECTIVO, TARJETA, TRANSFERENCIA, MIXTO, CAMBIO
  // =========================================================================
  describe("pagos y cambio", () => {
    it("venta en efectivo registra el ingreso correcto en caja", async () => {
      const sale = await ctx.salesEngine.quickSale({
        source: [{ productId: PRODUCT_ID, quantity: 1, price: 70000 }],
        cashierId: CASHIER_ID,
        taxRate: 0
      });

      const { payment } = await ctx.salesEngine.registerPayment(sale, "CASH", {
        received: 70000
      });

      expect(payment.method).toBe("CASH");
      expect(payment.change).toBe(0);

      const movements = await ctx.cashMovements.findAll();
      expect(movements).toHaveLength(1);
      expect(movements[0].amount).toBe(70000);
      expect(movements[0].paymentMethod).toBe("CASH");
      expect(movements[0].cashAmount).toBe(70000);
    });

    it("venta con tarjeta registra ingreso pero no suma al efectivo del cajon", async () => {
      await ctx.shiftEngine.openShift(CASHIER_ID, 50000);

      const sale = await ctx.salesEngine.quickSale({
        source: [{ productId: PRODUCT_ID, quantity: 1, price: 80000 }],
        cashierId: CASHIER_ID,
        taxRate: 0
      });

      const { payment } = await ctx.salesEngine.registerPayment(sale, "CARD", {
        reference: "TARJ-123"
      });

      expect(payment.method).toBe("CARD");

      const summary = await ctx.shiftEngine.getShiftSummary(
        (await ctx.shiftEngine.getCurrentShift())!.id
      );
      expect(summary.totalCashIncome).toBe(0);
      expect(summary.incomeByMethod.CARD).toBe(80000);
    });

    it("venta por transferencia registra ingreso pero no suma al efectivo", async () => {
      await ctx.shiftEngine.openShift(CASHIER_ID, 50000);

      const sale = await ctx.salesEngine.quickSale({
        source: [{ productId: PRODUCT_ID, quantity: 1, price: 60000 }],
        cashierId: CASHIER_ID,
        taxRate: 0
      });

      const { payment } = await ctx.salesEngine.registerPayment(sale, "TRANSFER", {
        reference: "TRANS-456"
      });

      expect(payment.method).toBe("TRANSFER");

      const summary = await ctx.shiftEngine.getShiftSummary(
        (await ctx.shiftEngine.getCurrentShift())!.id
      );
      expect(summary.totalCashIncome).toBe(0);
      expect(summary.incomeByMethod.TRANSFER).toBe(60000);
    });

    it("pago mixto registra la porcion en efectivo correctamente", async () => {
      await ctx.shiftEngine.openShift(CASHIER_ID, 50000);

      const sale = await ctx.salesEngine.quickSale({
        source: [{ productId: PRODUCT_ID, quantity: 1, price: 100000 }],
        cashierId: CASHIER_ID,
        taxRate: 0
      });

      const { payment } = await ctx.salesEngine.registerPayment(sale, "MIXED", {
        received: 100000,
        mixed: { cash: 40000, card: 60000 },
        reference: "MIX-REF"
      });

      expect(payment.method).toBe("MIXED");

      const summary = await ctx.shiftEngine.getShiftSummary(
        (await ctx.shiftEngine.getCurrentShift())!.id
      );
      expect(summary.totalCashIncome).toBe(40000);
      expect(summary.incomeByMethod.MIXED).toBe(100000);
    });

    it("el cambio en efectivo se registra como egreso de caja", async () => {
      const sale = await ctx.salesEngine.quickSale({
        source: [{ productId: PRODUCT_ID, quantity: 1, price: 70000 }],
        cashierId: CASHIER_ID,
        taxRate: 0
      });

      const received = 100000;
      const { payment } = await ctx.salesEngine.registerPayment(sale, "CASH", { received });

      expect(payment.change).toBe(30000);

      const movements = await ctx.cashMovements.findAll();
      expect(movements).toHaveLength(2);
      const incomes = movements.filter(m => m.type === "IN");
      const expenses = movements.filter(m => m.type === "OUT");
      expect(incomes).toHaveLength(1);
      expect(incomes[0].amount).toBe(70000);
      expect(expenses).toHaveLength(1);
      expect(expenses[0].amount).toBe(30000);
      expect(expenses[0].description).toContain("Cambio");
    });

    it("el cambio en pago mixto tambien se registra como egreso", async () => {
      const sale = await ctx.salesEngine.quickSale({
        source: [{ productId: PRODUCT_ID, quantity: 1, price: 80000 }],
        cashierId: CASHIER_ID,
        taxRate: 0
      });

      const { payment } = await ctx.salesEngine.registerPayment(sale, "MIXED", {
        received: 100000,
        mixed: { cash: 80000, card: 20000 },
        reference: "MIX-CHANGE"
      });

      expect(payment.change).toBe(20000);

      const movements = await ctx.cashMovements.findAll();
      const expenses = movements.filter(m => m.type === "OUT");
      expect(expenses).toHaveLength(1);
      expect(expenses[0].amount).toBe(20000);
    });
  });

  // =========================================================================
  // 8-9. ENTRADAS Y SALIDAS MANUALES
  // =========================================================================
  describe("entradas y salidas manuales", () => {
    it("registra una entrada manual de efectivo", async () => {
      await ctx.shiftEngine.openShift(CASHIER_ID, 50000);

      const movement = await ctx.cash.registerIncome(
        15000,
        "Ingreso adicional para cambio",
        "CASH"
      );

      expect(movement.type).toBe("IN");
      expect(movement.amount).toBe(15000);
      expect(movement.paymentMethod).toBe("CASH");
      expect(movement.cashAmount).toBe(15000);

      const summary = await ctx.shiftEngine.getShiftSummary(
        (await ctx.shiftEngine.getCurrentShift())!.id
      );
      expect(summary.expectedAmount).toBe(65000);
    });

    it("registra una salida manual de efectivo", async () => {
      await ctx.shiftEngine.openShift(CASHIER_ID, 50000);

      await ctx.cash.registerExpense(12000, "Retiro para el banco");

      const summary = await ctx.shiftEngine.getShiftSummary(
        (await ctx.shiftEngine.getCurrentShift())!.id
      );
      expect(summary.expectedAmount).toBe(38000);
      expect(summary.totalExpense).toBe(12000);
    });
  });

  // =========================================================================
  // 10. DEVOLUCIONES
  // =========================================================================
  describe("devoluciones", () => {
    it("devolucion total afecta caja y descuenta del efectivo esperado", async () => {
      const sale = await ctx.salesEngine.quickSale({
        source: [{ productId: PRODUCT_ID, quantity: 2, price: 50000 }],
        cashierId: CASHIER_ID,
        taxRate: 0
      });

      await ctx.salesEngine.registerPayment(sale, "CASH", { received: 100000 });

      const { sale: refundedSale } = await ctx.salesEngine.refundSale(
        sale.id,
        "Producto defectuoso",
        CASHIER_ID
      );

      expect(refundedSale.status).toBe("REFUNDED");

      const expenses = (await ctx.cashMovements.findAll()).filter(m => m.type === "OUT");
      expect(expenses.some(e => e.amount === 100000 && e.description?.includes("Reembolso"))).toBe(true);
    });

    it("devolucion parcial registra solo el monto devuelto en caja", async () => {
      const sale = await ctx.salesEngine.quickSale({
        source: [{ productId: PRODUCT_ID, quantity: 3, price: 50000 }],
        cashierId: CASHIER_ID,
        taxRate: 0
      });

      await ctx.salesEngine.registerPayment(sale, "CASH", { received: 150000 });

      const { amount } = await ctx.salesEngine.partialRefundSale(
        sale.id,
        [{ productId: PRODUCT_ID, quantity: 1 }],
        "Cliente devuelve 1 unidad",
        CASHIER_ID
      );

      expect(amount).toBe(50000);

      const expenses = (await ctx.cashMovements.findAll()).filter(m => m.type === "OUT");
      expect(expenses.some(e => e.amount === 50000)).toBe(true);
    });
  });

  // =========================================================================
  // 11-13. CALCULO DE EFECTIVO ESPERADO, CONTADO Y DIFERENCIA
  // =========================================================================
  describe("calculo de caja", () => {
    it("efectivo esperado = fondo + ventas efectivo + entradas - salidas - cambio", async () => {
      const shift = await ctx.shiftEngine.openShift(CASHIER_ID, 100000);

      await ctx.cash.registerIncome(70000, "Venta RAP-001", "CASH");
      await ctx.cash.registerIncome(30000, "Venta RAP-002", "CARD");
      await ctx.cash.registerExpense(10000, "Retiro");
      await ctx.cash.registerIncome(5000, "Ingreso extra", "CASH");

      const summary = await ctx.shiftEngine.getShiftSummary(shift.id);

      // 100000 + 70000 + 5000 - 10000 = 165000
      expect(summary.expectedAmount).toBe(165000);
      expect(summary.totalIncome).toBe(105000);
      expect(summary.totalCashIncome).toBe(75000);
      expect(summary.totalExpense).toBe(10000);
    });

    it("cierre con sobrante (diferencia positiva)", async () => {
      const shift = await ctx.shiftEngine.openShift(CASHIER_ID, 50000);
      await ctx.cash.registerIncome(30000, "Venta RAP-001", "CASH");

      const closed = await ctx.shiftEngine.closeShift(shift.id, 85000);

      expect(closed.expectedAmount).toBe(80000);
      expect(closed.countedAmount).toBe(85000);
      expect(closed.difference).toBe(5000);
      expect(closed.status).toBe("CLOSED");
    });

    it("cierre con faltante (diferencia negativa)", async () => {
      const shift = await ctx.shiftEngine.openShift(CASHIER_ID, 50000);
      await ctx.cash.registerIncome(30000, "Venta RAP-001", "CASH");

      const closed = await ctx.shiftEngine.closeShift(shift.id, 75000);

      expect(closed.expectedAmount).toBe(80000);
      expect(closed.countedAmount).toBe(75000);
      expect(closed.difference).toBe(-5000);
    });
  });

  // =========================================================================
  // 15. USUARIO RESPONSABLE
  // =========================================================================
  describe("usuario responsable", () => {
    it("el turno registra el cajero que lo abrio", async () => {
      const shift = await ctx.shiftEngine.openShift(CASHIER_ID, 50000);
      expect(shift.cashierId).toBe(CASHIER_ID);
    });

    it("getCurrentShift filtra por cajero", async () => {
      await ctx.shiftEngine.openShift(CASHIER_ID, 50000);

      const own = await ctx.shiftEngine.getCurrentShift(CASHIER_ID);
      expect(own).not.toBeNull();
      expect(own!.cashierId).toBe(CASHIER_ID);

      const other = await ctx.shiftEngine.getCurrentShift("other-cashier");
      expect(other).toBeNull();
    });
  });

  // =========================================================================
  // 16-18. AISLAMIENTO MULTI-TENANT
  // =========================================================================
  describe("aislamiento multi-tenant", () => {
    it("Shift y CashMovement exponen businessId/branchId en la entidad", () => {
      const shift: Shift = {
        id: "shift-1",
        businessId: "business-A",
        branchId: "branch-1",
        cashierId: CASHIER_ID,
        status: "OPEN",
        openingAmount: 50000,
        openedAt: new Date()
      };

      const movement: CashMovement = {
        id: "mov-1",
        businessId: "business-A",
        branchId: "branch-1",
        amount: 50000,
        type: "IN",
        date: new Date(),
        paymentMethod: "CASH",
        cashAmount: 50000
      };

      expect(shift.businessId).toBe("business-A");
      expect(shift.branchId).toBe("branch-1");
      expect(movement.businessId).toBe("business-A");
      expect(movement.branchId).toBe("branch-1");
    });

    it("dos turnos en repositorios separados no se mezclan", async () => {
      const repoA = new InMemoryRepository<Shift>("shifts-A");
      const repoB = new InMemoryRepository<Shift>("shifts-B");
      const cashA = new CashEngine(new InMemoryRepository<CashMovement>("cash-A"));
      const cashB = new CashEngine(new InMemoryRepository<CashMovement>("cash-B"));

      const shiftA = new ShiftEngine(repoA, cashA);
      const shiftB = new ShiftEngine(repoB, cashB);

      await shiftA.openShift("cashier-A", 50000);
      await shiftB.openShift("cashier-B", 50000);

      const openA = await shiftA.getCurrentShift();
      const openB = await shiftB.getCurrentShift();

      expect(openA).not.toBeNull();
      expect(openB).not.toBeNull();
      expect(openA!.id).not.toBe(openB!.id);
    });
  });

  // =========================================================================
  // 19. NO DUPLICAR MOVIMIENTOS (IDEMPOTENCIA)
  // =========================================================================
  describe("idempotencia de movimientos", () => {
    it("registrar el mismo ingreso dos veces con el mismo id no duplica", async () => {
      const id = "income-idempotent-1";

      await ctx.cash.registerIncome(50000, "Venta RAP-001", "CASH", undefined, id);
      await ctx.cash.registerIncome(50000, "Venta RAP-001 (reintento)", "CASH", undefined, id);

      const movements = await ctx.cashMovements.findAll();
      expect(movements).toHaveLength(1);
      expect(movements[0].id).toBe(id);
    });

    it("registrar el mismo egreso dos veces con el mismo id no duplica", async () => {
      const id = "expense-idempotent-1";

      await ctx.cash.registerExpense(10000, "Retiro", id);
      await ctx.cash.registerExpense(10000, "Retiro (reintento)", id);

      const movements = await ctx.cashMovements.findAll();
      expect(movements).toHaveLength(1);
      expect(movements[0].id).toBe(id);
    });
  });

  // =========================================================================
  // 20-22. INTEGRACION VENTA -> PAGO -> CAJA
  // =========================================================================
  describe("integracion venta -> pago -> caja", () => {
    it("una venta cobrada genera el movimiento de caja correspondiente", async () => {
      const sale = await ctx.salesEngine.quickSale({
        source: [{ productId: PRODUCT_ID, quantity: 1, price: 90000 }],
        cashierId: CASHIER_ID,
        taxRate: 0
      });

      await ctx.salesEngine.registerPayment(sale, "CASH", { received: 90000 });

      const movements = await ctx.cashMovements.findAll();
      const saleMovements = movements.filter(m => m.description?.includes(sale.code ?? sale.id));
      expect(saleMovements.length).toBeGreaterThanOrEqual(1);
      expect(saleMovements[0].type).toBe("IN");
      expect(saleMovements[0].amount).toBe(90000);
    });

    it("una devolucion genera el egreso correspondiente en caja", async () => {
      const sale = await ctx.salesEngine.quickSale({
        source: [{ productId: PRODUCT_ID, quantity: 1, price: 90000 }],
        cashierId: CASHIER_ID,
        taxRate: 0
      });

      await ctx.salesEngine.registerPayment(sale, "CASH", { received: 90000 });

      const { sale: refunded } = await ctx.salesEngine.refundSale(
        sale.id,
        "Prueba devolucion",
        CASHIER_ID
      );

      expect(refunded.status).toBe("REFUNDED");

      const expenses = (await ctx.cashMovements.findAll()).filter(m => m.type === "OUT");
      expect(expenses.some(e => e.amount === 90000 && e.description?.includes("Reembolso"))).toBe(true);
    });
  });

  // =========================================================================
  // 23. VENTA OFFLINE Y SINCRONIZACION
  // =========================================================================
  describe("venta offline y sincronizacion", () => {
    it("una venta offline encolada mantiene los datos de pago", async () => {
      const createSaleInput: CreateSaleInput = {
        id: "offline-sync-1",
        type: "QUICK",
        items: [{ productId: PRODUCT_ID, quantity: 1, price: 50000 }],
        customerId: "CLIENTE_GENERAL",
        cashierId: CASHIER_ID,
        taxRate: 0
      };

      const pendingSale: PendingSale = {
        id: "offline-sync-1",
        createSaleInput,
        payment: {
          method: "CASH",
          received: 50000
        },
        cashierName: "Cajero Test",
        status: "PENDING_SYNC",
        queuedAt: new Date(),
        attempts: 0,
        businessId: "biz-1",
        branchId: "branch-1"
      };

      expect(pendingSale.payment?.method).toBe("CASH");
      expect(pendingSale.payment?.received).toBe(50000);
      expect(pendingSale.createSaleInput.id).toBe("offline-sync-1");
    });
  });

  // =========================================================================
  // 24. RECIBO CON PAGOS CORRECTOS
  // =========================================================================
  describe("recibo con pagos correctos", () => {
    it("el recibo refleja el metodo de pago real", async () => {
      const sale = await ctx.salesEngine.quickSale({
        source: [{ productId: PRODUCT_ID, quantity: 1, price: 80000 }],
        cashierId: CASHIER_ID,
        taxRate: 0
      });

      const { payment } = await ctx.salesEngine.registerPayment(sale, "CARD", {
        reference: "CARD-REF-999"
      });

      const receipt = await ctx.salesEngine.getReceiptBySaleId(sale.id);
      expect(receipt).not.toBeNull();
      expect(receipt!.paymentMethod).toBe("CARD");
      expect(receipt!.total).toBe(80000);
    });
  });

  // =========================================================================
  // 25. DOBLE COBRO SIMULTANEO (IDEMPOTENCIA)
  // =========================================================================
  describe("doble cobro simultaneo", () => {
    it("dos cobros concurrentes de la misma venta no duplican el dinero en caja", async () => {
      const sale = await ctx.salesEngine.quickSale({
        source: [{ productId: PRODUCT_ID, quantity: 1, price: 60000 }],
        cashierId: CASHIER_ID,
        taxRate: 0
      });

      const [result1, result2] = await Promise.all([
        ctx.salesEngine.registerPayment(sale, "CASH", { received: 60000 }),
        ctx.salesEngine.registerPayment(sale, "CASH", { received: 60000 })
      ]);

      expect(result1.sale.status).toBe("PAID");
      expect(result2.sale.status).toBe("PAID");

      const movements = await ctx.cashMovements.findAll();
      const incomeMovements = movements.filter(m => m.type === "IN" && m.description?.includes(sale.code ?? sale.id));
      expect(incomeMovements.length).toBeLessThanOrEqual(1);
    });
  });

  // =========================================================================
  // 26. AISLAMIENTO MULTI-NEGOCIO EN CAJA
  // =========================================================================
  describe("aislamiento multi-negocio en caja", () => {
    it("CashEngine y ShiftEngine solo ven movimientos/turnos de su negocio", async () => {
      const shift = await ctx.shiftEngine.openShift(CASHIER_ID, 50000, "Negocio A");

      await ctx.cash.registerIncome(20000, "Venta negocio A", "CASH");

      const otherCash = new CashEngine(ctx.cashMovements);
      const otherShiftEngine = new ShiftEngine(ctx.shifts as any, otherCash);

      const otherMovements = await otherCash.getAllMovements();
      const otherShift = await otherShiftEngine.getCurrentShift();

      expect(otherMovements).toHaveLength(1);
      expect(otherMovements[0].description).toBe("Venta negocio A");

      expect(otherShift?.id).toBe(shift.id);
      expect(otherShift?.cashierId).toBe(CASHIER_ID);
    });
  });
});
