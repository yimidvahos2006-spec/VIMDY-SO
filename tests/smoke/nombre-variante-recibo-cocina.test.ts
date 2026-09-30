// tests/smoke/nombre-variante-recibo-cocina.test.ts
/* ===========================================================================
   SMOKE TEST — Nombre con tamaño/extras en recibo y comanda de cocina
   ---------------------------------------------------------------------------
   PASO 4A del plan de VIMDY: antes de este fix, una Pizza vendida como
   "Grande + Tocineta" llegaba al recibo del cliente, al recibo de mesas y a
   la pantalla/comanda de cocina mostrando solo "Pizza" -- porque esos 4
   puntos reconstruían el nombre buscando product.name en el catálogo en vez
   de usar item.selectedSize/item.selectedExtras (que sí viajan completos y
   congelados con la venta).

   Este test cubre:
     1. buildVariantDisplayName (la única fuente de verdad del nombre con
        variante, ver src/core/utils/variantDisplayName.ts): sin variante,
        con tamaño, con extras, y con tamaño + varios extras juntos.
     2. enrichKitchenOrders (cocina y comanda impresa comparten esta misma
        función): que una comanda real con selectedSize/selectedExtras
        resuelva productName con la variante incluida, y no solo el nombre
        base del catálogo.
=========================================================================== */

import { describe, it, expect } from "vitest";

import { buildVariantDisplayName } from "../../src/core/utils/variantDisplayName";
import { enrichKitchenOrders } from "../../src/core/services/kitchenOrderEnrichment";
import { KitchenOrder, Product } from "../../src/core/entities/Entities";

describe("Smoke: nombre con tamaño/extras (buildVariantDisplayName)", () => {
  it("producto sin tamaño ni extras: el nombre queda igual al base", () => {
    expect(buildVariantDisplayName("Pizza", null, null)).toBe("Pizza");
    expect(buildVariantDisplayName("Pizza", undefined, undefined)).toBe("Pizza");
    expect(buildVariantDisplayName("Pizza", null, [])).toBe("Pizza");
  });

  it("producto con tamaño: agrega el nombre del tamaño entre paréntesis", () => {
    const grande = { id: "size-grande", name: "Grande" };
    expect(buildVariantDisplayName("Pizza", grande, null)).toBe("Pizza (Grande)");
  });

  it("producto con tamaño + varios extras: los junta en orden, separados por coma", () => {
    const grande = { id: "size-grande", name: "Grande" };
    const extras = [
      { id: "extra-tocineta", name: "Tocineta" },
      { id: "extra-queso", name: "Queso" }
    ];

    expect(buildVariantDisplayName("Pizza", grande, extras)).toBe("Pizza (Grande, Tocineta, Queso)");
  });

  it("producto solo con extras (sin tamaño elegido)", () => {
    const extras = [{ id: "extra-jalapenos", name: "Jalapeños" }];
    expect(buildVariantDisplayName("Hamburguesa", null, extras)).toBe("Hamburguesa (Jalapeños)");
  });
});

describe("Smoke: cocina y comanda impresa muestran el nombre con variante", () => {
  it("enrichKitchenOrders arma productName con selectedSize/selectedExtras, no solo el nombre del catálogo", () => {
    const pizza: Product = {
      id: "prod-pizza",
      name: "Pizza",
      price: 20000,
      categoryId: "cat-comida",
      trackStock: true
    } as Product;

    const order: KitchenOrder = {
      id: "order-1",
      status: "PENDIENTE",
      createdAt: new Date(),
      origin: "Mostrador",
      items: [
        {
          productId: "prod-pizza",
          quantity: 1,
          price: 32000,
          selectedSize: { id: "size-grande", name: "Grande", priceDelta: 8000 },
          selectedExtras: [{ id: "extra-tocineta", name: "Tocineta", priceDelta: 4000 }]
        }
      ]
    };

    const [view] = enrichKitchenOrders([order], { products: [pizza], tables: [], users: [] });

    expect(view.items[0].productName).toBe("Pizza (Grande, Tocineta)");
  });

  it("un producto sin variante sigue mostrando solo su nombre base, como antes", () => {
    const gaseosa: Product = {
      id: "prod-gaseosa",
      name: "Gaseosa",
      price: 5000,
      categoryId: "cat-bebidas",
      trackStock: true
    } as Product;

    const order: KitchenOrder = {
      id: "order-2",
      status: "PENDIENTE",
      createdAt: new Date(),
      origin: "Mostrador",
      items: [{ productId: "prod-gaseosa", quantity: 2, price: 5000 }]
    };

    const [view] = enrichKitchenOrders([order], { products: [gaseosa], tables: [], users: [] });

    expect(view.items[0].productName).toBe("Gaseosa");
  });
});