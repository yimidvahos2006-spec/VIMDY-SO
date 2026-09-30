// tests/smoke/auditoria-punto10-inventario-final.test.ts
/* ===========================================================================
   SMOKE TEST — Punto 10: Auditoría final de Inventario VIMDY
   ---------------------------------------------------------------------------
   No prueba funcionalidad nueva. Es el cierre: un solo recorrido continuo,
   con un negocio real (pizzería + panadería en el mismo catálogo), que pasa
   por los 14 pasos del checklist y verifica en cada uno que "lo que el
   usuario hace -> lo que se guarda -> lo que aparece en Inventario -> lo que
   llega a Caja -> lo que aparece en Kardex -> los costos" cuentan la MISMA
   historia.

   1.  Crear producto             -> createProduct
   2.  Editarlo                   -> updateProduct
   3.  Crear receta                -> product.recipe
   4.  Crear tamaños                -> product.sizes (con receta propia)
   5.  Crear extras                 -> product.extras (con receta propia)
   6.  Agregar/quitar stock          -> increaseStock / decreaseStock
   7.  Producir por tandas           -> produceBatch
   8.  Vender                        -> SalesEngine.quickSale + registerPayment
   9.  Cancelar/devolver              -> refundSale / partialRefundSale
   10. Registrar merma                -> decreaseStock con lossCategory
   11. Revisar Kardex                  -> KardexEngine.getHistory
   12. Revisar costo y rentabilidad     -> RecipeEngine.getRecipeCost/getProfitability
   13. Revisar agotado vs. inactivo      -> getStockStatus (Punto 10, fix real)
   14. Consistencia después de cada paso  -> se verifica en cada bloque, no al final
=========================================================================== */

import { describe, it, expect, beforeEach } from "vitest";

import { Category, Product, Sale, CashMovement, KitchenOrder } from "../../src/core/entities/Entities";

import { CartEngine } from "../../src/core/engines/CartEngine";
import { InventoryEngine } from "../../src/core/engines/InventoryEngine";
import { RecipeEngine } from "../../src/core/engines/RecipeEngine";
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

import { getStockStatus } from "../../src/core/utils/productStockStatus";

function buildNegocio() {
  const products = new FakeProductRepository();
  const sales = new InMemoryRepository<Sale>("sales");
  const receipts = new InMemoryRepository("receipts");
  const kitchenOrders = new InMemoryRepository<KitchenOrder>("kitchen_orders");
  const cashMovements = new InMemoryRepository<CashMovement>("cash_movements");
  const customers = new InMemoryRepository("customers");
  const movements = new InMemoryMovementRepository();
  const auditLogs = new InMemoryRepository("audit_logs");
  const categories = new InMemoryRepository<Category>("categories");

  const kardex = new KardexEngine(movements);
  const inventory = new InventoryEngine(products, kardex, undefined, categories);
  const recipe = new RecipeEngine(products);
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

  return { salesEngine, inventory, recipe, kardex, products, cart };
}

describe("Punto 10 — Auditoría final de Inventario VIMDY (recorrido completo)", () => {
  let ctx: ReturnType<typeof buildNegocio>;

  beforeEach(() => {
    ctx = buildNegocio();
  });

  it("recorre los 14 pasos del checklist verificando consistencia en cada uno", async () => {
    /* ---- 1) Crear producto: los insumos (ingredientes) ------------------- */
    const masa = await ctx.inventory.createProduct({
      name: "Masa", categoryId: "cat-insumos", price: 0, purchasePrice: 10,
      stock: 5000, minStock: 500, unit: "g", requiresKitchen: false, trackStock: true
    });
    const salsa = await ctx.inventory.createProduct({
      name: "Salsa", categoryId: "cat-insumos", price: 0, purchasePrice: 20,
      stock: 5000, minStock: 500, unit: "g", requiresKitchen: false, trackStock: true
    });
    const queso = await ctx.inventory.createProduct({
      name: "Queso", categoryId: "cat-insumos", price: 0, purchasePrice: 30,
      stock: 5000, minStock: 500, unit: "g", requiresKitchen: false, trackStock: true
    });
    const tocineta = await ctx.inventory.createProduct({
      name: "Tocineta", categoryId: "cat-insumos", price: 0, purchasePrice: 50,
      stock: 400, minStock: 50, unit: "g", requiresKitchen: false, trackStock: true
    });
    const harinaPan = await ctx.inventory.createProduct({
      name: "Harina de pan", categoryId: "cat-insumos", price: 0, purchasePrice: 5,
      stock: 10000, minStock: 1000, unit: "g", requiresKitchen: false, trackStock: true
    });

    expect(masa.stock).toBe(5000);
    // Consistencia inmediata: el Kardex de Masa ya tiene su entrada inicial.
    expect((await ctx.kardex.getHistory(masa.id)).map((m) => m.type)).toEqual(["INCREASE"]);

    /* ---- 2) Editarlo: cambia precio y descripción de Tocineta ------------ */
    const tocinetaEditada = await ctx.inventory.updateProduct(tocineta.id, {
      name: "Tocineta ahumada",
      categoryId: tocineta.categoryId,
      price: tocineta.price,
      stock: tocineta.stock, // updateProduct no toca stock, ver comentario del método
      minStock: tocineta.minStock,
      purchasePrice: 55, // subió el precio de compra
      trackStock: true
    });
    expect(tocinetaEditada.name).toBe("Tocineta ahumada");
    expect(tocinetaEditada.purchasePrice).toBe(55);
    expect(tocinetaEditada.stock).toBe(400); // updateProduct nunca mueve stock

    /* ---- 3), 4), 5) Crear receta + tamaños + extras: la Pizza ------------ */
    const pizza: Product = await ctx.inventory.createProduct({
      name: "Pizza",
      categoryId: "cat-cocina",
      price: 25000,
      stock: 0,
      minStock: 0,
      requiresKitchen: true,
      productionMode: "ON_DEMAND",
      trackStock: false, // a la orden: no maneja stock propio
      recipe: [ // 3) receta general/base
        { productId: masa.id, quantity: 180 },
        { productId: salsa.id, quantity: 60 },
        { productId: queso.id, quantity: 120 }
      ],
      sizes: [ // 4) tamaños
        { id: "size-personal", name: "Personal", priceDelta: 0 },
        {
          id: "size-grande",
          name: "Grande",
          priceDelta: 12000,
          recipe: [
            { productId: masa.id, quantity: 350 },
            { productId: salsa.id, quantity: 80 },
            { productId: queso.id, quantity: 250 }
          ]
        }
      ],
      extras: [ // 5) extras
        { id: "extra-tocineta", name: "Tocineta", priceDelta: 4000, recipe: [{ productId: tocineta.id, quantity: 40 }] }
      ]
    });
    expect(pizza.sizes).toHaveLength(2);
    expect(pizza.extras).toHaveLength(1);

    /* ---- 6) Agregar/quitar stock: compra de Queso, merma se ve en 10) --- */
    await ctx.inventory.increaseStock(queso.id, 2000, "Compra a proveedor", "duenio", "prov-lacteos", 32);
    let quesoNow = await ctx.products.findById(queso.id);
    expect(quesoNow?.stock).toBe(5000 + 2000);
    expect(quesoNow?.purchasePrice).toBe(32); // getRecipeCost de ahora en más usa este precio

    /* ---- 7) Producir por tandas: Pan de panadería ------------------------ */
    const pan: Product = await ctx.inventory.createProduct({
      name: "Pan",
      categoryId: "cat-panaderia",
      price: 3000,
      stock: 0,
      minStock: 5,
      requiresKitchen: false,
      productionMode: "BATCH",
      trackStock: true, // producto BATCH sí maneja stock propio ya horneado
      recipe: [{ productId: harinaPan.id, quantity: 100 }]
    });

    const tanda = await ctx.inventory.produceBatch(pan.id, 20, "panadero-1");
    expect(tanda.product.stock).toBe(20); // 20 panes horneados, stock propio ya subió
    expect(tanda.consumed).toEqual([{ productId: harinaPan.id, name: "Harina de pan", quantity: 2000 }]);

    const harinaPanNow = await ctx.products.findById(harinaPan.id);
    expect(harinaPanNow?.stock).toBe(10000 - 2000); // se descontó al producir, no al vender

    // Kardex de Pan: entrada inicial (0, no se registra por ser 0) + entrada por tanda.
    const panHistory = await ctx.kardex.getHistory(pan.id);
    expect(panHistory.map((m) => m.type)).toEqual(["INCREASE"]);
    expect(panHistory[0].quantity).toBe(20);

    /* ---- 8) Vender: 1 Pizza Grande + Tocineta, y 3 Panes ------------------ */
    const ventaPizza = await ctx.salesEngine.quickSale({
      cashierId: "cajero-1",
      source: [
        {
          productId: pizza.id,
          quantity: 1,
          price: 25000 + 12000 + 4000,
          name: "Pizza (Grande, Tocineta)",
          selectedSize: {
            id: "size-grande", name: "Grande", priceDelta: 12000,
            recipe: [
              { productId: masa.id, quantity: 350 },
              { productId: salsa.id, quantity: 80 },
              { productId: queso.id, quantity: 250 }
            ]
          },
          selectedExtras: [
            { id: "extra-tocineta", name: "Tocineta", priceDelta: 4000, recipe: [{ productId: tocineta.id, quantity: 40 }] }
          ]
        },
        { productId: pan.id, quantity: 3 }
      ]
    });
    const { sale: pizzaPagada } = await ctx.salesEngine.registerPayment(ventaPizza, "CASH");
    expect(pizzaPagada.status).toBe("PAID");

    // Consistencia: se descontó la receta EFECTIVA (Grande + Tocineta), no
    // la general -- exactamente lo que arregló el Punto 9.
    let masaNow = await ctx.products.findById(masa.id);
    let salsaNow = await ctx.products.findById(salsa.id);
    quesoNow = await ctx.products.findById(queso.id);
    let tocinetaNow = await ctx.products.findById(tocineta.id);
    expect(masaNow?.stock).toBe(5000 - 350);
    expect(salsaNow?.stock).toBe(5000 - 80);
    expect(quesoNow?.stock).toBe(7000 - 250);
    expect(tocinetaNow?.stock).toBe(400 - 40);

    // El Pan (BATCH) se descontó de SU PROPIO stock, no de la harina otra vez.
    const panNow = await ctx.products.findById(pan.id);
    expect(panNow?.stock).toBe(20 - 3);
    expect((await ctx.products.findById(harinaPan.id))?.stock).toBe(10000 - 2000); // intacta

    /* ---- 9) Cancelar/devolver: reembolso parcial de la Pizza -------------- */
    const { sale: ventaConDevolucion } = await ctx.salesEngine.partialRefundSale(
      pizzaPagada.id,
      [{ productId: pizza.id, quantity: 1 }],
      "Cliente se arrepintió",
      "cajero-1"
    );
    expect(ventaConDevolucion.status).not.toBe("REFUNDED"); // los panes siguen vendidos

    masaNow = await ctx.products.findById(masa.id);
    salsaNow = await ctx.products.findById(salsa.id);
    quesoNow = await ctx.products.findById(queso.id);
    tocinetaNow = await ctx.products.findById(tocineta.id);
    // Volvió exactamente la receta efectiva de la pizza devuelta.
    expect(masaNow?.stock).toBe(5000);
    expect(salsaNow?.stock).toBe(5000);
    expect(quesoNow?.stock).toBe(7000);
    expect(tocinetaNow?.stock).toBe(400);
    // El pan (ya cobrado, no devuelto) sigue descontado.
    expect((await ctx.products.findById(pan.id))?.stock).toBe(20 - 3);

    /* ---- 10) Registrar merma: 2 panes se dañaron -------------------------- */
    await ctx.inventory.decreaseStock(pan.id, 2, "2 panes cayeron al piso", "panadero-1", "DAÑO");
    const panTrasMerma = await ctx.products.findById(pan.id);
    expect(panTrasMerma?.stock).toBe(20 - 3 - 2);

    /* ---- 11) Revisar Kardex: historial completo y en orden ---------------- */
    const masaHistory = await ctx.kardex.getHistory(masa.id);
    // INCREASE inicial (5000) -> DECREASE venta (350) -> INCREASE devolución (350).
    expect(masaHistory.map((m) => m.type)).toEqual(["INCREASE", "DECREASE", "INCREASE"]);
    expect(masaHistory[1].quantity).toBe(350);
    expect(masaHistory[2].quantity).toBe(350);

    const panHistoryFinal = await ctx.kardex.getHistory(pan.id);
    // INCREASE tanda (20) -> DECREASE venta (3) -> DECREASE merma (2), con su lossCategory.
    expect(panHistoryFinal.map((m) => m.type)).toEqual(["INCREASE", "DECREASE", "DECREASE"]);
    expect(panHistoryFinal[2].lossCategory).toBe("DAÑO");
    expect(panHistoryFinal[1].lossCategory).toBeUndefined(); // la venta NO es una pérdida

    /* ---- 12) Revisar costo y rentabilidad ---------------------------------- */
    const productMap = new Map(
      [masa, salsa, queso, tocineta, harinaPan, pizza, pan].map((p) => [p.id, p])
    );
    // Refresca queso/tocineta en el mapa con su purchasePrice actualizado.
    productMap.set(queso.id, (await ctx.products.findById(queso.id))!);
    productMap.set(tocineta.id, (await ctx.products.findById(tocineta.id))!);

    const costoPizzaGeneral = ctx.recipe.getRecipeCost(pizza, productMap);
    // Receta general: 180*10 + 60*20 + 120*32(precio nuevo) = 1800+1200+3840 = 6840
    expect(costoPizzaGeneral?.totalCost).toBe(6840);

    const costoPizzaGrandeTocineta = ctx.recipe.getRecipeCost(
      pizza, productMap, pizza.sizes![1], [pizza.extras![0]]
    );
    // Grande: 350*10 + 80*20 + 250*32 = 3500+1600+8000=13100; +Tocineta 40*55=2200 -> 15300
    expect(costoPizzaGrandeTocineta?.totalCost).toBe(15300);

    const rentabilidadPan = ctx.recipe.getProfitability(pan, productMap);
    // Pan: 100*5 = 500 costo; precio 3000; ganancia 2500.
    expect(rentabilidadPan.cost).toBe(500);
    expect(rentabilidadPan.profit).toBe(2500);
    expect(rentabilidadPan.costUnreliable).toBe(false);

    const capacidadPan = ctx.recipe.getProductionCapacity(pan, productMap);
    // Harina disponible real: 10000-2000=8000g / 100g por pan = 80 panes más.
    const harinaFinal = (await ctx.products.findById(harinaPan.id))!;
    productMap.set(harinaPan.id, harinaFinal);
    const capacidadPanReal = ctx.recipe.getProductionCapacity(pan, productMap);
    expect(capacidadPanReal?.maxUnits).toBe(Math.floor(harinaFinal.stock / 100));

    /* ---- 13) Revisar agotado vs. inactivo ---------------------------------- */
    // Producto con stock real en 0 -> "agotado" (de verdad no hay para vender).
    const productoSinStock: Product = { ...masa, stock: 0 };
    expect(getStockStatus(productoSinStock)).toBe("agotado");

    // Producto con stock de sobra pero apagado a mano (active=false) ->
    // "inactivo", NUNCA "normal" -- este es el fix real del Punto 10: antes
    // de la corrección, este caso mostraba "normal" en Inventario mientras
    // Caja ya lo rechazaba con "está inactivo" (SalesEngine.validateInventory).
    // Misma historia en los dos lados ahora.
    const productoInactivoConStock: Product = { ...masa, stock: 5000, active: false };
    expect(getStockStatus(productoInactivoConStock)).toBe("inactivo");
    expect(getStockStatus(productoInactivoConStock)).not.toBe("normal");

    // Un producto trackStock=false (Servicio) sigue siendo "normal" pese a
    // stock=0 -- no se mezcla con el fix de arriba (Regla previa intacta).
    const servicio: Product = { ...masa, stock: 0, trackStock: false };
    expect(getStockStatus(servicio)).toBe("normal");

    // Y trackStock=false + active=false -> sigue siendo "inactivo": el
    // apagado manual manda sobre cualquier otra regla de stock.
    const servicioApagado: Product = { ...masa, stock: 0, trackStock: false, active: false };
    expect(getStockStatus(servicioApagado)).toBe("inactivo");

    /* ---- 14) Consistencia general de cierre -------------------------------- */
    // Todo lo que se vendió/devolvió/produjo/mermó cuadra: el stock actual
    // de cada insumo es exactamente su historial de Kardex sumado.
    for (const p of [masa, salsa, queso, tocineta, harinaPan, pan]) {
      const current = await ctx.products.findById(p.id);
      const history = await ctx.kardex.getHistory(p.id);
      const net = history.reduce(
        (sum, m) => sum + (m.type === "INCREASE" ? m.quantity : -m.quantity),
        0
      );
      expect(current?.stock).toBeCloseTo(net);
    }
  });
});