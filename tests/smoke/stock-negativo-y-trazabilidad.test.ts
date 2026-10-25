// tests/smoke/stock-negativo-y-trazabilidad.test.ts
/* ===========================================================================
   SMOKE TEST — FASE H: errores y seguridad
   ---------------------------------------------------------------------------
   Dos reglas de negocio críticas:

   1. OPCIÓN B (decisión del dueño, 25 oct 2026): una VENTA nunca se bloquea
      por falta de stock. Si un producto o un ingrediente de receta no
      alcanza, la venta pasa, el stock baja y puede quedar en NEGATIVO; el
      Kardex guarda stockBefore/stockAfter para poder auditarlo, y el conteo
      físico es la cura. Ya no existe el switch "Vender aunque no quede stock".

      En cambio, lo MANUAL sigue estricto (un negativo ahí es un error de
      digitación, no una venta en hora pico):
        - decreaseStock() manual (ajuste de Inventario, ej. una merma)
        - produceBatch() (producir una tanda, ej. Pastel)

   2. Trazabilidad de Kardex (regla de oro #8 de la instrucción: "¿Quién
      cambió este inventario, cuándo y por qué?"): cada movimiento generado
      por un ajuste manual conserva quién lo hizo (`performedBy`) y el
      motivo (`reason`) tal cual se escribieron, sin normalizar ni perder
      el dato -- así el dueño puede auditar cualquier movimiento después.

   Nota: "eliminar un ingrediente usado en una receta" (el otro caso de
   Fase H que pedía la instrucción) YA tiene su propio smoke test completo:
   ver `tests/smoke/eliminar-ingrediente-usado.test.ts`. No se duplica aquí.
=========================================================================== */

import { describe, it, expect, beforeEach, afterEach } from "vitest";

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

import { companyConfigStore } from "../../src/core/store/companyConfigStore";

function buildEngines() {
  const products = new FakeProductRepository();
  const sales = new InMemoryRepository<Sale>("sales");
  const receipts = new InMemoryRepository("receipts");
  const kitchenOrders = new InMemoryRepository<KitchenOrder>("kitchen_orders");
  const cashMovements = new InMemoryRepository<CashMovement>("cash_movements");
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

describe("Fase H — Stock negativo (Opción B): la venta nunca se bloquea, lo manual sí es estricto", () => {
  let ctx: ReturnType<typeof buildEngines>;

  beforeEach(() => {
    ctx = buildEngines();
  });

  afterEach(() => {
    companyConfigStore.reset();
  });

  it("Ajuste manual (Inventario): NO deja bajar el stock de un producto por debajo de cero", async () => {
    const coca = await ctx.inventory.createProduct({
      name: "Coca-Cola", categoryId: "cat-bebidas", price: 4000, stock: 3, minStock: 6, trackStock: true
    });

    await expect(
      ctx.inventory.decreaseStock(coca.id, 5, "Merma: se rompieron 5 botellas", "yimid")
    ).rejects.toThrow(/INSUFFICIENT_STOCK/);

    const after = await ctx.products.findById(coca.id);
    expect(after!.stock).toBe(3); // nada se descontó
  });

  it("Venta: si no hay suficiente stock del producto, la venta pasa y el stock queda en negativo", async () => {
    const coca = await ctx.inventory.createProduct({
      name: "Coca-Cola", categoryId: "cat-bebidas", price: 4000, stock: 2, minStock: 6, trackStock: true
    });

    await expect(
      ctx.salesEngine.quickSale({ cashierId: "c1", source: [{ productId: coca.id, quantity: 5 }] })
    ).resolves.toBeDefined();

    const after = await ctx.products.findById(coca.id);
    expect(after!.stock).toBe(-3); // 2 - 5, a propósito
  });

  it("Venta: el Kardex deja constancia del stock antes/después cuando queda en negativo", async () => {
    const coca = await ctx.inventory.createProduct({
      name: "Coca-Cola", categoryId: "cat-bebidas", price: 4000, stock: 2, minStock: 6, trackStock: true
    });

    await ctx.salesEngine.quickSale({ cashierId: "c1", source: [{ productId: coca.id, quantity: 5 }] });

    const movements = await ctx.movements.findByProduct(coca.id);
    const sale = movements.find((m) => m.stockAfter === -3);
    expect(sale).toBeDefined();
    expect(sale!.stockBefore).toBe(2);
  });

  it("Venta: si falta un ingrediente de la receta (Café sin suficiente café molido), la venta pasa y el ingrediente queda en negativo", async () => {
    await ctx.products.save({
      id: "ing-cafe-molido", name: "Café molido", categoryId: "cat-insumos",
      price: 0, stock: 10, minStock: 0, active: true, favorite: false, trackStock: true
    } as Product);

    const cafe = await ctx.inventory.createProduct({
      name: "Café", categoryId: "cat-bebidas", price: 3000, stock: 0, minStock: 0,
      recipe: [{ productId: "ing-cafe-molido", quantity: 18 }],
      productionMode: "ON_DEMAND", trackStock: false
    });

    // 18g necesarios, solo hay 10g -- la venta NO se detiene.
    await expect(
      ctx.salesEngine.quickSale({ cashierId: "c1", source: [{ productId: cafe.id, quantity: 1 }] })
    ).resolves.toBeDefined();

    const molido = await ctx.products.findById("ing-cafe-molido");
    expect(molido!.stock).toBe(-8); // 10 - 18
  });

  it("Producir tanda (Pastel): sigue estricto -- se rechaza si no alcanzan los ingredientes", async () => {
    await ctx.products.save({
      id: "ing-harina", name: "Harina", categoryId: "cat-insumos",
      price: 0, stock: 500, minStock: 0, active: true, favorite: false, trackStock: true
    } as Product);

    const pastel = await ctx.inventory.createProduct({
      name: "Pastel", categoryId: "cat-panaderia", price: 35000, stock: 0, minStock: 2,
      recipe: [{ productId: "ing-harina", quantity: 300 }],
      productionMode: "BATCH", trackStock: true
    });

    // 2 pasteles = 600g de harina, solo hay 500g.
    await expect(ctx.inventory.produceBatch(pastel.id, 2, "yimid")).rejects.toThrow(/INSUFFICIENT_STOCK/);

    const harina = await ctx.products.findById("ing-harina");
    const pastelAfter = await ctx.products.findById(pastel.id);
    expect(harina!.stock).toBe(500); // nada se descontó
    expect(pastelAfter!.stock).toBe(0); // no se sumó ninguna unidad "fantasma"
  });
});

describe("Fase H — Trazabilidad de Kardex: 'quién cambió esto, cuándo y por qué'", () => {
  let ctx: ReturnType<typeof buildEngines>;

  beforeEach(() => {
    ctx = buildEngines();
  });

  it("increaseStock/decreaseStock guardan performedBy y reason tal cual, sin perder el dato", async () => {
    const queso = await ctx.inventory.createProduct({
      name: "Queso", categoryId: "cat-insumos", price: 0, stock: 20, minStock: 5, trackStock: true, unit: "kg"
    });

    await ctx.inventory.increaseStock(queso.id, 10, "Compra a Lácteos del Valle", "yimid");
    await ctx.inventory.decreaseStock(queso.id, 3, "Merma: queso vencido", "maria");

    const movimientos = await ctx.movements.findByProduct(queso.id);
    // createProduct con stock inicial > 0 ya genera un tercer movimiento
    // ("Stock inicial") -- son 3 en total, no 2.
    expect(movimientos.length).toBe(3);

    const compra = movimientos.find((m) => m.reason === "Compra a Lácteos del Valle");
    const merma = movimientos.find((m) => m.reason === "Merma: queso vencido");

    expect(compra?.performedBy).toBe("yimid");
    expect(compra?.reason).toBe("Compra a Lácteos del Valle");
    expect(compra?.date).toBeInstanceOf(Date);

    expect(merma?.performedBy).toBe("maria");
    expect(merma?.reason).toBe("Merma: queso vencido");

    // Cada movimiento conserva su propio id -- ninguno pisa al otro.
    expect(compra?.id).not.toBe(merma?.id);
  });

  it("Cada movimiento guarda el nombre del producto EN ESE MOMENTO, aunque después se renombre", async () => {
    const producto = await ctx.inventory.createProduct({
      name: "Pan Francés", categoryId: "cat-panaderia", price: 2000, stock: 10, minStock: 2, trackStock: true
    });

    await ctx.inventory.increaseStock(producto.id, 5, "Producción del día", "yimid");
    await ctx.inventory.updateProduct(producto.id, {
      name: "Baguette", categoryId: "cat-panaderia", price: 2000, stock: 10, minStock: 2
    });
    await ctx.inventory.increaseStock(producto.id, 5, "Segunda tanda", "yimid");

    const movimientos = await ctx.movements.findByProduct(producto.id);
    const primero = movimientos.find((m) => m.reason === "Producción del día");
    const segundo = movimientos.find((m) => m.reason === "Segunda tanda");

    expect(primero?.productName).toBe("Pan Francés");
    expect(segundo?.productName).toBe("Baguette");
  });
});