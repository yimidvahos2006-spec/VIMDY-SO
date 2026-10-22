import { describe, it, expect, vi } from "vitest";
import { InventoryEngine } from "../../src/core/engines/InventoryEngine";
import { FakeProductRepository } from "../fakes/FakeProductRepository";

/**
 * Crear un insumo desde el formulario de receta no debe bajar el catálogo
 * completo (con fotos) ni esperar viajes de red innecesarios.
 */
describe("InventoryEngine.createProduct — opciones de velocidad", () => {
  it("con knownProducts no vuelve a leer el catálogo, pero sigue rechazando nombres repetidos", async () => {
    const repository = new FakeProductRepository();
    const findAll = vi.spyOn(repository, "findAll");
    const engine = new InventoryEngine(repository);
    const known = [{ id: "x1", name: "Carne", isIngredient: true, active: true }] as any;

    await expect(
      engine.createProduct({ name: " carne ", isIngredient: true } as any, undefined, { knownProducts: known })
    ).rejects.toThrow("NOMBRE_DUPLICADO");
    expect(findAll).not.toHaveBeenCalled();

    const created = await engine.createProduct({ name: "Frijol", isIngredient: true } as any, undefined, {
      knownProducts: known
    });
    expect(created.name).toBe("Frijol");
    expect(findAll).not.toHaveBeenCalled();
  });

  it("un insumo no consulta la categoría y siempre queda sin cocina", async () => {
    const repository = new FakeProductRepository();
    const findById = vi.fn(async () => ({ id: "c1", requiresKitchenByDefault: true }));
    const engine = new InventoryEngine(repository, undefined, undefined, { findById } as any);

    const created = await engine.createProduct({ name: "Sal", isIngredient: true, categoryId: "c1" } as any);

    expect(findById).not.toHaveBeenCalled();
    expect(created.requiresKitchen).toBe(false);
  });

  it("un producto normal sí usa el valor por defecto de la categoría", async () => {
    const repository = new FakeProductRepository();
    const findById = vi.fn(async () => ({ id: "c1", requiresKitchenByDefault: true }));
    const engine = new InventoryEngine(repository, undefined, undefined, { findById } as any);

    const created = await engine.createProduct({ name: "Hamburguesa", price: 15000, categoryId: "c1" } as any);

    expect(findById).toHaveBeenCalledTimes(1);
    expect(created.requiresKitchen).toBe(true);
  });

  it("deferAudit devuelve el producto sin esperar la auditoría; sin deferAudit sí espera", async () => {
    const repository = new FakeProductRepository();
    let release: () => void = () => undefined;
    const slowAudit = {
      log: vi.fn(
        () =>
          new Promise<void>((resolve) => {
            release = resolve;
          })
      )
    };
    const engine = new InventoryEngine(repository, undefined, undefined, undefined, slowAudit as any);

    const created = await engine.createProduct({ name: "Harina", isIngredient: true } as any, undefined, {
      deferAudit: true
    });
    expect(created.name).toBe("Harina");
    expect(slowAudit.log).toHaveBeenCalledTimes(1);

    let waited = true;
    const pending = engine.createProduct({ name: "Aceite", isIngredient: true } as any).then(() => {
      waited = false;
    });
    // Espera a que la segunda creación llegue al registro de auditoría y se quede esperándolo.
    await vi.waitFor(() => expect(slowAudit.log).toHaveBeenCalledTimes(2));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(waited).toBe(true);
    release();
    await pending;
    expect(waited).toBe(false);
  });
});