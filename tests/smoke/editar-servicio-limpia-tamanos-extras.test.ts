// tests/smoke/editar-servicio-limpia-tamanos-extras.test.ts
/* ===========================================================================
   SMOKE TEST — Editar producto: cambiar el tipo a Servicio debe borrar
   tamaños y extras (auditoría "Editar producto", punto 2, 2026-08-07)
   ---------------------------------------------------------------------------
   Bug real encontrado en la auditoría pantalla por pantalla: al editar un
   producto que ya tenía tamaños/extras (ej. una Pizza) y cambiar la tarjeta
   "¿Qué vas a vender?" a Servicio, InventoryDashboard.handleSave() seguía
   aplanando `sizeRows`/`extraRows` -- el estado de las filas del formulario,
   que `handleProductTypeChange()` nunca limpiaba -- y los mandaba igual al
   guardar. El producto quedaba guardado como Servicio pero con tamaños/
   extras fantasma, violando la REGLA #2 DE VIMDY ("un Servicio es un
   concepto de cobro, no un producto físico: nunca tamaños, extras, SKU...").

   Corrección: `handleSave()` ahora gatea la construcción de sizesValue/
   extrasValue con `visualType !== "servicio"` -- la MISMA variable que ya
   decide si la tarjeta "Presentaciones y extras" se muestra -- así que la
   UI y lo que se guarda no pueden volver a desalinearse. Este test prueba
   el contrato a nivel de motor: si el formulario (ya corregido) manda
   sizes:[]/extras:[] al guardar un producto como Servicio, el producto
   resultante NO conserva tamaños/extras viejos, sin importar qué tenía
   antes.
=========================================================================== */

import { describe, it, expect } from "vitest";

import { InventoryEngine, ProductInput } from "../../src/core/engines/InventoryEngine";
import { KardexEngine } from "../../src/core/engines/KardexEngine";
import { FakeProductRepository } from "../fakes/FakeProductRepository";
import { InMemoryMovementRepository } from "../fakes/InMemoryMovementRepository";
import { computeTracksStock } from "../../src/core/utils/productVisualType";

function buildInventory() {
  const products = new FakeProductRepository();
  const kardex = new KardexEngine(new InMemoryMovementRepository());
  return { inventory: new InventoryEngine(products, kardex), products };
}

describe("Smoke: editar un producto con tamaños/extras y cambiar su tipo a Servicio", () => {
  it("el Servicio resultante no conserva tamaños ni extras viejos", async () => {
    const { inventory } = buildInventory();

    const pizza = await inventory.createProduct({
      name: "Pizza",
      categoryId: "cat-comidas",
      price: 25000,
      stock: 0,
      minStock: 0,
      recipe: [{ productId: "ing-masa", quantity: 180 }],
      sizes: [{ id: "s1", name: "Grande", priceDelta: 12000 }],
      extras: [{ id: "e1", name: "Tocineta", priceDelta: 4000 }],
      productionMode: "ON_DEMAND",
      trackStock: false
    } as ProductInput);

    expect(pizza.sizes?.length).toBe(1);
    expect(pizza.extras?.length).toBe(1);

    // Payload que manda el formulario YA CORREGIDO al editar esta Pizza y
    // elegir la tarjeta "Servicio": visualType pasa a "servicio", por lo
    // que sizesValue/extrasValue se construyen vacíos (ver gateo en
    // handleSave), igual que recipeValue ya se limpiaba antes del fix.
    const editadoComoServicio: ProductInput = {
      name: "Pizza",
      categoryId: "cat-comidas",
      price: 25000,
      stock: pizza.stock,
      minStock: 0,
      recipe: [],
      sizes: [],
      extras: [],
      productionMode: undefined,
      requiresKitchen: false,
      trackStock: computeTracksStock("servicio", false, "ON_DEMAND")
    };

    const updated = await inventory.updateProduct(pizza.id, editadoComoServicio);

    expect(updated.recipe).toBeUndefined();
    expect(updated.sizes).toBeUndefined();
    expect(updated.extras).toBeUndefined();
    expect(updated.trackStock).toBe(false);
  });

  it("por contraste: editar sin tocar el tipo SÍ conserva tamaños/extras (no se pierden por accidente)", async () => {
    const { inventory } = buildInventory();

    const pizza = await inventory.createProduct({
      name: "Pizza",
      categoryId: "cat-comidas",
      price: 25000,
      stock: 0,
      minStock: 0,
      sizes: [{ id: "s1", name: "Grande", priceDelta: 12000 }],
      extras: [{ id: "e1", name: "Tocineta", priceDelta: 4000 }],
      productionMode: "ON_DEMAND",
      trackStock: false
    } as ProductInput);

    // Solo cambia el precio -- sigue siendo "preparado", así que
    // sizesValue/extrasValue se siguen aplanando desde las filas reales.
    const editado: ProductInput = {
      name: "Pizza",
      categoryId: "cat-comidas",
      price: 27000,
      stock: pizza.stock,
      minStock: 0,
      sizes: [{ id: "s1", name: "Grande", priceDelta: 12000 }],
      extras: [{ id: "e1", name: "Tocineta", priceDelta: 4000 }],
      productionMode: "ON_DEMAND",
      requiresKitchen: true,
      trackStock: false
    };

    const updated = await inventory.updateProduct(pizza.id, editado);

    expect(updated.price).toBe(27000);
    expect(updated.sizes?.length).toBe(1);
    expect(updated.extras?.length).toBe(1);
  });
});