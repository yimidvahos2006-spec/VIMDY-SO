import { describe, it, expect, vi } from "vitest";
import {
  buildCountLines,
  computeDifferences,
  countProgress,
  estimateCountMinutes,
  isSuspiciousDifference,
  parseCountInput,
  selectProductsForCount,
  type InventoryCountSession,
} from "../../src/core/inventoryCount/inventoryCountLogic";
import { InventoryCountEngine } from "../../src/core/inventoryCount/InventoryCountEngine";
import type { Product } from "../../src/core/entities/Entities";

const p = (over: Partial<Product>): Product =>
  ({ id: "x", name: "X", categoryId: "c1", price: 0, stock: 0, minStock: 0, active: true, ...over }) as Product;

const catalog: Product[] = [
  p({ id: "carne", name: "Carne", stock: 10, purchasePrice: 20000, isIngredient: true, categoryId: "carnes" }),
  p({ id: "sal", name: "Sal", stock: 100, purchasePrice: 10, isIngredient: true, categoryId: "secos" }),
  p({ id: "agua", name: "Agua", stock: 50, purchasePrice: 1000, categoryId: "bebidas" }),
  p({ id: "viejo", name: "Viejo", stock: 5, active: false }),
  p({ id: "servicio", name: "Domicilio", stock: 0, trackStock: false }),
];

describe("selectProductsForCount", () => {
  it("ignora desactivados y los que no manejan stock", () => {
    const ids = selectProductsForCount(catalog, "todo", { mode: "all" }).map((x) => x.id);
    expect(ids.sort()).toEqual(["agua", "carne", "sal"]);
  });
  it("filtra por tipo y categoría", () => {
    expect(selectProductsForCount(catalog, "insumos", { mode: "all" }).map((x) => x.id).sort()).toEqual(["carne", "sal"]);
    expect(selectProductsForCount(catalog, "productos", { mode: "all" }).map((x) => x.id)).toEqual(["agua"]);
    expect(selectProductsForCount(catalog, "todo", { mode: "category", categoryId: "carnes" }).map((x) => x.id)).toEqual(["carne"]);
  });
  it("los de mayor valor: cantidad × costo", () => {
    const top = selectProductsForCount(catalog, "todo", { mode: "top", limit: 2 }).map((x) => x.id);
    expect(top.sort()).toEqual(["agua", "carne"]); // 200000 y 50000; la sal vale 1000
  });
});

describe("computeDifferences", () => {
  it("compara contra el stock actual, ignora lo no contado y lo que ya no existe", () => {
    const lines = buildCountLines(catalog.slice(0, 3)).map((l) =>
      l.productId === "carne" ? { ...l, counted: 8 } : l.productId === "sal" ? { ...l, counted: 100 } : l
    );
    const stock = new Map([["carne", 9], ["sal", 100], ["agua", 50]]);
    const diffs = computeDifferences([...lines, { ...lines[0], productId: "borrado", counted: 1 }], stock);
    expect(diffs).toHaveLength(2);
    const carne = diffs.find((d) => d.line.productId === "carne")!;
    expect(carne.difference).toBe(-1); // 8 contado − 9 actual (se vendió 1 mientras se contaba)
    expect(carne.value).toBe(-20000);
    expect(diffs.find((d) => d.line.productId === "sal")!.difference).toBe(0);
  });
  it("no deja residuos de decimales", () => {
    const line = { ...buildCountLines([catalog[0]])[0], counted: 0.3 };
    expect(computeDifferences([line], new Map([["carne", 0.1]]))[0].difference).toBe(0.2);
  });
});

describe("parseCountInput / countProgress", () => {
  it("acepta coma, vacío y rechaza negativos o texto", () => {
    expect(parseCountInput("5,5")).toBe(5.5);
    expect(parseCountInput(" 3 ")).toBe(3);
    expect(parseCountInput("")).toBeNull();
    expect(parseCountInput("-2")).toBeNull();
    expect(parseCountInput("abc")).toBeNull();
    expect(parseCountInput("0")).toBe(0);
  });
  it("cuenta lo avanzado", () => {
    const lines = buildCountLines(catalog.slice(0, 3)).map((l, i) => (i === 0 ? { ...l, counted: 0 } : l));
    expect(countProgress(lines)).toEqual({ counted: 1, total: 3 });
  });
});

// --- Motor con repositorios de mentira ---
function setupEngine(products: Product[]) {
  const store = new Map<string, InventoryCountSession>();
  const repo: any = {
    save: async (s: InventoryCountSession) => void store.set(s.id, { ...s, version: 1 }),
    update: async (s: InventoryCountSession) => {
      const cur = store.get(s.id);
      if (cur?.status === "CLOSED") throw new Error("COUNT_SESSION_CLOSED");
      store.set(s.id, { ...s, version: (cur?.version ?? 1) + 1 });
    },
    findById: async (id: string) => store.get(id) ?? null,
    findAll: async () => [...store.values()],
  };
  const stock = new Map(products.map((x) => [x.id, x.stock]));
  const applied = new Set<string>();
  const calls: Array<{ kind: string; id: string; qty: number; movementId?: string }> = [];
  const inventory: any = {
    listAll: async () => products.map((x) => ({ ...x, stock: stock.get(x.id)! })),
    increaseStock: vi.fn(async (id: string, qty: number, _r: string, _by: any, _s: any, _pp: any, movementId?: string) => {
      calls.push({ kind: "inc", id, qty, movementId });
      if (movementId && applied.has(movementId)) return; // idempotente, como el RPC
      if (movementId) applied.add(movementId);
      stock.set(id, stock.get(id)! + qty);
    }),
    decreaseStock: vi.fn(async (id: string, qty: number, _r: string, _by: any, _l: any, movementId?: string) => {
      calls.push({ kind: "dec", id, qty, movementId });
      if (movementId && applied.has(movementId)) return;
      if (movementId) applied.add(movementId);
      stock.set(id, stock.get(id)! - qty);
    }),
  };
  return { engine: new InventoryCountEngine(repo, inventory), store, stock, inventory, calls };
}

describe("InventoryCountEngine", () => {
  it("flujo completo: abrir, contar, cerrar y ajustar el stock", async () => {
    const { engine, stock } = setupEngine(catalog);
    const s = await engine.startSession({ kind: "insumos", scope: { mode: "all" }, scopeLabel: "t", blind: true, createdBy: "Ana" });
    expect(s.lines.map((l) => l.productId).sort()).toEqual(["carne", "sal"]);

    await engine.saveCounts(s, s.lines.map((l) => ({ ...l, counted: l.productId === "carne" ? 8 : 103 })));
    const { session, failures } = await engine.closeSession(s.id, "Ana", { carne: "VENCIDO" });

    expect(failures).toEqual([]);
    expect(session.status).toBe("CLOSED");
    expect(stock.get("carne")).toBe(8);
    expect(stock.get("sal")).toBe(103);
    expect(session.lines.find((l) => l.productId === "carne")!.reason).toBe("VENCIDO");
  });

  it("una sesión cerrada no se edita ni se vuelve a cerrar", async () => {
    const { engine } = setupEngine(catalog);
    const s = await engine.startSession({ kind: "todo", scope: { mode: "all" }, scopeLabel: "t", blind: true, createdBy: "Ana" });
    await engine.saveCounts(s, s.lines.map((l) => ({ ...l, counted: l.systemStockAtStart })));
    const { session } = await engine.closeSession(s.id, "Ana");
    await expect(engine.saveCounts(session, session.lines)).rejects.toThrow("COUNT_SESSION_CLOSED");
    await expect(engine.closeSession(s.id, "Ana")).rejects.toThrow("COUNT_SESSION_CLOSED");
  });

  it("si un ajuste falla, la sesión sigue abierta y al reintentar no duplica lo ya aplicado", async () => {
    const { engine, stock, inventory } = setupEngine(catalog);
    const s = await engine.startSession({ kind: "insumos", scope: { mode: "all" }, scopeLabel: "t", blind: true, createdBy: "Ana" });
    await engine.saveCounts(s, s.lines.map((l) => ({ ...l, counted: l.productId === "carne" ? 8 : 103 })));

    // La primera vez, "sal" (aumento) falla.
    const real = inventory.increaseStock.getMockImplementation()!;
    inventory.increaseStock.mockImplementationOnce(async () => { throw new Error("red caída"); });
    const first = await engine.closeSession(s.id, "Ana");
    expect(first.failures.map((f) => f.name)).toEqual(["Sal"]);
    expect(first.session.status).toBe("OPEN");
    expect(stock.get("carne")).toBe(8);

    inventory.increaseStock.mockImplementation(real);
    const second = await engine.closeSession(s.id, "Ana");
    expect(second.failures).toEqual([]);
    expect(second.session.status).toBe("CLOSED");
    expect(stock.get("carne")).toBe(8); // no se descontó dos veces
    expect(stock.get("sal")).toBe(103);
  });

  it("lo no contado no se toca", async () => {
    const { engine, stock } = setupEngine(catalog);
    const s = await engine.startSession({ kind: "insumos", scope: { mode: "all" }, scopeLabel: "t", blind: true, createdBy: "Ana" });
    await engine.saveCounts(s, s.lines.map((l) => (l.productId === "carne" ? { ...l, counted: 7 } : l)));
    await engine.closeSession(s.id, "Ana");
    expect(stock.get("sal")).toBe(100);
    expect(stock.get("carne")).toBe(7);
  });

  it("no abre un conteo sin productos", async () => {
    const { engine } = setupEngine([]);
    await expect(engine.startSession({ kind: "todo", scope: { mode: "all" }, scopeLabel: "t", blind: true, createdBy: "A" })).rejects.toThrow("COUNT_NO_PRODUCTS");
  });
});

describe("estimateCountMinutes", () => {
  it("no estima nada cuando no hay qué contar", () => {
    expect(estimateCountMinutes(0)).toBe(0);
    expect(estimateCountMinutes(-3)).toBe(0);
    expect(estimateCountMinutes(Number.NaN)).toBe(0);
  });

  it("redondea hacia arriba y nunca baja de 1 minuto", () => {
    expect(estimateCountMinutes(1)).toBe(1);
    expect(estimateCountMinutes(4)).toBe(1);
    expect(estimateCountMinutes(5)).toBe(2);
  });

  it("20 cosas son unos 5 minutos", () => {
    expect(estimateCountMinutes(20)).toBe(5);
  });
});

describe("isSuspiciousDifference", () => {
  it("no alerta cuando coincide o la diferencia es pequeña", () => {
    expect(isSuspiciousDifference(10, 10)).toBe(false);
    expect(isSuspiciousDifference(10, 9)).toBe(false);
    expect(isSuspiciousDifference(1, 0)).toBe(false);
  });

  it("alerta cuando cambia a la mitad o más (posible error al digitar)", () => {
    expect(isSuspiciousDifference(100, 1000)).toBe(true);
    expect(isSuspiciousDifference(10, 4)).toBe(true);
    expect(isSuspiciousDifference(4, 2)).toBe(true);
  });

  it("alerta cuando el sistema decía 0 y aparecen 10 o más", () => {
    expect(isSuspiciousDifference(0, 12)).toBe(true);
    expect(isSuspiciousDifference(0, 3)).toBe(false);
  });
});