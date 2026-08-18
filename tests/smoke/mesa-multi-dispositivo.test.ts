// tests/smoke/mesa-multi-dispositivo.test.ts
/* ===========================================================================
   SMOKE TEST — Cuenta de mesa centralizada (base #3 del checklist)
   ---------------------------------------------------------------------------
   Antes, TableEngine guardaba el pedido en curso de cada mesa en un Map en
   memoria (`carts`), privado de esa instancia del motor. En producción cada
   dispositivo (el celular de un mesero, la tablet de otro, el computador de
   Caja) corre SU PROPIA instancia de TableEngine — así que un dispositivo
   que no hubiera llamado openTable() localmente no podía ver, agregar,
   quitar ni cobrar los productos de una mesa que otro dispositivo ya tenía
   abierta. Este test simula exactamente eso: dos instancias de TableEngine
   independientes, apuntando al MISMO repositorio (la misma "base de datos"),
   como pasaría con dos dispositivos reales contra el mismo negocio.

   Si esto se rompe, un mesero puede tomar el pedido en su celular y el
   cajero, en el mostrador, no podría cobrarlo — o dos meseros atendiendo la
   misma mesa se pisarían el pedido el uno al otro.
=========================================================================== */

import { describe, it, expect, beforeEach } from "vitest";

import { Product, Sale, Table, CashMovement, KitchenOrder, Order } from "../../src/core/entities/Entities";

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
import { TableEngine } from "../../src/core/engines/TableEngine";
import { OrderEngine } from "../../src/core/engines/OrderEngine";
import { PosCore } from "../../src/core/engines/PosCore";

import { InMemoryRepository } from "../fakes/InMemoryRepository";
import { FakeProductRepository } from "../fakes/FakeProductRepository";

const BURGER: Product = {
  id: "prod-burger",
  name: "Hamburguesa Clásica",
  categoryId: "cat-comidas",
  price: 18000,
  stock: 20,
  minStock: 2,
  lastUpdated: new Date(),
  requiresKitchen: true
};

const SODA: Product = {
  id: "prod-soda",
  name: "Gaseosa embotellada 400ml",
  categoryId: "cat-bebidas",
  price: 4000,
  stock: 50,
  minStock: 5,
  lastUpdated: new Date(),
  requiresKitchen: false
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
  const orders = new InMemoryRepository<Order>("orders");

  // Una sola fila de mesas "en el servidor" — ambos dispositivos apuntan
  // al MISMO repositorio, tal como ambos apuntarían al mismo Supabase.
  const tables = new InMemoryRepository<Table>("tables");

  const kardex = new KardexEngine(movements as any);
  const inventory = new InventoryEngine(products, kardex);
  const kitchen = new KitchenEngine(kitchenOrders, new AuditEngine(auditLogs as any));
  const cash = new CashEngine(cashMovements);
  const audit = new AuditEngine(auditLogs as any);

  const salesEngine = new SalesEngine(
    sales as any,
    new CartEngine(),
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

  // Dos instancias INDEPENDIENTES de TableEngine — cada una representa el
  // TableEngine que corre en un dispositivo distinto. Nada se comparte
  // entre ellas salvo `tables` (el repositorio), exactamente como en
  // producción nada se comparte entre dos navegadores salvo Supabase.
  const orderEngine = new OrderEngine(orders as never, kitchen, salesEngine);
  const deviceMesero = new TableEngine(tables, kitchen, salesEngine, orderEngine);
  const deviceCaja = new TableEngine(tables, kitchen, salesEngine, orderEngine);

  return { deviceMesero, deviceCaja, products, tables, kitchenOrders, cashMovements, orders };
}

describe("Smoke: la cuenta de mesa es la misma para cualquier dispositivo", () => {
  let ctx: ReturnType<typeof buildContext>;

  beforeEach(async () => {
    ctx = buildContext();
    await ctx.products.save(BURGER);
    await ctx.products.save(SODA);
    await ctx.tables.save({
      id: "table-1",
      name: "Mesa 1",
      capacity: 4,
      peopleCount: 0,
      status: "FREE",
      items: [],
      subtotal: 0,
      tax: 0,
      discount: 0,
      total: 0,
      updatedAt: new Date()
    } as Table);
  });

  it("el mesero abre y toma el pedido en su dispositivo; la caja lo ve y lo cobra en el suyo, sin haber abierto la mesa ella misma", async () => {
    // El mesero abre la mesa y agrega productos DESDE SU dispositivo.
    await ctx.deviceMesero.openTable({ tableId: "table-1", peopleCount: 3, waiterId: "waiter-1" });
    await ctx.deviceMesero.addItem({ tableId: "table-1", product: BURGER, quantity: 2 });

    // La caja NUNCA llamó openTable() en su propia instancia — antes esto
    // lanzaba TABLE_NOT_OPEN porque su Map en memoria estaba vacío para
    // esta mesa. Ahora simplemente lee la fila real.
    const seenFromCaja = await ctx.deviceCaja.getTable("table-1");
    expect(seenFromCaja.items).toHaveLength(1);
    expect(seenFromCaja.items[0].productId).toBe(BURGER.id);
    expect(seenFromCaja.status).toBe("BUSY");

    // La caja incluso puede seguir agregando productos sobre la MISMA
    // cuenta (ej. el cliente pide algo más justo antes de pagar).
    await ctx.deviceCaja.addItem({ tableId: "table-1", product: SODA, quantity: 2 });

    // El mesero, desde su dispositivo, ve el producto que agregó la caja.
    const seenFromMesero = await ctx.deviceMesero.getTable("table-1");
    expect(seenFromMesero.items).toHaveLength(2);

    // El mesero envía a cocina — solo la hamburguesa, no la gaseosa.
    await ctx.deviceMesero.sendToKitchen("table-1");
    const kitchenOrders = await ctx.kitchenOrders.findAll();
    expect(kitchenOrders).toHaveLength(1);
    expect(kitchenOrders[0].items).toHaveLength(1);
    expect(kitchenOrders[0].items[0].productId).toBe(BURGER.id);

    // La caja cobra la mesa DESDE SU dispositivo — nunca la abrió ni tomó
    // el pedido, pero ve exactamente la misma cuenta y puede cerrarla.
    // 2 hamburguesas (18000) + 2 gaseosas (4000) = 44000 + IVA 19% ≈ 52360.
    const { sale, payment } = await ctx.deviceCaja.closeTable({
      tableId: "table-1",
      method: "CASH",
      cashierId: "cashier-1",
      received: 60000
    });

    expect(payment.success).toBe(true);
    // 2 hamburguesas (18000) + 2 gaseosas (4000) = 44000 + IVA 19%.
    expect(sale.items).toHaveLength(2);
    expect(sale.total).toBeCloseTo(44000 * 1.19, 0);

    // La mesa vuelve a quedar libre para cualquiera de los dos dispositivos.
    const afterClose = await ctx.deviceMesero.getTable("table-1");
    expect(afterClose.status).toBe("FREE");
    expect(afterClose.items).toHaveLength(0);
  });

  it("dos dispositivos agregando productos casi al mismo tiempo no se pisan el pedido (choque de versión resuelto solo)", async () => {
    await ctx.deviceMesero.openTable({ tableId: "table-1", peopleCount: 2, waiterId: "waiter-1" });

    // Ambos dispositivos parten de la MISMA versión de la mesa (ya abierta)
    // y agregan un producto distinto "casi al mismo tiempo": el segundo
    // update choca en versión contra el primero y debe reintentarse solo,
    // reaplicando su cambio encima de la versión más reciente, en vez de
    // perder el producto o lanzarle un error al usuario.
    await Promise.all([
      ctx.deviceMesero.addItem({ tableId: "table-1", product: BURGER, quantity: 1 }),
      ctx.deviceCaja.addItem({ tableId: "table-1", product: SODA, quantity: 1 })
    ]);

    const table = await ctx.tables.findById("table-1");
    expect(table?.items).toHaveLength(2);

    const productIds = table!.items.map(item => item.productId).sort();
    expect(productIds).toEqual([BURGER.id, SODA.id].sort());
  });
});
