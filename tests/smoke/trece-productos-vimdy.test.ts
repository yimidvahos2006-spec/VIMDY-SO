// tests/smoke/trece-productos-vimdy.test.ts
/* ===========================================================================
   SMOKE TEST — FASE G: los 13 productos de referencia
   ---------------------------------------------------------------------------
   De la instrucción de Yimid ("🎯 Cómo quiero que quede el Inventario de
   VIMDY", sección 10): antes de declarar Inventario terminado, probar mínimo
   estos 13 productos. Cada uno se crea EXACTAMENTE con el payload que
   produciría el wizard del editor (mismas respuestas a "¿Qué vas a vender?",
   "¿Controlar ingredientes?", "¿Cómo lo produces?"), usando
   `computeTracksStock`/`visualTypeOf` -- las mismas funciones puras que usa
   InventoryDashboard.tsx -- para que este test falle si el editor real
   alguna vez se desalinea de esta tabla.

   Producto          | Cómo funciona                | wizard
   ------------------|-------------------------------|----------------------------------
   Coca-Cola         | Stock directo                 | inventario
   Cerveza           | Stock directo                 | inventario
   Café              | Ingredientes -> venta          | cocina_receta, ON_DEMAND
   Pizza             | Ingredientes+tamaños+extras    | cocina_receta, ON_DEMAND, sizes+extras
   Hamburguesa       | Ingredientes + extras          | cocina_receta, ON_DEMAND, extras
   Perro             | Ingredientes + extras          | cocina_receta, ON_DEMAND, extras
   Jugo              | Ingredientes                   | cocina_receta, ON_DEMAND
   Batido            | Ingredientes + tamaños         | cocina_receta, ON_DEMAND, sizes
   Pastel            | Producción por tandas          | cocina_receta, BATCH
   Pan               | Producción por tandas          | cocina_receta, BATCH
   Helado            | Stock directo                  | inventario
   Pollo preparado   | Ingredientes -> venta          | cocina_receta, ON_DEMAND
   Domicilio         | Servicio                       | servicio

   No se prueban los 13 con una venta completa (Pizza y su combinación
   tamaño+extras ya se prueban a fondo en
   inventario-inteligente-receta-efectiva.test.ts). Aquí se prueba:
     1. Que los 13 se puedan CREAR con el payload real del wizard, sin que
        `validate()` los rechace.
     2. Que `computeTracksStock`/`visualTypeOf` les asignen el comportamiento
        correcto (tarjeta Inventario sí/no, consume ingredientes sí/no).
     3. Para cada categoría de comportamiento (stock directo, receta a la
        orden, receta por tanda, servicio) al menos UN caso representativo
        se vende de verdad y se verifica qué se mueve en inventario --
        porque ahí es donde ya encontramos el bug real de `productionMode`.
=========================================================================== */

import { describe, it, expect, beforeEach } from "vitest";

import { Product, Sale, KitchenOrder, CashMovement } from "../../src/core/entities/Entities";

import { CartEngine } from "../../src/core/engines/CartEngine";
import { InventoryEngine, ProductInput } from "../../src/core/engines/InventoryEngine";
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

import { computeTracksStock, visualTypeOf, ProductType } from "../../src/core/utils/productVisualType";

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

/**
 * Arma el ProductInput EXACTAMENTE como lo haría InventoryDashboard.tsx en
 * `handleSave` a partir de las respuestas del wizard: `productType` (lo que
 * decide handleVisualTypeSelect), `hasRecipe` (checkbox de "Consumo de
 * ingredientes") y `productionMode` (pregunta nueva "¿Cómo lo produces?").
 */
function fromWizard(
  base: Omit<ProductInput, "trackStock" | "productionMode"> & { productType: ProductType },
  hasRecipe: boolean,
  productionMode: "ON_DEMAND" | "BATCH" = "ON_DEMAND"
): ProductInput {
  const { productType, ...rest } = base;
  return {
    ...rest,
    productionMode: hasRecipe ? productionMode : undefined,
    trackStock: computeTracksStock(productType, hasRecipe, productionMode)
  };
}

describe("Fase G — los 13 productos de referencia de VIMDY", () => {
  let ctx: ReturnType<typeof buildEngines>;

  beforeEach(async () => {
    ctx = buildEngines();
    // Ingredientes comunes a varias recetas.
    for (const ing of [
      { id: "ing-cafe-molido", name: "Café molido", stock: 5000, unit: "g" },
      { id: "ing-leche", name: "Leche", stock: 10000, unit: "ml" },
      { id: "ing-masa", name: "Masa", stock: 10000, unit: "g" },
      { id: "ing-salsa", name: "Salsa", stock: 10000, unit: "g" },
      { id: "ing-queso", name: "Queso", stock: 10000, unit: "g" },
      { id: "ing-carne", name: "Carne", stock: 10000, unit: "g" },
      { id: "ing-pan-hamburguesa", name: "Pan de hamburguesa", stock: 500, unit: "unidad" },
      { id: "ing-salchicha", name: "Salchicha", stock: 500, unit: "unidad" },
      { id: "ing-naranja", name: "Naranja", stock: 20000, unit: "g" },
      { id: "ing-fruta", name: "Fruta mixta", stock: 20000, unit: "g" },
      { id: "ing-harina", name: "Harina", stock: 20000, unit: "g" },
      { id: "ing-azucar", name: "Azúcar", stock: 5000, unit: "g" },
      { id: "ing-pollo-crudo", name: "Pollo crudo", stock: 10000, unit: "g" }
    ]) {
      await ctx.products.save({
        ...ing,
        categoryId: "cat-insumos",
        price: 0,
        minStock: 0,
        active: true,
        favorite: false,
        productionMode: "ON_DEMAND",
        trackStock: true
      } as Product);
    }
  });

  it("1. Coca-Cola — stock directo: se crea con tarjeta Inventario y descuenta su propio stock al vender", async () => {
    const input = fromWizard(
      { name: "Coca-Cola", productType: "inventario", categoryId: "cat-bebidas", price: 4000, stock: 48, minStock: 6, unit: "unidad" },
      false
    );
    expect(computeTracksStock("inventario", false, "ON_DEMAND")).toBe(true);
    expect(visualTypeOf("inventario")).toBe("listo_para_vender");

    const cocaCola = await ctx.inventory.createProduct(input);
    expect(cocaCola.trackStock).toBe(true);
    expect(cocaCola.recipe).toBeUndefined();

    const sale = await ctx.salesEngine.quickSale({ cashierId: "c1", source: [{ productId: cocaCola.id, quantity: 5 }] });
    await ctx.salesEngine.registerPayment(sale, "CASH");

    const after = await ctx.products.findById(cocaCola.id);
    expect(after!.stock).toBe(48 - 5);
  });

  it("2. Cerveza — stock directo, igual que Coca-Cola", async () => {
    const input = fromWizard(
      { name: "Cerveza", productType: "inventario", categoryId: "cat-bebidas", price: 6000, stock: 60, minStock: 12, unit: "unidad" },
      false
    );
    const cerveza = await ctx.inventory.createProduct(input);
    expect(cerveza.trackStock).toBe(true);
    expect(cerveza.recipe).toBeUndefined();
  });

  it("3. Café — ingredientes → venta: NO maneja stock propio, descuenta receta al vender", async () => {
    const input = fromWizard(
      {
        name: "Café", productType: "cocina_receta", categoryId: "cat-bebidas", price: 3000, stock: 0, minStock: 0,
        recipe: [{ productId: "ing-cafe-molido", quantity: 18 }, { productId: "ing-leche", quantity: 40 }]
      },
      true,
      "ON_DEMAND"
    );
    expect(computeTracksStock("cocina_receta", true, "ON_DEMAND")).toBe(false);

    const cafe = await ctx.inventory.createProduct(input);
    expect(cafe.trackStock).toBe(false);

    const sale = await ctx.salesEngine.quickSale({ cashierId: "c1", source: [{ productId: cafe.id, quantity: 4 }] });
    await ctx.salesEngine.registerPayment(sale, "CASH");

    const molido = await ctx.products.findById("ing-cafe-molido");
    const leche = await ctx.products.findById("ing-leche");
    expect(molido!.stock).toBe(5000 - 18 * 4);
    expect(leche!.stock).toBe(10000 - 40 * 4);
  });

  it("4. Pizza — ingredientes + tamaños + extras: se crea con sizes/extras intactos (venta completa ya cubierta en otro smoke test)", async () => {
    const input = fromWizard(
      {
        name: "Pizza", productType: "cocina_receta", categoryId: "cat-comidas", price: 25000, stock: 0, minStock: 0,
        recipe: [{ productId: "ing-masa", quantity: 180 }, { productId: "ing-salsa", quantity: 60 }, { productId: "ing-queso", quantity: 120 }],
        sizes: [
          { id: "size-personal", name: "Pizza Personal", priceDelta: 0 },
          { id: "size-grande", name: "Pizza Grande", priceDelta: 12000, recipe: [{ productId: "ing-masa", quantity: 350 }, { productId: "ing-salsa", quantity: 80 }, { productId: "ing-queso", quantity: 250 }] }
        ],
        extras: [{ id: "extra-queso", name: "Queso", priceDelta: 3000, recipe: [{ productId: "ing-queso", quantity: 50 }] }]
      },
      true,
      "ON_DEMAND"
    );
    const pizza = await ctx.inventory.createProduct(input);
    expect(pizza.trackStock).toBe(false);
    expect(pizza.sizes?.length).toBe(2);
    expect(pizza.extras?.length).toBe(1);
  });

  it("5. Hamburguesa — ingredientes + extras: extras se consolidan con la receta general al vender", async () => {
    const input = fromWizard(
      {
        name: "Hamburguesa", productType: "cocina_receta", categoryId: "cat-comidas", price: 18000, stock: 0, minStock: 0,
        recipe: [{ productId: "ing-carne", quantity: 150 }, { productId: "ing-pan-hamburguesa", quantity: 1 }],
        extras: [{ id: "extra-queso-h", name: "Extra queso", priceDelta: 2000, recipe: [{ productId: "ing-queso", quantity: 30 }] }]
      },
      true,
      "ON_DEMAND"
    );
    const hamburguesa = await ctx.inventory.createProduct(input);

    const sale = await ctx.salesEngine.quickSale({
      cashierId: "c1",
      source: [{
        productId: hamburguesa.id, quantity: 1, price: 20000, name: "Hamburguesa (Extra queso)",
        selectedExtras: [{ id: "extra-queso-h", name: "Extra queso", priceDelta: 2000, recipe: [{ productId: "ing-queso", quantity: 30 }] }]
      }]
    });
    await ctx.salesEngine.registerPayment(sale, "CASH");

    const carne = await ctx.products.findById("ing-carne");
    const queso = await ctx.products.findById("ing-queso");
    expect(carne!.stock).toBe(10000 - 150);
    expect(queso!.stock).toBe(10000 - 30); // extra SUMA a la receta base, no la reemplaza
  });

  it("6. Perro (hot dog) — ingredientes + extras: se crea igual que Hamburguesa", async () => {
    const input = fromWizard(
      {
        name: "Perro", productType: "cocina_receta", categoryId: "cat-comidas", price: 9000, stock: 0, minStock: 0,
        recipe: [{ productId: "ing-salchicha", quantity: 1 }, { productId: "ing-pan-hamburguesa", quantity: 1 }],
        extras: [{ id: "extra-queso-p", name: "Extra queso", priceDelta: 1500, recipe: [{ productId: "ing-queso", quantity: 20 }] }]
      },
      true,
      "ON_DEMAND"
    );
    const perro = await ctx.inventory.createProduct(input);
    expect(perro.trackStock).toBe(false);
    expect(perro.extras?.length).toBe(1);
  });

  it("7. Jugo — solo ingredientes, sin tamaños ni extras", async () => {
    const input = fromWizard(
      {
        name: "Jugo de naranja", productType: "cocina_receta", categoryId: "cat-bebidas", price: 5000, stock: 0, minStock: 0,
        recipe: [{ productId: "ing-naranja", quantity: 300 }]
      },
      true,
      "ON_DEMAND"
    );
    const jugo = await ctx.inventory.createProduct(input);
    expect(jugo.trackStock).toBe(false);
    expect(jugo.sizes).toBeUndefined();
    expect(jugo.extras).toBeUndefined();
  });

  it("8. Batido — ingredientes + tamaños (sin extras)", async () => {
    const input = fromWizard(
      {
        name: "Batido", productType: "cocina_receta", categoryId: "cat-bebidas", price: 7000, stock: 0, minStock: 0,
        recipe: [{ productId: "ing-fruta", quantity: 200 }, { productId: "ing-leche", quantity: 150 }],
        sizes: [
          { id: "size-batido-normal", name: "Normal", priceDelta: 0 },
          { id: "size-batido-grande", name: "Grande", priceDelta: 2500, recipe: [{ productId: "ing-fruta", quantity: 300 }, { productId: "ing-leche", quantity: 220 }] }
        ]
      },
      true,
      "ON_DEMAND"
    );
    const batido = await ctx.inventory.createProduct(input);
    expect(batido.trackStock).toBe(false);
    expect(batido.sizes?.length).toBe(2);
  });

  it("9. Pastel — producción por tandas: al VENDER descuenta su propio stock (no ingredientes otra vez)", async () => {
    const input = fromWizard(
      {
        name: "Pastel", productType: "cocina_receta", categoryId: "cat-panaderia", price: 35000, stock: 0, minStock: 2,
        recipe: [{ productId: "ing-harina", quantity: 300 }, { productId: "ing-azucar", quantity: 150 }]
      },
      true,
      "BATCH"
    );
    expect(computeTracksStock("cocina_receta", true, "BATCH")).toBe(true);

    const pastel = await ctx.inventory.createProduct(input);
    expect(pastel.trackStock).toBe(true); // a diferencia de Café/Pizza (ON_DEMAND), SÍ maneja stock propio

    // Producir 5 pasteles (consume ingredientes UNA vez).
    await ctx.inventory.produceBatch(pastel.id, 5, "yimid");
    const harinaTrasProducir = await ctx.products.findById("ing-harina");
    expect(harinaTrasProducir!.stock).toBe(20000 - 300 * 5);

    // Vender 2 pasteles: debe descontar el STOCK DEL PASTEL, no volver a
    // tocar harina/azúcar (ya se gastaron al producir).
    const sale = await ctx.salesEngine.quickSale({ cashierId: "c1", source: [{ productId: pastel.id, quantity: 2 }] });
    await ctx.salesEngine.registerPayment(sale, "CASH");

    const pastelFinal = await ctx.products.findById(pastel.id);
    const harinaFinal = await ctx.products.findById("ing-harina");
    expect(pastelFinal!.stock).toBe(5 - 2);
    expect(harinaFinal!.stock).toBe(20000 - 300 * 5); // sin cambios respecto a después de producir
  });

  it("10. Pan — producción por tandas, igual que Pastel", async () => {
    const input = fromWizard(
      {
        name: "Pan", productType: "cocina_receta", categoryId: "cat-panaderia", price: 2000, stock: 0, minStock: 10,
        recipe: [{ productId: "ing-harina", quantity: 80 }, { productId: "ing-azucar", quantity: 10 }]
      },
      true,
      "BATCH"
    );
    const pan = await ctx.inventory.createProduct(input);
    expect(pan.trackStock).toBe(true);

    const result = await ctx.inventory.produceBatch(pan.id, 20, "yimid");
    expect(result.product.stock).toBe(20);
  });

  it("11. Helado — stock directo (igual regla que Coca-Cola/Cerveza)", async () => {
    const input = fromWizard(
      { name: "Helado", productType: "inventario", categoryId: "cat-postres", price: 5000, stock: 30, minStock: 5, unit: "unidad" },
      false
    );
    const helado = await ctx.inventory.createProduct(input);
    expect(helado.trackStock).toBe(true);
    expect(helado.recipe).toBeUndefined();
  });

  it("12. Pollo preparado — ingredientes → venta, igual patrón que Café", async () => {
    const input = fromWizard(
      {
        name: "Pollo preparado", productType: "cocina_receta", categoryId: "cat-comidas", price: 22000, stock: 0, minStock: 0,
        recipe: [{ productId: "ing-pollo-crudo", quantity: 400 }]
      },
      true,
      "ON_DEMAND"
    );
    const pollo = await ctx.inventory.createProduct(input);
    expect(pollo.trackStock).toBe(false);

    const sale = await ctx.salesEngine.quickSale({ cashierId: "c1", source: [{ productId: pollo.id, quantity: 3 }] });
    await ctx.salesEngine.registerPayment(sale, "CASH");

    const polloCrudo = await ctx.products.findById("ing-pollo-crudo");
    expect(polloCrudo!.stock).toBe(10000 - 400 * 3);
  });

  it("13. Domicilio — servicio: sin receta, sin stock propio, la venta no toca inventario en absoluto", async () => {
    const input = fromWizard(
      { name: "Domicilio", productType: "servicio", categoryId: "cat-servicios", price: 3000, stock: 0, minStock: 0 },
      false
    );
    expect(computeTracksStock("servicio", false, "ON_DEMAND")).toBe(false);
    expect(visualTypeOf("servicio")).toBe("servicio");

    const domicilio = await ctx.inventory.createProduct(input);
    expect(domicilio.trackStock).toBe(false);
    expect(domicilio.recipe).toBeUndefined();

    const snapshotBefore = await ctx.products.findAll();

    const sale = await ctx.salesEngine.quickSale({ cashierId: "c1", source: [{ productId: domicilio.id, quantity: 1 }] });
    await ctx.salesEngine.registerPayment(sale, "CASH");

    const snapshotAfter = await ctx.products.findAll();
    // Ningún producto (ni siquiera el propio Domicilio) debió cambiar de stock.
    for (const before of snapshotBefore) {
      const after = snapshotAfter.find((p) => p.id === before.id);
      expect(after?.stock).toBe(before.stock);
    }
  });
});