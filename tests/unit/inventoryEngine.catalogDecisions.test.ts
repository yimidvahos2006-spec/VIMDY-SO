import { describe, expect, it, vi } from "vitest";
import type { Product } from "../../src/core/entities/Entities";
import { InventoryEngine } from "../../src/core/engines/InventoryEngine";

/**
 * Slice 1 (Fase 2): listAll() puede traer la caché al instante; las
 * decisiones de administración del catálogo usan la lectura que espera al
 * servidor (findAllPreferFresh) cuando el repositorio la ofrece.
 */

const p = (id: string, name: string, extra: Partial<Product> = {}): Product =>
  ({ id, name, stock: 1, price: 1, categoryId: "c", active: true, ...extra }) as unknown as Product;

function engineWith(repo: Record<string, unknown>) {
  return new InventoryEngine(repo as never, undefined as never, undefined as never, undefined as never);
}

describe("InventoryEngine — lectura rápida para pintar, lectura fresca para decidir", () => {
  it("listAll() usa findAll (rápido) y no espera al servidor", async () => {
    const findAll = vi.fn().mockResolvedValue([p("a", "Cerveza")]);
    const findAllPreferFresh = vi.fn().mockResolvedValue([]);
    const engine = engineWith({ findAll, findAllPreferFresh });
    expect((await engine.listAll()).map((x) => x.id)).toEqual(["a"]);
    expect(findAllPreferFresh).not.toHaveBeenCalled();
  });

  it("deleteAllByKind borra lo que hay en el servidor, no solo lo que veía la caché", async () => {
    const deleteMany = vi.fn().mockResolvedValue(undefined);
    const engine = engineWith({
      findAll: vi.fn().mockResolvedValue([p("a", "A")]), // caché vieja
      findAllPreferFresh: vi.fn().mockResolvedValue([p("a", "A"), p("b", "B")]), // servidor
      deleteMany
    });
    await engine.deleteAllByKind("products");
    expect(deleteMany).toHaveBeenCalledWith(["a", "b"]);
  });

  it("deleteProduct detecta que es ingrediente de una receta creada en otro equipo", async () => {
    const engine = engineWith({
      exists: vi.fn().mockResolvedValue(true),
      findAll: vi.fn().mockResolvedValue([p("ing", "Queso")]), // caché sin la receta nueva
      findAllPreferFresh: vi
        .fn()
        .mockResolvedValue([p("ing", "Queso"), p("pizza", "Pizza", { recipe: [{ productId: "ing", quantity: 1 }] } as never)]),
      findById: vi.fn()
    });
    await expect(engine.deleteProduct("ing")).rejects.toThrow("PRODUCT_IN_USE");
  });

  it("si el repositorio no ofrece findAllPreferFresh, usa findAll (compatibilidad con dobles de prueba)", async () => {
    const deleteMany = vi.fn().mockResolvedValue(undefined);
    const engine = engineWith({ findAll: vi.fn().mockResolvedValue([p("a", "A")]), deleteMany });
    await engine.deleteAllByKind("products");
    expect(deleteMany).toHaveBeenCalledWith(["a"]);
  });
});