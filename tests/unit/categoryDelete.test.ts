import { describe, it, expect } from "vitest";
import { CategoryEngine, UNCATEGORIZED_ID } from "../../src/core/engines/CategoryEngine";
import { RecentDeletes } from "../../src/core/utils/recentDeletes";
import { InMemoryRepository } from "../fakes/InMemoryRepository";

function setup() {
  const categories = new InMemoryRepository<any>("categories");
  const products = new InMemoryRepository<any>("products");
  const engine = new CategoryEngine(categories as any, products as any);
  return { categories, products, engine };
}

const cat = (id: string) => ({ id, name: `Cat ${id}`, active: true, createdAt: new Date() });
const prod = (id: string, categoryId: string, active?: boolean) => ({
  id,
  name: `Prod ${id}`,
  categoryId,
  price: 1000,
  stock: 0,
  minStock: 0,
  active,
  lastUpdated: new Date()
});

describe("CategoryEngine.delete", () => {
  it("borra una categoría sin productos", async () => {
    const { categories, engine } = setup();
    categories.seed(cat("c1"));
    await engine.delete("c1");
    expect(await categories.exists("c1")).toBe(false);
  });

  it("bloquea y dice cuántos productos activos la usan", async () => {
    const { categories, products, engine } = setup();
    categories.seed(cat("c1"));
    products.seed(prod("p1", "c1"));
    products.seed(prod("p2", "c1", true));
    await expect(engine.delete("c1")).rejects.toThrow("CATEGORY_IN_USE:2");
    expect(await categories.exists("c1")).toBe(true);
  });

  it("si solo quedan productos desactivados, los pasa a Sin categoría y borra la categoría", async () => {
    const { categories, products, engine } = setup();
    categories.seed(cat("c1"));
    products.seed(prod("p1", "c1", false));
    await engine.delete("c1");
    expect(await categories.exists("c1")).toBe(false);
    const kept = await products.findById("p1");
    expect(kept?.categoryId).toBe(UNCATEGORIZED_ID);
    expect(kept?.active).toBe(false);
  });

  it("al borrar el último producto activo la categoría queda libre al instante", async () => {
    const { categories, products, engine } = setup();
    categories.seed(cat("c1"));
    products.seed(prod("p1", "c1"));
    await expect(engine.delete("c1")).rejects.toThrow("CATEGORY_IN_USE");
    await products.delete("p1");
    await engine.delete("c1");
    expect(await categories.exists("c1")).toBe(false);
  });

  it("no toca productos de otras categorías", async () => {
    const { categories, products, engine } = setup();
    categories.seed(cat("c1"));
    categories.seed(cat("c2"));
    products.seed(prod("p1", "c1", false));
    products.seed(prod("p2", "c2"));
    await engine.delete("c1");
    expect((await products.findById("p2"))?.categoryId).toBe("c2");
  });

  it("categoría inexistente", async () => {
    const { engine } = setup();
    await expect(engine.delete("nada")).rejects.toThrow("CATEGORY_NOT_FOUND");
  });
});

describe("RecentDeletes", () => {
  it("una lista vieja no devuelve un producto que se acaba de borrar", () => {
    const deletes = new RecentDeletes(1000);
    deletes.mark(["b"], 0);
    const stale = [{ id: "a" }, { id: "b" }];
    expect(deletes.filter(stale, 10).map((p) => p.id)).toEqual(["a"]);
    expect(deletes.has("b", 10)).toBe(true);
  });

  it("pasado el tiempo ya no recuerda el borrado", () => {
    const deletes = new RecentDeletes(1000);
    deletes.mark(["b"], 0);
    expect(deletes.has("b", 5000)).toBe(false);
    expect(deletes.filter([{ id: "b" }], 5000)).toHaveLength(1);
  });

  it("sin borrados devuelve la lista igual", () => {
    const deletes = new RecentDeletes();
    expect(deletes.filter([{ id: "a" }])).toEqual([{ id: "a" }]);
  });
});
