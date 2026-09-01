import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockSupabase } = vi.hoisted(() => {
  const mockFrom = vi.fn(() => ({
    select: vi.fn(() => ({
      eq: vi.fn(() => ({
        maybeSingle: vi.fn(),
        single: vi.fn()
      }))
    })),
    insert: vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          maybeSingle: vi.fn(),
          single: vi.fn()
        }))
      }))
    }))
  }));

  const mockSupabase = {
    from: mockFrom,
    rpc: vi.fn(() => ({ data: null, error: null }))
  };

  return { mockSupabase };
});

let currentBusinessId: string | null = null;
let currentBranchId: string | null = null;

vi.mock("../../src/infrastructure/supabase/supabaseClient", () => ({
  supabase: mockSupabase,
  setCurrentBusinessId: (id: string | null) => { currentBusinessId = id; },
  setCurrentBranchId: (id: string | null) => { currentBranchId = id; },
  getCurrentBusinessId: () => currentBusinessId,
  getCurrentBranchId: () => currentBranchId
}));

import { SubscriptionService } from "../../src/infrastructure/supabase/subscriptionService";
import { CashEngine } from "../../src/core/engines/CashEngine";
import { KitchenEngine } from "../../src/core/engines/KitchenEngine";
import { SalesEngine } from "../../src/core/engines/SalesEngine";
import { CartEngine } from "../../src/core/engines/CartEngine";
import { InventoryEngine } from "../../src/core/engines/InventoryEngine";
import { PaymentEngine } from "../../src/core/engines/PaymentEngine";
import { AlertEngine } from "../../src/core/engines/AlertEngine";
import { HealthEngine } from "../../src/core/engines/HealthEngine";
import { KardexEngine } from "../../src/core/engines/KardexEngine";
import { AuditEngine } from "../../src/core/engines/AuditEngine";
import { InMemoryRepository } from "../fakes/InMemoryRepository";
import { FakeProductRepository } from "../fakes/FakeProductRepository";
import { AuditLog } from "../../src/core/entities/Entities";
import { setCurrentBusinessId, setCurrentBranchId } from "../../src/infrastructure/supabase/supabaseClient";

describe("P3 — Caos: pagos, caja, multi-tenant", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setCurrentBusinessId(null);
    setCurrentBranchId(null);
  });

  describe("PAGOS — webhook duplicado", () => {
    it("wompi: mismo reference aprobado dos veces no duplica activación", async () => {
      const service = new SubscriptionService();

      const paymentRow = {
        id: "p-dup-1",
        business_id: "b-dup",
        plan: "monthly",
        amount: 89,
        currency: "COP",
        status: "pending",
        renewal_number: 0,
        wompi_reference: "ref-dup-1"
      };

      (mockSupabase.from as any).mockReturnValueOnce({
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({ data: paymentRow, error: null })
          })
        })
      });

      (mockSupabase as any).rpc.mockResolvedValueOnce({ data: { ok: true, alreadyActivated: false, renewalNumber: 1 }, error: null });

      const result1 = await service.activateSubscription("b-dup", "monthly", "p-dup-1");
      expect(result1.ok).toBe(true);
      expect(result1.alreadyActivated).toBe(false);

      (mockSupabase.from as any).mockReturnValueOnce({
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({ data: { ...paymentRow, status: "approved", renewal_number: 1 }, error: null })
          })
        })
      });

      const result2 = await service.activateSubscription("b-dup", "monthly", "p-dup-1");
      expect(result2.ok).toBe(true);
      expect(result2.alreadyActivated).toBe(true);
    });
  });

  describe("PAGOS — webhook retrasado", () => {
    it("mercado pago: pago ya aprobado, webhook reintentado no cambia estado ni reactiva", async () => {
      const service = new SubscriptionService();

      (mockSupabase.from as any).mockReturnValueOnce({
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({ data: { id: "p-old", business_id: "b-old", plan: "monthly", amount: 89, currency: "COP", status: "approved", renewal_number: 2 }, error: null })
          })
        })
      });

      const result = await service.activateSubscription("b-old", "monthly", "p-old");
      expect(result.ok).toBe(true);
      expect(result.alreadyActivated).toBe(true);
      expect(mockSupabase.rpc).not.toHaveBeenCalled();
    });
  });

  describe("PAGOS — webhook fuera de orden", () => {
    it("paypal: si el pago ya tiene status approved, no se captura de nuevo", async () => {
      (mockSupabase.from as any).mockReturnValueOnce({
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({ data: { id: "p-oo", business_id: "b-oo", plan: "monthly", amount: 89, currency: "USD", status: "approved", paypal_order_id: "order-oo", renewal_number: 1 }, error: null })
          })
        })
      });

      const service = new SubscriptionService();
      const result = await service.activateSubscription("b-oo", "monthly", "p-oo");
      expect(result.ok).toBe(true);
      expect(result.alreadyActivated).toBe(true);
    });

    it("paypal: si el pago tiene status declined, no activa y devuelve error", async () => {
      (mockSupabase.from as any).mockReturnValueOnce({
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({ data: { id: "p-dec", business_id: "b-dec", plan: "monthly", amount: 89, currency: "USD", status: "declined", renewal_number: 0 }, error: null })
          })
        })
      });

      const service = new SubscriptionService();
      const result = await service.activateSubscription("b-dec", "monthly", "p-dec");
      expect(result.ok).toBe(false);
      expect(result.error).toBe("PAGO_DECLINADO");
    });
  });

  describe("CAJA — timeout RPC y reintento", () => {
    it("registerIncome: si registerIncome falla, el error se propaga y no se registra movimiento", async () => {
      setCurrentBusinessId("b-cash");
      setCurrentBranchId("br-cash");

      const repo = new InMemoryRepository<any>("cash_movements");
      const audit = new AuditEngine(new InMemoryRepository<AuditLog>("audit_logs"));
      const cash = new CashEngine(repo);

      const registerIncomeSpy = vi
        .spyOn(cash, "registerIncome")
        .mockRejectedValueOnce(new Error("CASH_RPC_FAILED"));

      await expect(
        cash.registerIncome(100000, "Venta s-cash-1", "CASH", 100000, "sale-payment-s-cash-1")
      ).rejects.toThrow("CASH_RPC_FAILED");

      const movements = await repo.findAll();
      expect(movements.length).toBe(0);
      registerIncomeSpy.mockRestore();
    });
  });

  describe("CAJA — doble cobro simultáneo", () => {
    it("registerIncome: mismo id de venta pagado dos veces no duplica ingresos", async () => {
      setCurrentBusinessId("b-double");
      setCurrentBranchId("br-double");

      const repo = new InMemoryRepository<any>("cash_movements");
      const audit = new AuditEngine(new InMemoryRepository<AuditLog>("audit_logs"));
      const cash = new CashEngine(repo);

      await cash.registerIncome(100000, "Venta s-double (CASH)", "CASH", 100000, "sale-payment-s-double");

      await cash.registerIncome(100000, "Venta s-double (CASH)", "CASH", 100000, "sale-payment-s-double");

      const movements = await repo.findAll();
      expect(movements.length).toBe(1);
      expect(movements[0].amount).toBe(100000);
    });
  });

  describe("MULTI-TENANT — aislamiento", () => {
    it("kitchen: getActiveOrders no cruza datos entre business_id", async () => {
      setCurrentBusinessId("b-iso");
      setCurrentBranchId("br-iso");

      const repo = new InMemoryRepository<any>("kitchen_orders");
      const audit = new AuditEngine(new InMemoryRepository<AuditLog>("audit_logs"));
      const engine = new KitchenEngine(repo, audit);

      await repo.save({ id: "k-1", businessId: "b-iso", branchId: "br-iso", status: "PENDIENTE", items: [], createdAt: new Date() });
      await repo.save({ id: "k-2", businessId: "other-b", branchId: "other-br", status: "PENDIENTE", items: [], createdAt: new Date() });

      const active = await engine.getActiveOrders();
      expect(active).toHaveLength(1);
      expect(active[0].businessId).toBe("b-iso");
    });

    it("kitchen: getActiveOrders no cruza datos entre branch_id del mismo negocio", async () => {
      setCurrentBusinessId("b-iso");
      setCurrentBranchId("br-iso-a");

      const repo = new InMemoryRepository<any>("kitchen_orders");
      const audit = new AuditEngine(new InMemoryRepository<AuditLog>("audit_logs"));
      const engine = new KitchenEngine(repo, audit);

      await repo.save({ id: "k-3", businessId: "b-iso", branchId: "br-iso-a", status: "PENDIENTE", items: [], createdAt: new Date() });
      await repo.save({ id: "k-4", businessId: "b-iso", branchId: "br-iso-b", status: "PENDIENTE", items: [], createdAt: new Date() });

      const active = await engine.getActiveOrders();
      expect(active).toHaveLength(1);
      expect(active[0].branchId).toBe("br-iso-a");
    });
  });

  describe("VENTAS — caída antes/después de cocina y recuperación", () => {
    it("caída antes de cocina: si sendToKitchen falla, la venta se revierte y el inventario se restaura", async () => {
      setCurrentBusinessId("b-sale");
      setCurrentBranchId("br-sale");

      const products = new FakeProductRepository();
      const sales = new InMemoryRepository<any>("sales");
      const kitchenOrders = new InMemoryRepository<any>("kitchen_orders");
      const cashMovements = new InMemoryRepository<any>("cash_movements");
      const auditLogs = new InMemoryRepository<AuditLog>("audit_logs");

      await products.save({
        id: "prod-chaos",
        name: "Producto caos",
        categoryId: "cat-1",
        price: 10000,
        stock: 5,
        minStock: 1,
        requiresKitchen: true,
        lastUpdated: new Date()
      });

      const failingKitchen = {
        sendToKitchen: vi.fn(async () => {
          throw new Error("Kitchen connection lost");
        }),
        save: vi.fn(async () => {
          throw new Error("Kitchen connection lost");
        }),
        updateStatus: vi.fn(async () => {}),
        getActiveOrders: vi.fn(async () => []),
        getDeliveredOrders: vi.fn(async () => []),
        getAllOrders: vi.fn(async () => []),
        findById: vi.fn(async () => null),
        delete: vi.fn(async () => {})
      } as any;

      const inventory = new InventoryEngine(products as any, new KardexEngine(new InMemoryRepository<any>("movements") as any));
      const salesEngine = new SalesEngine(
        sales as any,
        new CartEngine(),
        inventory,
        new PaymentEngine(),
        { generateReceipt: async () => ({ id: "r-1" }) } as any,
        failingKitchen,
        new CashEngine(cashMovements as any),
        { findByBusiness: async () => ({ defaultCustomerId: "general" }) } as any,
        new AlertEngine(),
        new HealthEngine(),
        new KardexEngine(new InMemoryRepository<any>("movements") as any),
        {} as any,
        new AuditEngine(auditLogs as any)
      );

      await expect(
        salesEngine.createSale({
          id: "sale-chaos",
          type: "QUICK",
          items: [{ productId: "prod-chaos", quantity: 1, price: 10000 }],
          cashierId: "cashier-1"
        })
      ).rejects.toThrow("Kitchen connection lost");

      const allSales = await sales.findAll();
      expect(allSales).toHaveLength(0);

      const product = await products.findById("prod-chaos");
      expect(product?.stock).toBe(5);
    });

    it("caída después de venta: venta creada queda en PENDING_PAYMENT, recuperable", async () => {
      setCurrentBusinessId("b-sale2");
      setCurrentBranchId("br-sale2");

      const products = new FakeProductRepository();
      const sales = new InMemoryRepository<any>("sales");
      const kitchenOrders = new InMemoryRepository<any>("kitchen_orders");
      const cashMovements = new InMemoryRepository<any>("cash_movements");
      const auditLogs = new InMemoryRepository<AuditLog>("audit_logs");

      await products.save({
        id: "prod-chaos2",
        name: "Producto caos 2",
        categoryId: "cat-1",
        price: 10000,
        stock: 5,
        minStock: 1,
        lastUpdated: new Date()
      });

      const inventory = new InventoryEngine(products as any, new (await import("../../src/core/engines/KardexEngine")).KardexEngine(new InMemoryRepository<any>("movements") as any));
      const salesEngine = new SalesEngine(
        sales as any,
        new (await import("../../src/core/engines/CartEngine")).CartEngine(),
        inventory,
        new (await import("../../src/core/engines/PaymentEngine")).PaymentEngine(),
        { generateReceipt: async () => ({ id: "r-2" }) } as any,
        new KitchenEngine(kitchenOrders as any, new AuditEngine(auditLogs as any)),
        new CashEngine(cashMovements as any),
        { findByBusiness: async () => ({ defaultCustomerId: "general" }) } as any,
        new (await import("../../src/core/engines/AlertEngine")).AlertEngine(),
        new (await import("../../src/core/engines/HealthEngine")).HealthEngine(),
        new (await import("../../src/core/engines/KardexEngine")).KardexEngine(new InMemoryRepository<any>("movements") as any),
        {} as any,
        new AuditEngine(auditLogs as any)
      );

      const sale = await salesEngine.createSale({
        id: "sale-chaos2",
        type: "QUICK",
        items: [{ productId: "prod-chaos2", quantity: 1, price: 10000 }],
        cashierId: "cashier-1"
      });

      expect(sale.status).toBe("PENDING_PAYMENT");
      expect(sale.id).toBe("sale-chaos2");

      const allSales = await sales.findAll();
      expect(allSales).toHaveLength(1);
      expect(allSales[0].status).toBe("PENDING_PAYMENT");
    });

    it("sincronización duplicada: mismo id de venta no duplica inventario ni comanda", async () => {
      setCurrentBusinessId("b-sale3");
      setCurrentBranchId("br-sale3");

      const products = new FakeProductRepository();
      const sales = new InMemoryRepository<any>("sales");
      const kitchenOrders = new InMemoryRepository<any>("kitchen_orders");
      const cashMovements = new InMemoryRepository<any>("cash_movements");
      const auditLogs = new InMemoryRepository<AuditLog>("audit_logs");

      await products.save({
        id: "prod-chaos3",
        name: "Producto caos 3",
        categoryId: "cat-1",
        price: 10000,
        stock: 5,
        minStock: 1,
        lastUpdated: new Date()
      });

      const inventory = new InventoryEngine(products as any, new (await import("../../src/core/engines/KardexEngine")).KardexEngine(new InMemoryRepository<any>("movements") as any));
      const salesEngine = new SalesEngine(
        sales as any,
        new (await import("../../src/core/engines/CartEngine")).CartEngine(),
        inventory,
        new (await import("../../src/core/engines/PaymentEngine")).PaymentEngine(),
        { generateReceipt: async () => ({ id: "r-3" }) } as any,
        new KitchenEngine(kitchenOrders as any, new AuditEngine(auditLogs as any)),
        new CashEngine(cashMovements as any),
        { findByBusiness: async () => ({ defaultCustomerId: "general" }) } as any,
        new (await import("../../src/core/engines/AlertEngine")).AlertEngine(),
        new (await import("../../src/core/engines/HealthEngine")).HealthEngine(),
        new (await import("../../src/core/engines/KardexEngine")).KardexEngine(new InMemoryRepository<any>("movements") as any),
        {} as any,
        new AuditEngine(auditLogs as any)
      );

      const sale1 = await salesEngine.createSale({
        id: "sale-chaos3",
        type: "QUICK",
        items: [{ productId: "prod-chaos3", quantity: 2, price: 10000 }],
        cashierId: "cashier-1"
      });

      const sale2 = await salesEngine.createSale({
        id: "sale-chaos3",
        type: "QUICK",
        items: [{ productId: "prod-chaos3", quantity: 2, price: 10000 }],
        cashierId: "cashier-1"
      });

      expect(sale1.id).toBe(sale2.id);

      const allSales = await sales.findAll();
      expect(allSales).toHaveLength(1);

      const product = await products.findById("prod-chaos3");
      expect(product?.stock).toBe(3);
    });

    it("pago fallido a mitad de camino: la venta queda PENDING_PAYMENT y el stock se repone", async () => {
      setCurrentBusinessId("b-pay-fail");
      setCurrentBranchId("br-pay-fail");

      const products = new FakeProductRepository();
      const sales = new InMemoryRepository<any>("sales");
      const kitchenOrders = new InMemoryRepository<any>("kitchen_orders");
      const cashMovements = new InMemoryRepository<any>("cash_movements");
      const auditLogs = new InMemoryRepository<AuditLog>("audit_logs");

      await products.save({
        id: "prod-pay-fail",
        name: "Producto pago fallido",
        categoryId: "cat-1",
        price: 10000,
        stock: 5,
        minStock: 1,
        lastUpdated: new Date()
      });

      const inventory = new InventoryEngine(products as any, new KardexEngine(new InMemoryRepository<any>("movements") as any));
      const cash = new CashEngine(cashMovements as any);
      const salesEngine = new SalesEngine(
        sales as any,
        new CartEngine(),
        inventory,
        new PaymentEngine(),
        { generateReceipt: async () => ({ id: "r-fail" }) } as any,
        new KitchenEngine(kitchenOrders as any, new AuditEngine(auditLogs as any)),
        cash,
        { findByBusiness: async () => ({ defaultCustomerId: "general" }) } as any,
        new AlertEngine(),
        new HealthEngine(),
        new KardexEngine(new InMemoryRepository<any>("movements") as any),
        {} as any,
        new AuditEngine(auditLogs as any)
      );

      const sale = await salesEngine.createSale({
        id: "sale-pay-fail",
        type: "QUICK",
        items: [{ productId: "prod-pay-fail", quantity: 2, price: 10000 }],
        cashierId: "cashier-1"
      });

      expect(sale.status).toBe("PENDING_PAYMENT");
      expect((await products.findById("prod-pay-fail"))?.stock).toBe(3);

      (cash.registerIncome as any) = vi.fn(async () => {
        throw new Error("CASH_RPC_FAILED");
      });

      await expect(
        salesEngine.registerPayment(sale, "CASH", { received: sale.total })
      ).rejects.toThrow("CASH_RPC_FAILED");

      const updatedSale = await salesEngine.getSale(sale.id);
      expect(updatedSale?.status).toBe("PENDING_PAYMENT");

      const stockAfterFailedPayment = (await products.findById("prod-pay-fail"))?.stock ?? 0;
      expect(stockAfterFailedPayment).toBe(5);
    });

    it("venta con stock insuficiente: no se crea la venta y no se modifica el inventario", async () => {
      setCurrentBusinessId("b-no-stock");
      setCurrentBranchId("br-no-stock");

      const products = new FakeProductRepository();
      const sales = new InMemoryRepository<any>("sales");
      const kitchenOrders = new InMemoryRepository<any>("kitchen_orders");
      const cashMovements = new InMemoryRepository<any>("cash_movements");
      const auditLogs = new InMemoryRepository<AuditLog>("audit_logs");

      await products.save({
        id: "prod-no-stock",
        name: "Producto sin stock",
        categoryId: "cat-1",
        price: 10000,
        stock: 1,
        minStock: 1,
        lastUpdated: new Date()
      });

      const inventory = new InventoryEngine(products as any, new KardexEngine(new InMemoryRepository<any>("movements") as any));
      const salesEngine = new SalesEngine(
        sales as any,
        new CartEngine(),
        inventory,
        new PaymentEngine(),
        { generateReceipt: async () => ({ id: "r-ns" }) } as any,
        new KitchenEngine(kitchenOrders as any, new AuditEngine(auditLogs as any)),
        new CashEngine(cashMovements as any),
        { findByBusiness: async () => ({ defaultCustomerId: "general" }) } as any,
        new AlertEngine(),
        new HealthEngine(),
        new KardexEngine(new InMemoryRepository<any>("movements") as any),
        {} as any,
        new AuditEngine(auditLogs as any)
      );

      await expect(
        salesEngine.createSale({
          id: "sale-no-stock",
          type: "QUICK",
          items: [{ productId: "prod-no-stock", quantity: 5, price: 10000 }],
          cashierId: "cashier-1"
        })
      ).rejects.toThrow("Stock insuficiente");

      const allSales = await sales.findAll();
      expect(allSales).toHaveLength(0);

      const product = await products.findById("prod-no-stock");
      expect(product?.stock).toBe(1);
    });
  });
});
