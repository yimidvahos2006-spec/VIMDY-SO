// tests/unit/customerPosHistory.test.ts
/* ===========================================================================
   Módulo de Clientes conectado con Caja — creación, búsqueda e impacto en el
   historial de compras.

   Usa los engines reales (SalesEngine + CustomerEngine + CashEngine) con
   repositorios en memoria, sin tocar Supabase.

     A. Creación       -> alta, auditoría, lectura del perfil
     B. Búsqueda       -> nombre / teléfono / correo
     C. Cobro en Caja  -> historial, totales, favoritos y puntos del cliente
     D. Aislamiento    -> mostrador, clientes distintos, ventas sin cobrar
     E. Segundo plano  -> evento "customer", reintento por conflicto, reembolso
=========================================================================== */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Customer, KitchenOrder, Product, Sale } from "../../src/core/entities/Entities";
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
import { OptimisticLockError } from "../../src/core/errors/OptimisticLockError";
import { vimdyCore } from "../../src/core/VimdyCore";

import { InMemoryRepository } from "../fakes/InMemoryRepository";
import { FakeProductRepository } from "../fakes/FakeProductRepository";
import { FakeSaleRepository } from "../fakes/FakeSaleRepository";
import { FakeCashMovementRepository } from "../fakes/FakeCashMovementRepository";

const BURGER: Product = {
  id: "prod-burger",
  name: "Hamburguesa Clásica",
  categoryId: "cat-comidas",
  price: 20_000,
  stock: 100,
  minStock: 2,
  lastUpdated: new Date()
};

const SODA: Product = {
  id: "prod-soda",
  name: "Gaseosa",
  categoryId: "cat-bebidas",
  price: 5_000,
  stock: 100,
  minStock: 2,
  lastUpdated: new Date()
};

function buildContext() {
  const products = new FakeProductRepository();
  const sales = new FakeSaleRepository();
  const receipts = new InMemoryRepository("receipts");
  const kitchenOrders = new InMemoryRepository<KitchenOrder>("kitchen_orders");
  const cashMovements = new FakeCashMovementRepository(sales as any, products);
  const customers = new InMemoryRepository<Customer>("customers");
  const movements = new InMemoryRepository("inventory_movements");
  const auditLogs = new InMemoryRepository("audit_logs");

  const audit = new AuditEngine(auditLogs as any);
  const kardex = new KardexEngine(movements as any);
  const inventory = new InventoryEngine(products, kardex);
  const cart = new CartEngine();
  const customerEngine = new CustomerEngine(customers, sales as any, audit);

  const salesEngine = new SalesEngine(
    sales as any,
    cart,
    inventory,
    new PaymentEngine(),
    new ReceiptEngine(receipts as any),
    new KitchenEngine(kitchenOrders, audit),
    new CashEngine(cashMovements),
    customerEngine,
    new AlertEngine(),
    new HealthEngine(),
    kardex,
    {} as PosCore,
    audit
  );

  return { products, sales, customers, auditLogs, cart, customerEngine, salesEngine };
}

type Context = ReturnType<typeof buildContext>;

function makeCustomer(overrides: Partial<Customer> = {}): Customer {
  return {
    id: "cust-ana",
    name: "Ana Gómez",
    phone: "3001112222",
    email: "ana@example.com",
    notes: "Sin cebolla. Mesa junto a la ventana.",
    points: 0,
    businessId: "biz-1",
    createdAt: new Date("2026-09-01T00:00:00Z"),
    ...overrides
  };
}

/** Arma el carrito, crea la venta y la cobra en efectivo, como hace Caja. */
async function chargeInCash(
  ctx: Context,
  lines: { product: Product; quantity: number }[],
  customerId?: string
): Promise<Sale> {
  for (const line of lines) ctx.cart.addItem(line.product, line.quantity);
  const sale = await ctx.salesEngine.quickSale({ cashierId: "cashier-1", customerId });
  const { sale: paid } = await ctx.salesEngine.registerPayment(sale, "CASH");
  return paid;
}

describe("Clientes ↔ Caja", () => {
  let ctx: Context;

  beforeEach(async () => {
    ctx = buildContext();
    await ctx.products.save(BURGER);
    await ctx.products.save(SODA);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  /* ------------------------------------------------------------- creación */

  describe("A. creación", () => {
    it("crea el cliente, lo audita y queda disponible con su perfil vacío", async () => {
      await ctx.customerEngine.save(makeCustomer());

      const stored = await ctx.customers.findById("cust-ana");
      expect(stored?.name).toBe("Ana Gómez");
      expect(stored?.notes).toBe("Sin cebolla. Mesa junto a la ventana.");

      const logs = await ctx.auditLogs.findAll();
      expect((logs as any[]).map((log) => log.action)).toContain("CUSTOMER_CREATED");

      const profile = await ctx.customerEngine.getCustomerProfile("cust-ana");
      expect(profile.sales).toEqual([]);
      expect(profile.ltv).toBe(0);
      expect(profile.vip.visitCount).toBe(0);
      expect(profile.vip.totalSpent).toBe(0);
      expect(profile.vip.favorites).toEqual([]);
    });

    it("pedir el perfil de un cliente inexistente falla con CUSTOMER_NOT_FOUND", async () => {
      await expect(ctx.customerEngine.getCustomerProfile("no-existe")).rejects.toThrow("CUSTOMER_NOT_FOUND");
    });
  });

  /* -------------------------------------------------------------- búsqueda */

  describe("B. búsqueda", () => {
    beforeEach(async () => {
      await ctx.customerEngine.save(makeCustomer());
      await ctx.customerEngine.save(
        makeCustomer({ id: "cust-luis", name: "Luis Pérez", phone: "3109998888", email: "luis@correo.co" })
      );
    });

    it("encuentra por nombre sin importar mayúsculas", async () => {
      const found = await ctx.customerEngine.search("ANA");
      expect(found.map((c) => c.id)).toEqual(["cust-ana"]);
    });

    it("encuentra por teléfono y por correo", async () => {
      expect((await ctx.customerEngine.search("310999")).map((c) => c.id)).toEqual(["cust-luis"]);
      expect((await ctx.customerEngine.search("luis@correo")).map((c) => c.id)).toEqual(["cust-luis"]);
    });

    it("búsqueda vacía o sin coincidencias devuelve lista vacía", async () => {
      expect(await ctx.customerEngine.search("   ")).toEqual([]);
      expect(await ctx.customerEngine.search("zzz")).toEqual([]);
    });

    it("respeta el límite de resultados", async () => {
      expect(await ctx.customerEngine.search("3", 1)).toHaveLength(1);
    });
  });

  /* ----------------------------------------------------------- cobro en Caja */

  describe("C. cobro en Caja con cliente asociado", () => {
    beforeEach(async () => {
      await ctx.customerEngine.save(makeCustomer());
    });

    it("la venta cobrada aparece en el historial y en los totales del cliente", async () => {
      const paid = await chargeInCash(ctx, [{ product: BURGER, quantity: 2 }], "cust-ana");

      const profile = await ctx.customerEngine.getCustomerProfile("cust-ana");

      expect(profile.sales.map((sale) => sale.id)).toEqual([paid.id]);
      expect(profile.ltv).toBe(paid.total);
      expect(profile.vip.totalSpent).toBe(paid.total);
      expect(profile.vip.visitCount).toBe(1);
      expect(profile.vip.averageTicket).toBe(paid.total);
      expect(profile.vip.lastVisitAt).not.toBeNull();
    });

    it("suma visitas y gasto en cada nueva compra y arma los favoritos", async () => {
      const first = await chargeInCash(ctx, [{ product: BURGER, quantity: 2 }, { product: SODA, quantity: 1 }], "cust-ana");
      const second = await chargeInCash(ctx, [{ product: BURGER, quantity: 1 }], "cust-ana");

      const { vip } = await ctx.customerEngine.getCustomerProfile("cust-ana");

      expect(vip.visitCount).toBe(2);
      expect(vip.totalSpent).toBe(first.total + second.total);
      expect(vip.favorites[0]).toEqual({ productId: BURGER.id, units: 3, visits: 2 });
      expect(vip.favorites[1]).toEqual({ productId: SODA.id, units: 1, visits: 1 });
    });

    it("el cobro suma los puntos al cliente (1 por cada $1.000) y conserva sus notas", async () => {
      const paid = await chargeInCash(ctx, [{ product: BURGER, quantity: 2 }], "cust-ana");

      const customer = await ctx.customers.findById("cust-ana");
      expect(customer?.points).toBe(Math.floor(paid.total * 0.001));
      expect(customer?.notes).toBe("Sin cebolla. Mesa junto a la ventana.");
    });

    it("los puntos se acumulan entre compras", async () => {
      const first = await chargeInCash(ctx, [{ product: BURGER, quantity: 3 }], "cust-ana");
      const second = await chargeInCash(ctx, [{ product: BURGER, quantity: 2 }], "cust-ana");

      const customer = await ctx.customers.findById("cust-ana");
      expect(customer?.points).toBe(
        Math.floor(first.total * 0.001) + Math.floor(second.total * 0.001)
      );
    });
  });

  /* ------------------------------------------------------------ aislamiento */

  describe("D. lo que NO debe afectar el historial", () => {
    beforeEach(async () => {
      await ctx.customerEngine.save(makeCustomer());
      await ctx.customerEngine.save(makeCustomer({ id: "cust-luis", name: "Luis Pérez", phone: "3109998888" }));
    });

    it("dos clientes no mezclan sus compras", async () => {
      const anaSale = await chargeInCash(ctx, [{ product: BURGER, quantity: 1 }], "cust-ana");
      const luisSale = await chargeInCash(ctx, [{ product: SODA, quantity: 2 }], "cust-luis");

      const ana = await ctx.customerEngine.getCustomerProfile("cust-ana");
      const luis = await ctx.customerEngine.getCustomerProfile("cust-luis");

      expect(ana.sales.map((s) => s.id)).toEqual([anaSale.id]);
      expect(luis.sales.map((s) => s.id)).toEqual([luisSale.id]);
      expect(ana.vip.favorites.map((f) => f.productId)).toEqual([BURGER.id]);
      expect(luis.vip.favorites.map((f) => f.productId)).toEqual([SODA.id]);
    });

    it("una venta sin cliente no toca a ningún cliente registrado", async () => {
      await chargeInCash(ctx, [{ product: BURGER, quantity: 1 }]);

      const ana = await ctx.customers.findById("cust-ana");
      expect(ana?.points).toBe(0);
      expect((await ctx.customerEngine.getCustomerProfile("cust-ana")).vip.visitCount).toBe(0);
    });

    it("el cliente de mostrador no acumula puntos ni dispara eventos", async () => {
      const listener = vi.fn();
      const off = vimdyCore.on("customer", listener);

      await chargeInCash(ctx, [{ product: BURGER, quantity: 1 }], "CLIENTE_GENERAL");
      off();

      expect(listener).not.toHaveBeenCalled();
    });

    it("una venta creada pero NO cobrada no cuenta como visita ni da puntos", async () => {
      ctx.cart.addItem(BURGER, 2);
      await ctx.salesEngine.quickSale({ cashierId: "cashier-1", customerId: "cust-ana" });

      const profile = await ctx.customerEngine.getCustomerProfile("cust-ana");
      expect(profile.sales).toHaveLength(1); // aparece en el historial crudo…
      expect(profile.vip.visitCount).toBe(0); // …pero no es una visita
      expect(profile.vip.totalSpent).toBe(0);
      expect(profile.ltv).toBe(0);
      expect((await ctx.customers.findById("cust-ana"))?.points).toBe(0);
    });

    it("cobrar a un cliente que ya fue eliminado no rompe el cobro", async () => {
      ctx.cart.addItem(BURGER, 1);
      const sale = await ctx.salesEngine.quickSale({ cashierId: "cashier-1", customerId: "cust-ana" });
      await ctx.customerEngine.delete("cust-ana");

      const { sale: paid } = await ctx.salesEngine.registerPayment(sale, "CASH");

      expect(paid.status).toBe("PAID");
    });
  });

  /* ----------------------------------------------------------- segundo plano */

  describe("E. actualización automática en segundo plano", () => {
    beforeEach(async () => {
      await ctx.customerEngine.save(makeCustomer());
    });

    it("al cobrar se emite el evento 'customer' para que las pantallas se refresquen solas", async () => {
      const listener = vi.fn();
      const off = vimdyCore.on("customer", listener);

      const paid = await chargeInCash(ctx, [{ product: BURGER, quantity: 1 }], "cust-ana");
      off();

      expect(listener).toHaveBeenCalledTimes(1);
      expect(listener).toHaveBeenCalledWith(
        expect.objectContaining({
          action: "customer.purchase_recorded",
          customerId: "cust-ana",
          saleId: paid.id
        })
      );
    });

    it("el evento se emite aunque la venta sea tan pequeña que no gane puntos", async () => {
      const tiny: Product = { ...SODA, id: "prod-tiny", price: 500 };
      await ctx.products.save(tiny);
      const listener = vi.fn();
      const off = vimdyCore.on("customer", listener);

      await chargeInCash(ctx, [{ product: tiny, quantity: 1 }], "cust-ana");
      off();

      expect(listener).toHaveBeenCalledTimes(1);
      expect((await ctx.customers.findById("cust-ana"))?.points).toBe(0);
      expect((await ctx.customerEngine.getCustomerProfile("cust-ana")).vip.visitCount).toBe(1);
    });

    it("si otra caja guardó al cliente justo antes, reintenta y no pierde los puntos", async () => {
      const realUpdate = ctx.customers.update.bind(ctx.customers);
      const updateSpy = vi
        .spyOn(ctx.customers, "update")
        .mockImplementationOnce(async () => {
          throw new OptimisticLockError("Customer", "cust-ana");
        })
        .mockImplementation(realUpdate);

      await ctx.customerEngine.recordPurchase("cust-ana", {} as Sale, 40);

      expect(updateSpy).toHaveBeenCalledTimes(2);
      expect((await ctx.customers.findById("cust-ana"))?.points).toBe(40);
    });

    it("un error que no es de concurrencia no se traga: sube para que se registre", async () => {
      vi.spyOn(ctx.customers, "update").mockRejectedValue(new Error("DB_DOWN"));

      await expect(ctx.customerEngine.recordPurchase("cust-ana", {} as Sale, 40)).rejects.toThrow("DB_DOWN");
    });

    it("si registrar el cliente falla, el cobro igual queda PAID", async () => {
      ctx.cart.addItem(BURGER, 1);
      const sale = await ctx.salesEngine.quickSale({ cashierId: "cashier-1", customerId: "cust-ana" });
      vi.spyOn(ctx.customers, "update").mockRejectedValue(new Error("DB_DOWN"));

      const { sale: paid } = await ctx.salesEngine.registerPayment(sale, "CASH");

      expect(paid.status).toBe("PAID");
      expect((await ctx.customerEngine.getCustomerProfile("cust-ana")).vip.visitCount).toBe(1);
    });

    it("recordPurchase ignora ids vacíos y de mostrador", async () => {
      expect(await ctx.customerEngine.recordPurchase("", {} as Sale, 10)).toBe(false);
      expect(await ctx.customerEngine.recordPurchase(undefined, {} as Sale, 10)).toBe(false);
      expect(await ctx.customerEngine.recordPurchase("CLIENTE_GENERAL", {} as Sale, 10)).toBe(false);
      expect(await ctx.customerEngine.recordPurchase("no-existe", {} as Sale, 10)).toBe(false);
    });

    it("un reembolso parcial baja el gasto y los favoritos del cliente", async () => {
      const paid = await chargeInCash(ctx, [{ product: BURGER, quantity: 2 }, { product: SODA, quantity: 1 }], "cust-ana");

      // El monto reembolsado incluye el IVA de la línea, por eso se toma del
      // resultado del reembolso y no de SODA.price.
      const { amount } = await ctx.salesEngine.partialRefundSale(
        paid.id,
        [{ productId: SODA.id, quantity: 1 }],
        "No le gustó"
      );
      expect(amount).toBeGreaterThanOrEqual(SODA.price);

      const { vip, ltv } = await ctx.customerEngine.getCustomerProfile("cust-ana");
      expect(vip.visitCount).toBe(1);
      expect(vip.totalSpent).toBe(paid.total - amount);
      expect(ltv).toBe(vip.totalSpent);
      expect(vip.favorites.map((f) => f.productId)).toEqual([BURGER.id]);
    });
  });
});