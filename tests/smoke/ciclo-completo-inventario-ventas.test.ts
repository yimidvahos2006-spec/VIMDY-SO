// tests/smoke/ciclo-completo-inventario-ventas.test.ts
/* ===========================================================================
   AUDITORÍA FUNCIONAL — Ciclo completo Inventario + Ventas
   ---------------------------------------------------------------------------
   Verifica el flujo end-to-end que todo negocio real ejecuta:
     Crear → configurar → comprar/ingresar → vender → descontar →
     devolver → restaurar → auditar (kardex + stock final).

   Cubre:
   - Producto normal (stockable)
   - Ingrediente (isIngredient=true)
   - Producto de cocina sin receta (trackStock=false, requiresKitchen=true)
   - Producto con receta ON_DEMAND
   - Producto con receta BATCH
   - Servicio (trackStock=false, requiresKitchen=false)
   - Venta mixta
   - Devolución total y parcial
   - Cancelación de venta
   - Ajuste manual de stock
   - Kardex
   =========================================================================== */

import { describe, it, expect, beforeEach } from "vitest";

import {
  Product,
  Sale,
  RecipeItem,
  Customer,
  KitchenOrder,
  CashMovement,
  Order,
  Table,
  LossCategory
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
// Helpers de creación
// ---------------------------------------------------------------------------

async function createProductoNormal(inventory: InventoryEngine): Promise<Product> {
  return inventory.createProduct({
    name: "Gaseosa 400ml",
    categoryId: "cat-bebidas",
    price: 4000,
    stock: 20,
    minStock: 5,
    requiresKitchen: false,
    trackStock: true
  });
}

async function createIngredienteCarne(inventory: InventoryEngine): Promise<Product> {
  return inventory.createProduct({
    name: "Carne molida",
    categoryId: "cat-insumos",
    price: 5000,
    stock: 100,
    minStock: 10,
    isIngredient: true,
    trackStock: true
  });
}

async function createCocinaSinReceta(inventory: InventoryEngine): Promise<Product> {
  return inventory.createProduct({
    name: "Caldo de Costilla",
    categoryId: "cat-comidas",
    price: 15000,
    stock: 0,
    minStock: 0,
    requiresKitchen: true,
    trackStock: false
  });
}

async function createHamburguesaOnDemand(inventory: InventoryEngine, ingredientCarneId: string, ingredientPanId: string): Promise<Product> {
  return inventory.createProduct({
    name: "Hamburguesa Casera",
    categoryId: "cat-comidas",
    price: 18000,
    stock: 0,
    minStock: 0,
    requiresKitchen: true,
    trackStock: false,
    recipe: [
      { productId: ingredientCarneId, quantity: 1 },
      { productId: ingredientPanId, quantity: 1 }
    ],
    productionMode: "ON_DEMAND"
  });
}

async function createPanBatch(inventory: InventoryEngine, ingredientHarinaId: string): Promise<Product> {
  return inventory.createProduct({
    name: "Pan de la casa",
    categoryId: "cat-comidas",
    price: 8000,
    stock: 10,
    minStock: 2,
    requiresKitchen: true,
    trackStock: true,
    recipe: [
      { productId: ingredientHarinaId, quantity: 2 }
    ],
    productionMode: "BATCH"
  });
}

async function createServicio(inventory: InventoryEngine): Promise<Product> {
  return inventory.createProduct({
    name: "Cover / Servicio",
    categoryId: "cat-servicios",
    price: 5000,
    stock: 0,
    minStock: 0,
    requiresKitchen: false,
    trackStock: false
  });
}

async function createIngredientePan(inventory: InventoryEngine): Promise<Product> {
  return inventory.createProduct({
    name: "Pan hamburguesa",
    categoryId: "cat-insumos",
    price: 2000,
    stock: 100,
    minStock: 10,
    isIngredient: true,
    trackStock: true
  });
}

async function createIngredienteHarina(inventory: InventoryEngine): Promise<Product> {
  return inventory.createProduct({
    name: "Harina",
    categoryId: "cat-insumos",
    price: 1500,
    stock: 50,
    minStock: 5,
    isIngredient: true,
    trackStock: true
  });
}

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
    kardex,
    orders
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("Auditoría funcional: ciclo completo Inventario + Ventas", () => {
  let ctx: ReturnType<typeof buildContext>;
  let productoNormal: Product;
  let ingredienteCarne: Product;
  let cocinaSinReceta: Product;
  let hamburguesaOnDemand: Product;
  let panBatch: Product;
  let servicio: Product;
  let ingredientePan: Product;
  let ingredienteHarina: Product;

  beforeEach(async () => {
    ctx = buildContext();

    ingredienteCarne = await createIngredienteCarne(ctx.inventory);
    ingredientePan = await createIngredientePan(ctx.inventory);
    ingredienteHarina = await createIngredienteHarina(ctx.inventory);

    productoNormal = await createProductoNormal(ctx.inventory);
    cocinaSinReceta = await createCocinaSinReceta(ctx.inventory);
    hamburguesaOnDemand = await createHamburguesaOnDemand(ctx.inventory, ingredienteCarne.id, ingredientePan.id);
    panBatch = await createPanBatch(ctx.inventory, ingredienteHarina.id);
    servicio = await createServicio(ctx.inventory);
  });

  // =========================================================================
  // 1. Crear productos de cada tipo y verificar flags iniciales
  // =========================================================================
  describe("1. Creación de productos", () => {
    it("producto normal se crea con trackStock=true, requiresKitchen=false", async () => {
      const p = await ctx.products.findById(productoNormal.id);
      expect(p?.trackStock).toBe(true);
      expect(p?.requiresKitchen).toBe(false);
      expect(p?.isIngredient).toBe(false);
    });

    it("ingrediente se crea con isIngredient=true, trackStock=true, requiresKitchen=false", async () => {
      const p = await ctx.products.findById(ingredienteCarne.id);
      expect(p?.isIngredient).toBe(true);
      expect(p?.trackStock).toBe(true);
      expect(p?.requiresKitchen).toBe(false);
    });

    it("cocina sin receta se crea con requiresKitchen=true, trackStock=false", async () => {
      const p = await ctx.products.findById(cocinaSinReceta.id);
      expect(p?.requiresKitchen).toBe(true);
      expect(p?.trackStock).toBe(false);
    });

    it("producto con receta ON_DEMAND se crea con requiresKitchen=true, trackStock=false", async () => {
      const p = await ctx.products.findById(hamburguesaOnDemand.id);
      expect(p?.requiresKitchen).toBe(true);
      expect(p?.trackStock).toBe(false);
      expect(p?.recipe?.length).toBe(2);
    });

    it("producto con receta BATCH se crea con requiresKitchen=true, trackStock=true", async () => {
      const p = await ctx.products.findById(panBatch.id);
      expect(p?.requiresKitchen).toBe(true);
      expect(p?.trackStock).toBe(true);
      expect(p?.productionMode).toBe("BATCH");
    });

    it("servicio se crea con requiresKitchen=false, trackStock=false", async () => {
      const p = await ctx.products.findById(servicio.id);
      expect(p?.requiresKitchen).toBe(false);
      expect(p?.trackStock).toBe(false);
    });
  });

  // =========================================================================
  // 2. Comprar / ingresar stock
  // =========================================================================
  describe("2. Ingreso de stock", () => {
    it("aumenta stock y registra kardex", async () => {
      await ctx.inventory.increaseStock(productoNormal.id, 10, "Compra a proveedor", "system");

      const p = await ctx.products.findById(productoNormal.id);
      expect(p?.stock).toBe(30); // 20 + 10

      const movements = await ctx.kardex.getAllMovements();
      const increase = movements.filter(m => m.productId === productoNormal.id && m.type === "INCREASE");
      expect(increase.length).toBeGreaterThanOrEqual(1);
    });

    it("produceBatch descuenta ingredientes y aumenta stock del producto terminado", async () => {
      await ctx.inventory.produceBatch(panBatch.id, 5, "system");

      const pan = await ctx.products.findById(panBatch.id);
      expect(pan?.stock).toBe(15); // 10 + 5

      const harina = await ctx.products.findById(ingredienteHarina.id);
      expect(harina?.stock).toBe(40); // 50 - (2 * 5)
    });
  });

  // =========================================================================
  // 3. Vender y descontar inventario
  // =========================================================================
  describe("3. Venta y descuento de inventario", () => {
    it("producto normal descuenta su propio stock", async () => {
      ctx.cart.addItem(productoNormal, 3);
      await ctx.salesEngine.quickSale({ cashierId: "cashier-1" });

      const p = await ctx.products.findById(productoNormal.id);
      expect(p?.stock).toBe(17); // 20 - 3
    });

    it("receta ON_DEMAND descuenta ingredientes, no su propio stock", async () => {
      ctx.cart.addItem(hamburguesaOnDemand, 2);
      await ctx.salesEngine.quickSale({ cashierId: "cashier-1" });

      const carne = await ctx.products.findById(ingredienteCarne.id);
      const pan = await ctx.products.findById(ingredientePan.id);
      const hamburguesa = await ctx.products.findById(hamburguesaOnDemand.id);

      expect(carne?.stock).toBe(98); // 100 - 2
      expect(pan?.stock).toBe(98); // 100 - 2
      expect(hamburguesa?.stock).toBe(0); // no cambia
    });

    it("receta BATCH descuenta su propio stock, no ingredientes", async () => {
      // El pan batch ya tiene stock 10 (creado así). No se produjo tanda,
      // así que los ingredientes siguen intactos.
      ctx.cart.addItem(panBatch, 3);
      await ctx.salesEngine.quickSale({ cashierId: "cashier-1" });

      const pan = await ctx.products.findById(panBatch.id);
      const harina = await ctx.products.findById(ingredienteHarina.id);

      expect(pan?.stock).toBe(7); // 10 - 3
      expect(harina?.stock).toBe(50); // no cambia
    });

    it("cocina sin receta (trackStock=false) no descuenta stock", async () => {
      ctx.cart.addItem(cocinaSinReceta, 2);
      await ctx.salesEngine.quickSale({ cashierId: "cashier-1" });

      const p = await ctx.products.findById(cocinaSinReceta.id);
      expect(p?.stock).toBe(0);
    });

    it("servicio (trackStock=false) no descuenta stock", async () => {
      ctx.cart.addItem(servicio, 1);
      await ctx.salesEngine.quickSale({ cashierId: "cashier-1" });

      const p = await ctx.products.findById(servicio.id);
      expect(p?.stock).toBe(0);
    });

    it("ingrediente se vende como producto normal (descsuenta su stock)", async () => {
      ctx.cart.addItem(ingredienteCarne, 2);
      await ctx.salesEngine.quickSale({ cashierId: "cashier-1" });

      const p = await ctx.products.findById(ingredienteCarne.id);
      expect(p?.stock).toBe(98); // 100 - 2
    });

    it("venta mixta descuenta correctamente cada tipo de producto", async () => {
      ctx.cart.addItem(productoNormal, 2);
      ctx.cart.addItem(hamburguesaOnDemand, 1);
      ctx.cart.addItem(cocinaSinReceta, 1);

      await ctx.salesEngine.quickSale({ cashierId: "cashier-1" });

      expect((await ctx.products.findById(productoNormal.id))?.stock).toBe(18);
      expect((await ctx.products.findById(ingredienteCarne.id))?.stock).toBe(99);
      expect((await ctx.products.findById(ingredientePan.id))?.stock).toBe(99);
      expect((await ctx.products.findById(cocinaSinReceta.id))?.stock).toBe(0);
    });
  });

  // =========================================================================
  // 4. Devolver / reembolsar
  // =========================================================================
  describe("4. Devolución y restauración de inventario", () => {
    async function createPaidSale(items: { productId: string; quantity: number; price: number }[]) {
      const sale = await ctx.salesEngine.createSale({
        id: `sale-paid-${Math.random().toString(36).slice(2)}`,
        type: "QUICK",
        items,
        cashierId: "cashier-1"
      });
      await ctx.salesEngine.registerPayment(sale, "CASH", { received: sale.total });
      return sale;
    }

    it("reembolso total restaura stock de producto normal", async () => {
      const sale = await createPaidSale([
        { productId: productoNormal.id, quantity: 3, price: productoNormal.price }
      ]);
      expect((await ctx.products.findById(productoNormal.id))?.stock).toBe(17);

      await ctx.salesEngine.refundSale(sale.id, "Cliente devolvió");

      const p = await ctx.products.findById(productoNormal.id);
      expect(p?.stock).toBe(20); // 17 + 3
    });

    it("reembolso total restaura ingredientes de receta ON_DEMAND", async () => {
      const sale = await createPaidSale([
        { productId: hamburguesaOnDemand.id, quantity: 2, price: hamburguesaOnDemand.price }
      ]);
      expect((await ctx.products.findById(ingredienteCarne.id))?.stock).toBe(98);

      await ctx.salesEngine.refundSale(sale.id, "Cliente devolvió");

      const carne = await ctx.products.findById(ingredienteCarne.id);
      const pan = await ctx.products.findById(ingredientePan.id);
      expect(carne?.stock).toBe(100); // 98 + 2
      expect(pan?.stock).toBe(100); // 98 + 2
    });

    it("reembolso parcial restaura solo lo devuelto", async () => {
      const sale = await createPaidSale([
        { productId: productoNormal.id, quantity: 5, price: productoNormal.price }
      ]);
      expect((await ctx.products.findById(productoNormal.id))?.stock).toBe(15);

      await ctx.salesEngine.partialRefundSale(
        sale.id,
        [{ productId: productoNormal.id, quantity: 2 }],
        "Devolvió 2 unidades"
      );

      const p = await ctx.products.findById(productoNormal.id);
      expect(p?.stock).toBe(17); // 15 + 2
    });

    it("reembolso de producto BATCH restaura su stock propio", async () => {
      const sale = await createPaidSale([
        { productId: panBatch.id, quantity: 2, price: panBatch.price }
      ]);
      expect((await ctx.products.findById(panBatch.id))?.stock).toBe(8);

      await ctx.salesEngine.refundSale(sale.id, "Devolvió pan");

      const pan = await ctx.products.findById(panBatch.id);
      expect(pan?.stock).toBe(10); // 8 + 2
    });

    it("reembolso no restaura stock de producto trackStock=false", async () => {
      const sale = await createPaidSale([
        { productId: cocinaSinReceta.id, quantity: 1, price: cocinaSinReceta.price }
      ]);

      await ctx.salesEngine.refundSale(sale.id, "Devolvió caldo");

      const p = await ctx.products.findById(cocinaSinReceta.id);
      expect(p?.stock).toBe(0); // sigue en 0
    });
  });

  // =========================================================================
  // 5. Cancelación de venta
  // =========================================================================
  describe("5. Cancelación de venta", () => {
    it("cancela venta pagada y restaura inventario", async () => {
      const sale = await ctx.salesEngine.createSale({
        id: `sale-cancel-${Math.random().toString(36).slice(2)}`,
        type: "QUICK",
        items: [{ productId: productoNormal.id, quantity: 2, price: productoNormal.price }],
        cashierId: "cashier-1"
      });
      await ctx.salesEngine.registerPayment(sale, "CASH", { received: sale.total });
      expect((await ctx.products.findById(productoNormal.id))?.stock).toBe(18);

      const cancelled = await ctx.salesEngine.cancelSale(sale.id, "Error de cajero");

      expect(cancelled.status).toBe("CANCELLED");

      const p = await ctx.products.findById(productoNormal.id);
      expect(p?.stock).toBe(20); // 18 + 2
    });

    it("no se puede cancelar una venta ya reembolsada", async () => {
      const sale = await ctx.salesEngine.createSale({
        id: `sale-cancel-reemb-${Math.random().toString(36).slice(2)}`,
        type: "QUICK",
        items: [{ productId: productoNormal.id, quantity: 1, price: productoNormal.price }],
        cashierId: "cashier-1"
      });
      await ctx.salesEngine.registerPayment(sale, "CASH", { received: sale.total });

      await ctx.salesEngine.refundSale(sale.id, "Devolución total");

      await expect(
        ctx.salesEngine.cancelSale(sale.id, "Intento después de reembolso")
      ).rejects.toThrow(/SALE_CANNOT_BE_CANCELLED/);
    });
  });

  // =========================================================================
  // 6. Ajuste manual de stock
  // =========================================================================
  describe("6. Ajuste manual de stock", () => {
    it("aumenta stock manualmente", async () => {
      await ctx.inventory.increaseStock(productoNormal.id, 5, "Conteo físico", "system");
      const p = await ctx.products.findById(productoNormal.id);
      expect(p?.stock).toBe(25); // 20 + 5
    });

    it("disminuye stock manualmente (merma)", async () => {
      await ctx.inventory.decreaseStock(productoNormal.id, 3, "Producto dañado", "system", "DAÑO");
      const p = await ctx.products.findById(productoNormal.id);
      expect(p?.stock).toBe(17); // 20 - 3
    });
  });

  // =========================================================================
  // 7. Kardex: trazabilidad completa
  // =========================================================================
  describe("7. Kardex", () => {
    it("registra movimiento de venta", async () => {
      ctx.cart.addItem(productoNormal, 2);
      await ctx.salesEngine.quickSale({ cashierId: "cashier-1" });

      const history = await ctx.kardex.getAllMovements();
      const saleMovements = history.filter(
        m => m.productId === productoNormal.id && m.type === "DECREASE" && m.reason.includes("Venta")
      );
      expect(saleMovements.length).toBeGreaterThanOrEqual(1);
      expect(saleMovements[0].quantity).toBe(2);
    });

    it("registra movimiento de reembolso", async () => {
      const sale = await ctx.salesEngine.createSale({
        id: `sale-kardex-${Math.random().toString(36).slice(2)}`,
        type: "QUICK",
        items: [{ productId: productoNormal.id, quantity: 2, price: productoNormal.price }],
        cashierId: "cashier-1"
      });
      await ctx.salesEngine.registerPayment(sale, "CASH", { received: sale.total });
      await ctx.salesEngine.refundSale(sale.id, "Devolución");

      const history = await ctx.kardex.getAllMovements();
      const refundMovements = history.filter(
        m => m.productId === productoNormal.id && m.type === "INCREASE" && m.reason.includes("Reembolso")
      );
      expect(refundMovements.length).toBeGreaterThanOrEqual(1);
      expect(refundMovements[0].quantity).toBe(2);
    });
  });

  // =========================================================================
  // 8. Flujo en Mesas (mesero)
  // =========================================================================
  describe("8. Flujo en Mesas", () => {
    it("abre mesa, agrega productos mixtos, envía a cocina y cierra cobrando", async () => {
      const table = await ctx.tables.save({
        id: "table-ciclo-1",
        name: "Mesa Ciclo 1",
        capacity: 4,
        peopleCount: 0,
        status: "FREE",
        items: [],
        subtotal: 0,
        tax: 0,
        discount: 0,
        total: 0,
        updatedAt: new Date()
      } as Table).then(() => ctx.tables.findById("table-ciclo-1"));
      expect(table).not.toBeNull();

      // Abrir mesa
      await ctx.tableEngine.openTable({ tableId: "table-ciclo-1", peopleCount: 2, waiterId: "waiter-1" });

      // Agregar productos mixtos
      await ctx.tableEngine.addItem({ tableId: "table-ciclo-1", product: cocinaSinReceta, quantity: 1 });
      await ctx.tableEngine.addItem({ tableId: "table-ciclo-1", product: productoNormal, quantity: 2 });
      await ctx.tableEngine.addItem({ tableId: "table-ciclo-1", product: servicio, quantity: 1 });

      // Enviar a cocina
      await ctx.tableEngine.sendToKitchen("table-ciclo-1");

      // Verificar comanda: solo el producto de cocina
      const kitchenOrders = await ctx.kitchenOrders.findAll();
      expect(kitchenOrders).toHaveLength(1);
      expect(kitchenOrders[0].items).toHaveLength(1);
      expect(kitchenOrders[0].items[0].productId).toBe(cocinaSinReceta.id);

      // Cerrar mesa (cobrar)
      const result = await ctx.tableEngine.closeTable({
        tableId: "table-ciclo-1",
        method: "CASH",
        cashierId: "cashier-1"
      });

      expect(result.sale).toBeDefined();
      expect(result.sale.items).toHaveLength(3);

      // Verificar descuento de inventario
      expect((await ctx.products.findById(productoNormal.id))?.stock).toBe(18); // 20 - 2
      expect((await ctx.products.findById(cocinaSinReceta.id))?.stock).toBe(0);
    });
  });

  // =========================================================================
  // 9. Idempotencia: no se duplica inventario ni comandas
  // =========================================================================
  describe("9. Idempotencia", () => {
    it("crear la misma venta dos veces con el mismo id no duplica inventario", async () => {
      const input = {
        id: "sale-idempotente",
        type: "QUICK" as const,
        items: [{ productId: productoNormal.id, quantity: 2, price: productoNormal.price }],
        cashierId: "cashier-1"
      };

      const sale1 = await ctx.salesEngine.createSale(input);
      const sale2 = await ctx.salesEngine.createSale(input);

      expect(sale1.id).toBe(sale2.id);

      const p = await ctx.products.findById(productoNormal.id);
      expect(p?.stock).toBe(18); // 20 - 2, no 16
    });
  });

  // =========================================================================
  // 10. Estado final del inventario después del ciclo completo
  // =========================================================================
  describe("10. Estado final de inventario", () => {
    it("después de crear, comprar, vender, devolver y ajustar, el stock es correcto", async () => {
      // Estado inicial conocido
      expect((await ctx.products.findById(productoNormal.id))?.stock).toBe(20);

      // 1. Vender 5 unidades
      const sale = await ctx.salesEngine.createSale({
        id: `sale-final-${Math.random().toString(36).slice(2)}`,
        type: "QUICK",
        items: [{ productId: productoNormal.id, quantity: 5, price: productoNormal.price }],
        cashierId: "cashier-1"
      });
      await ctx.salesEngine.registerPayment(sale, "CASH", { received: sale.total });
      expect((await ctx.products.findById(productoNormal.id))?.stock).toBe(15);

      // 2. Devolver 2 unidades
      await ctx.salesEngine.partialRefundSale(
        sale.id,
        [{ productId: productoNormal.id, quantity: 2 }],
        "Devolución parcial"
      );
      expect((await ctx.products.findById(productoNormal.id))?.stock).toBe(17);

      // 3. Cancelar la venta restante (3 unidades)
      await ctx.salesEngine.cancelSale(sale.id, "Cancelación completa");
      expect((await ctx.products.findById(productoNormal.id))?.stock).toBe(20);

      // 4. Ajuste manual: agregar 10
      await ctx.inventory.increaseStock(productoNormal.id, 10, "Compra adicional", "system");
      expect((await ctx.products.findById(productoNormal.id))?.stock).toBe(30);

      // 5. Ajuste manual: quitar 3 (merma)
      await ctx.inventory.decreaseStock(productoNormal.id, 3, "Merma", "system", "MERMA");
      expect((await ctx.products.findById(productoNormal.id))?.stock).toBe(27);
    });
  });
});
