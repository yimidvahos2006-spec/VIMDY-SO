// tests/smoke/auditoria-cocina-barra-sin-preparacion.test.ts
/* ===========================================================================
   AUDITORÍA FUNCIONAL — Cocina / Barra / Sin preparación
   ---------------------------------------------------------------------------
   Verifica que la separación por Product.requiresKitchen / Product.trackStock
   / Product.recipe funcione correctamente en Caja y Mesas/Meseros.

   Escenarios:
     1. Producto de cocina SIN receta (trackStock=false, requiresKitchen=true)
     2. Producto SIN preparación / servicio (trackStock=false, requiresKitchen=false)
     3. Producto de cocina CON receta ON_DEMAND
     4. Producto de cocina CON receta BATCH
     5. Producto de inventario normal
     6. Venta mixta en Caja (POS): cocina + sin cocina
     7. Venta mixta en Mesas: cocina + sin cocina
     8. Producto sin preparación NUNCA aparece en Cocina
     9. Descuento de inventario correcto según tipo de producto
    10. Stock se respeta para productos trackStock=true
   =========================================================================== */

import { describe, it, expect, beforeEach } from "vitest";

import {
  Product,
  Sale,
  Table,
  CashMovement,
  KitchenOrder,
  Order,
  RecipeItem,
  Customer
} from "../../src/core/entities/Entities";

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

// ---------------------------------------------------------------------------
// Productos de prueba
// ---------------------------------------------------------------------------

const COCINA_SIN_RECETA: Product = {
  id: "prod-cocina-sin-receta",
  name: "Caldo de Costilla",
  categoryId: "cat-comidas",
  price: 15000,
  stock: 0,
  minStock: 0,
  lastUpdated: new Date(),
  requiresKitchen: true,
  trackStock: false
};

const SERVICIO_SIN_PREPARACION: Product = {
  id: "prod-servicio",
  name: "Cover / Servicio",
  categoryId: "cat-servicios",
  price: 5000,
  stock: 0,
  minStock: 0,
  lastUpdated: new Date(),
  requiresKitchen: false,
  trackStock: false
};

const COCINA_CON_RECETA_ONDEMAND: Product = {
  id: "prod-receta-ondemand",
  name: "Hamburguesa Casera",
  categoryId: "cat-comidas",
  price: 18000,
  stock: 0,
  minStock: 0,
  lastUpdated: new Date(),
  requiresKitchen: true,
  trackStock: false,
  recipe: [
    { productId: "ing-carne", quantity: 1 },
    { productId: "ing-pan", quantity: 1 }
  ] as RecipeItem[],
  productionMode: "ON_DEMAND"
};

const COCINA_CON_RECETA_BATCH: Product = {
  id: "prod-receta-batch",
  name: "Pan de la casa",
  categoryId: "cat-comidas",
  price: 8000,
  stock: 10,
  minStock: 2,
  lastUpdated: new Date(),
  requiresKitchen: true,
  trackStock: true,
  recipe: [
    { productId: "ing-harina", quantity: 2 },
    { productId: "ing-levadura", quantity: 0.5 }
  ] as RecipeItem[],
  productionMode: "BATCH"
};

const INVENTARIO_NORMAL: Product = {
  id: "prod-inventario",
  name: "Gaseosa 400ml",
  categoryId: "cat-bebidas",
  price: 4000,
  stock: 20,
  minStock: 5,
  lastUpdated: new Date(),
  requiresKitchen: false,
  trackStock: true
};

const INGREDIENTE_CARNE: Product = {
  id: "ing-carne",
  name: "Carne molida",
  categoryId: "cat-ingredientes",
  price: 5000,
  stock: 100,
  minStock: 10,
  lastUpdated: new Date(),
  requiresKitchen: false,
  trackStock: true,
  isIngredient: true
};

const INGREDIENTE_PAN: Product = {
  id: "ing-pan",
  name: "Pan hamburguesa",
  categoryId: "cat-ingredientes",
  price: 2000,
  stock: 100,
  minStock: 10,
  lastUpdated: new Date(),
  requiresKitchen: false,
  trackStock: true,
  isIngredient: true
};

const INGREDIENTE_HARINA: Product = {
  id: "ing-harina",
  name: "Harina",
  categoryId: "cat-ingredientes",
  price: 1500,
  stock: 50,
  minStock: 5,
  lastUpdated: new Date(),
  requiresKitchen: false,
  trackStock: true,
  isIngredient: true
};

const INGREDIENTE_LEVADURA: Product = {
  id: "ing-levadura",
  name: "Levadura",
  categoryId: "cat-ingredientes",
  price: 1000,
  stock: 20,
  minStock: 2,
  lastUpdated: new Date(),
  requiresKitchen: false,
  trackStock: true,
  isIngredient: true
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildContext() {
  const products = new FakeProductRepository();
  const sales = new InMemoryRepository<Sale>("sales");
  const receipts = new InMemoryRepository("receipts");
  const kitchenOrders = new InMemoryRepository<KitchenOrder>("kitchen_orders");
  const cashMovements = new InMemoryRepository<CashMovement>("cash_movements");
  const customers = new InMemoryRepository<Customer>("customers");
  const movements = new InMemoryRepository("inventory_movements");
  const auditLogs = new InMemoryRepository("audit_logs");
  const orders = new InMemoryRepository<Order>("orders");
  const tables = new InMemoryRepository<Table>("tables");

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

  const orderEngine = new OrderEngine(orders as never, kitchen, salesEngine);
  const tableEngine = new TableEngine(tables as any, kitchen, salesEngine, orderEngine);

  return {
    salesEngine,
    tableEngine,
    products,
    cart,
    kitchenOrders,
    tables,
    inventory,
    orders
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("Auditoría funcional: Cocina / Barra / Sin preparación", () => {
  let ctx: ReturnType<typeof buildContext>;

  beforeEach(async () => {
    ctx = buildContext();

    // Guardar todos los productos e ingredientes
    await ctx.products.save(COCINA_SIN_RECETA);
    await ctx.products.save(SERVICIO_SIN_PREPARACION);
    await ctx.products.save(COCINA_CON_RECETA_ONDEMAND);
    await ctx.products.save(COCINA_CON_RECETA_BATCH);
    await ctx.products.save(INVENTARIO_NORMAL);
    await ctx.products.save(INGREDIENTE_CARNE);
    await ctx.products.save(INGREDIENTE_PAN);
    await ctx.products.save(INGREDIENTE_HARINA);
    await ctx.products.save(INGREDIENTE_LEVADURA);
  });

  // =========================================================================
  // 1. Producto de cocina SIN receta (trackStock=false, requiresKitchen=true)
  // =========================================================================
  describe("1. Cocina sin receta", () => {
    it("se puede vender en Caja (POS) aunque tenga stock=0", async () => {
      ctx.cart.addItem(COCINA_SIN_RECETA, 1);
      const sale = await ctx.salesEngine.quickSale({ cashierId: "cashier-1" });
      expect(sale).toBeDefined();
      expect(sale.items).toHaveLength(1);
      expect(sale.items[0].productId).toBe(COCINA_SIN_RECETA.id);
    });

    it("se puede vender en Mesas aunque tenga stock=0", async () => {
      const table = await ctx.tables.save({
        id: "table-cocina-sin-receta",
        name: "Mesa Cocina",
        capacity: 4,
        peopleCount: 0,
        status: "FREE",
        items: [],
        subtotal: 0,
        tax: 0,
        discount: 0,
        total: 0,
        updatedAt: new Date()
      } as Table).then(() => ctx.tables.findById("table-cocina-sin-receta"));
      expect(table).not.toBeNull();

      await ctx.tableEngine.openTable({ tableId: "table-cocina-sin-receta", peopleCount: 2, waiterId: "waiter-1" });
      await ctx.tableEngine.addItem({ tableId: "table-cocina-sin-receta", product: COCINA_SIN_RECETA, quantity: 1 });

      const updatedTable = await ctx.tableEngine.getTable("table-cocina-sin-receta");
      expect(updatedTable.items).toHaveLength(1);
      expect(updatedTable.items[0].productId).toBe(COCINA_SIN_RECETA.id);
    });

    it("aparece en Cocina cuando se envía el pedido", async () => {
      ctx.cart.addItem(COCINA_SIN_RECETA, 1);
      await ctx.salesEngine.quickSale({ cashierId: "cashier-1" });

      const kitchenOrders = await ctx.kitchenOrders.findAll();
      expect(kitchenOrders).toHaveLength(1);
      expect(kitchenOrders[0].items).toHaveLength(1);
      expect(kitchenOrders[0].items[0].productId).toBe(COCINA_SIN_RECETA.id);
    });

    it("NO descuenta stock propio (trackStock=false)", async () => {
      ctx.cart.addItem(COCINA_SIN_RECETA, 1);
      await ctx.salesEngine.quickSale({ cashierId: "cashier-1" });

      const product = await ctx.products.findById(COCINA_SIN_RECETA.id);
      expect(product?.stock).toBe(0); // sigue en 0
    });
  });

  // =========================================================================
  // 2. Producto SIN preparación / servicio (trackStock=false, requiresKitchen=false)
  // =========================================================================
  describe("2. Servicio sin preparación", () => {
    it("se puede vender en Caja (POS)", async () => {
      ctx.cart.addItem(SERVICIO_SIN_PREPARACION, 1);
      const sale = await ctx.salesEngine.quickSale({ cashierId: "cashier-1" });
      expect(sale).toBeDefined();
      expect(sale.items).toHaveLength(1);
      expect(sale.items[0].productId).toBe(SERVICIO_SIN_PREPARACION.id);
    });

    it("se puede vender en Mesas", async () => {
      const table = await ctx.tables.save({
        id: "table-servicio",
        name: "Mesa Servicio",
        capacity: 4,
        peopleCount: 0,
        status: "FREE",
        items: [],
        subtotal: 0,
        tax: 0,
        discount: 0,
        total: 0,
        updatedAt: new Date()
      } as Table).then(() => ctx.tables.findById("table-servicio"));
      expect(table).not.toBeNull();

      await ctx.tableEngine.openTable({ tableId: "table-servicio", peopleCount: 2, waiterId: "waiter-1" });
      await ctx.tableEngine.addItem({ tableId: "table-servicio", product: SERVICIO_SIN_PREPARACION, quantity: 1 });

      const updatedTable = await ctx.tableEngine.getTable("table-servicio");
      expect(updatedTable.items).toHaveLength(1);
      expect(updatedTable.items[0].productId).toBe(SERVICIO_SIN_PREPARACION.id);
    });

    it("JAMÁS aparece en Cocina (ni en Caja ni en Mesas)", async () => {
      // Caja
      ctx.cart.addItem(SERVICIO_SIN_PREPARACION, 1);
      await ctx.salesEngine.quickSale({ cashierId: "cashier-1" });
      let kitchenOrders = await ctx.kitchenOrders.findAll();
      expect(kitchenOrders).toHaveLength(0);

      // Mesas
      const table = await ctx.tables.save({
        id: "table-servicio-2",
        name: "Mesa Servicio 2",
        capacity: 4,
        peopleCount: 0,
        status: "FREE",
        items: [],
        subtotal: 0,
        tax: 0,
        discount: 0,
        total: 0,
        updatedAt: new Date()
      } as Table).then(() => ctx.tables.findById("table-servicio-2"));
      expect(table).not.toBeNull();

      await ctx.tableEngine.openTable({ tableId: "table-servicio-2", peopleCount: 2, waiterId: "waiter-1" });
      await ctx.tableEngine.addItem({ tableId: "table-servicio-2", product: SERVICIO_SIN_PREPARACION, quantity: 1 });
      const result = await ctx.tableEngine.sendToKitchen("table-servicio-2");
      expect(result).toBeNull();

      kitchenOrders = await ctx.kitchenOrders.findAll();
      expect(kitchenOrders).toHaveLength(0);
    });

    it("NO descuenta stock propio (trackStock=false)", async () => {
      ctx.cart.addItem(SERVICIO_SIN_PREPARACION, 1);
      await ctx.salesEngine.quickSale({ cashierId: "cashier-1" });

      const product = await ctx.products.findById(SERVICIO_SIN_PREPARACION.id);
      expect(product?.stock).toBe(0); // sigue en 0
    });
  });

  // =========================================================================
  // 3. Cocina CON receta ON_DEMAND
  // =========================================================================
  describe("3. Cocina con receta ON_DEMAND", () => {
    it("se puede vender en Caja aunque su stock propio sea 0", async () => {
      ctx.cart.addItem(COCINA_CON_RECETA_ONDEMAND, 1);
      const sale = await ctx.salesEngine.quickSale({ cashierId: "cashier-1" });
      expect(sale).toBeDefined();
      expect(sale.items).toHaveLength(1);
    });

    it("descuenta los ingredientes de la receta, no su propio stock", async () => {
      const initialCarne = await ctx.products.findById(INGREDIENTE_CARNE.id);
      const initialPan = await ctx.products.findById(INGREDIENTE_PAN.id);
      expect(initialCarne?.stock).toBe(100);
      expect(initialPan?.stock).toBe(100);

      ctx.cart.addItem(COCINA_CON_RECETA_ONDEMAND, 1);
      await ctx.salesEngine.quickSale({ cashierId: "cashier-1" });

      const afterCarne = await ctx.products.findById(INGREDIENTE_CARNE.id);
      const afterPan = await ctx.products.findById(INGREDIENTE_PAN.id);
      const afterProduct = await ctx.products.findById(COCINA_CON_RECETA_ONDEMAND.id);

      expect(afterCarne?.stock).toBe(99); // 100 - 1
      expect(afterPan?.stock).toBe(99); // 100 - 1
      expect(afterProduct?.stock).toBe(0); // no cambia
    });

    it("aparece en Cocina", async () => {
      ctx.cart.addItem(COCINA_CON_RECETA_ONDEMAND, 1);
      await ctx.salesEngine.quickSale({ cashierId: "cashier-1" });

      const kitchenOrders = await ctx.kitchenOrders.findAll();
      expect(kitchenOrders).toHaveLength(1);
      expect(kitchenOrders[0].items).toHaveLength(1);
      expect(kitchenOrders[0].items[0].productId).toBe(COCINA_CON_RECETA_ONDEMAND.id);
    });
  });

  // =========================================================================
  // 4. Cocina CON receta BATCH
  // =========================================================================
  describe("4. Cocina con receta BATCH", () => {
    it("descuenta su propio stock (no los ingredientes) al vender", async () => {
      const initialHarina = await ctx.products.findById(INGREDIENTE_HARINA.id);
      const initialLevadura = await ctx.products.findById(INGREDIENTE_LEVADURA.id);
      expect(initialHarina?.stock).toBe(50);
      expect(initialLevadura?.stock).toBe(20);

      ctx.cart.addItem(COCINA_CON_RECETA_BATCH, 2);
      await ctx.salesEngine.quickSale({ cashierId: "cashier-1" });

      const afterHarina = await ctx.products.findById(INGREDIENTE_HARINA.id);
      const afterLevadura = await ctx.products.findById(INGREDIENTE_LEVADURA.id);
      const afterProduct = await ctx.products.findById(COCINA_CON_RECETA_BATCH.id);

      // Ingredientes NO se descuentan (ya se descontaron en produceBatch)
      expect(afterHarina?.stock).toBe(50);
      expect(afterLevadura?.stock).toBe(20);
      // Stock propio del producto BATCH sí se descuenta
      expect(afterProduct?.stock).toBe(8); // 10 - 2
    });

    it("aparece en Cocina", async () => {
      ctx.cart.addItem(COCINA_CON_RECETA_BATCH, 1);
      await ctx.salesEngine.quickSale({ cashierId: "cashier-1" });

      const kitchenOrders = await ctx.kitchenOrders.findAll();
      expect(kitchenOrders).toHaveLength(1);
      expect(kitchenOrders[0].items[0].productId).toBe(COCINA_CON_RECETA_BATCH.id);
    });
  });

  // =========================================================================
  // 5. Producto de inventario normal
  // =========================================================================
  describe("5. Inventario normal", () => {
    it("se puede vender y descuenta su propio stock", async () => {
      ctx.cart.addItem(INVENTARIO_NORMAL, 3);
      await ctx.salesEngine.quickSale({ cashierId: "cashier-1" });

      const product = await ctx.products.findById(INVENTARIO_NORMAL.id);
      expect(product?.stock).toBe(17); // 20 - 3
    });

    it("NO aparece en Cocina", async () => {
      ctx.cart.addItem(INVENTARIO_NORMAL, 1);
      await ctx.salesEngine.quickSale({ cashierId: "cashier-1" });

      const kitchenOrders = await ctx.kitchenOrders.findAll();
      expect(kitchenOrders).toHaveLength(0);
    });
  });

  // =========================================================================
  // 6. Venta mixta en Caja (POS): cocina + sin cocina
  // =========================================================================
  describe("6. Venta mixta en Caja (POS)", () => {
    it("cobra todo pero solo envía a Cocina lo que requiere preparación", async () => {
      ctx.cart.addItem(COCINA_SIN_RECETA, 1);
      ctx.cart.addItem(SERVICIO_SIN_PREPARACION, 2);
      ctx.cart.addItem(INVENTARIO_NORMAL, 1);

      const sale = await ctx.salesEngine.quickSale({ cashierId: "cashier-1" });
      expect(sale).toBeDefined();
      expect(sale.items).toHaveLength(3);

      const kitchenOrders = await ctx.kitchenOrders.findAll();
      expect(kitchenOrders).toHaveLength(1);
      // Solo el producto de cocina aparece en la comanda
      expect(kitchenOrders[0].items).toHaveLength(1);
      expect(kitchenOrders[0].items[0].productId).toBe(COCINA_SIN_RECETA.id);
    });

    it("el total incluye todos los items", async () => {
      ctx.cart.addItem(COCINA_SIN_RECETA, 1);
      ctx.cart.addItem(SERVICIO_SIN_PREPARACION, 2);
      ctx.cart.addItem(INVENTARIO_NORMAL, 1);

      const sale = await ctx.salesEngine.quickSale({ cashierId: "cashier-1" });
      const expectedSubtotal = COCINA_SIN_RECETA.price + SERVICIO_SIN_PREPARACION.price * 2 + INVENTARIO_NORMAL.price;
      const expectedTax = Number((expectedSubtotal * 0.19).toFixed(2));
      const expectedTotal = Number((expectedSubtotal + expectedTax).toFixed(2));
      expect(sale.total).toBe(expectedTotal);
    });
  });

  // =========================================================================
  // 7. Venta mixta en Mesas: cocina + sin cocina
  // =========================================================================
  describe("7. Venta mixta en Mesas", () => {
    it("envía a Cocina solo los items que lo requieren", async () => {
      const table = await ctx.tables.save({
        id: "table-mixta",
        name: "Mesa Mixta",
        capacity: 4,
        peopleCount: 0,
        status: "FREE",
        items: [],
        subtotal: 0,
        tax: 0,
        discount: 0,
        total: 0,
        updatedAt: new Date()
      } as Table).then(() => ctx.tables.findById("table-mixta"));
      expect(table).not.toBeNull();

      await ctx.tableEngine.openTable({ tableId: "table-mixta", peopleCount: 2, waiterId: "waiter-1" });
      await ctx.tableEngine.addItem({ tableId: "table-mixta", product: COCINA_SIN_RECETA, quantity: 1 });
      await ctx.tableEngine.addItem({ tableId: "table-mixta", product: SERVICIO_SIN_PREPARACION, quantity: 1 });
      await ctx.tableEngine.addItem({ tableId: "table-mixta", product: INVENTARIO_NORMAL, quantity: 1 });

      await ctx.tableEngine.sendToKitchen("table-mixta");

      const kitchenOrders = await ctx.kitchenOrders.findAll();
      expect(kitchenOrders).toHaveLength(1);
      expect(kitchenOrders[0].items).toHaveLength(1);
      expect(kitchenOrders[0].items[0].productId).toBe(COCINA_SIN_RECETA.id);
    });

    it("al cerrar la mesa, cobra todo y NO duplica comanda (skipKitchen=true)", async () => {
      const table = await ctx.tables.save({
        id: "table-mixta-2",
        name: "Mesa Mixta 2",
        capacity: 4,
        peopleCount: 0,
        status: "FREE",
        items: [],
        subtotal: 0,
        tax: 0,
        discount: 0,
        total: 0,
        updatedAt: new Date()
      } as Table).then(() => ctx.tables.findById("table-mixta-2"));
      expect(table).not.toBeNull();

      await ctx.tableEngine.openTable({ tableId: "table-mixta-2", peopleCount: 2, waiterId: "waiter-1" });
      await ctx.tableEngine.addItem({ tableId: "table-mixta-2", product: COCINA_SIN_RECETA, quantity: 1 });
      await ctx.tableEngine.addItem({ tableId: "table-mixta-2", product: SERVICIO_SIN_PREPARACION, quantity: 1 });
      await ctx.tableEngine.sendToKitchen("table-mixta-2");

      // Antes de cerrar: 1 comanda
      let kitchenOrdersBefore = await ctx.kitchenOrders.findAll();
      expect(kitchenOrdersBefore).toHaveLength(1);

      // Cerrar mesa
      const result = await ctx.tableEngine.closeTable({
        tableId: "table-mixta-2",
        method: "CASH",
        cashierId: "cashier-1"
      });

      expect(result.sale).toBeDefined();
      expect(result.sale.items).toHaveLength(2);

      // Después de cerrar: SIGUE siendo 1 comanda (no se duplicó)
      const kitchenOrdersAfter = await ctx.kitchenOrders.findAll();
      expect(kitchenOrdersAfter).toHaveLength(1);
    });
  });

  // =========================================================================
  // 8. Stock y descuento de inventario
  // =========================================================================
  describe("8. Stock y descuento de inventario", () => {
    it("producto trackStock=false con stock=0 NO bloquea la venta", async () => {
      ctx.cart.addItem(COCINA_SIN_RECETA, 1);
      await expect(ctx.salesEngine.quickSale({ cashierId: "cashier-1" })).resolves.toBeDefined();
    });

    it("producto trackStock=true SÍ exige y descuenta stock", async () => {
      // Primero, agotar el inventario
      ctx.cart.addItem(INVENTARIO_NORMAL, 20);
      await ctx.salesEngine.quickSale({ cashierId: "cashier-1" });

      // Ahora intentar vender más de lo disponible
      ctx.cart.addItem(INVENTARIO_NORMAL, 1);
      await expect(ctx.salesEngine.quickSale({ cashierId: "cashier-1" })).rejects.toThrow(
        /Stock insuficiente/
      );
    });

    it("restoreForSale no infla stock de productos trackStock=false", async () => {
      ctx.cart.addItem(COCINA_SIN_RECETA, 1);
      await ctx.salesEngine.quickSale({ cashierId: "cashier-1" });

      await ctx.inventory.restoreForSale(
        [{ productId: COCINA_SIN_RECETA.id, quantity: 1 }],
        "Cancelación de prueba"
      );

      const product = await ctx.products.findById(COCINA_SIN_RECETA.id);
      expect(product?.stock).toBe(0); // sigue en 0
    });
  });

  // =========================================================================
  // 9. Separación visual: Barra vs Cocina vs Sin preparación
  // =========================================================================
  describe("9. Separación por estación", () => {
    it("Cocina sin receta va a Cocina", async () => {
      ctx.cart.addItem(COCINA_SIN_RECETA, 1);
      await ctx.salesEngine.quickSale({ cashierId: "cashier-1" });
      const orders = await ctx.kitchenOrders.findAll();
      expect(orders).toHaveLength(1);
    });

    it("Bebida/Inventario NO va a Cocina", async () => {
      ctx.cart.addItem(INVENTARIO_NORMAL, 1);
      await ctx.salesEngine.quickSale({ cashierId: "cashier-1" });
      const orders = await ctx.kitchenOrders.findAll();
      expect(orders).toHaveLength(0);
    });

    it("Servicio NO va a Cocina", async () => {
      ctx.cart.addItem(SERVICIO_SIN_PREPARACION, 1);
      await ctx.salesEngine.quickSale({ cashierId: "cashier-1" });
      const orders = await ctx.kitchenOrders.findAll();
      expect(orders).toHaveLength(0);
    });
  });
});
