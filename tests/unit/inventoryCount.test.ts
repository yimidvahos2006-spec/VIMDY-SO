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

describe("InventoryCountEngine: ventas durante el conteo", () => {
  const start = (engine: InventoryCountEngine) =>
    engine.startSession({ kind: "insumos", scope: { mode: "all" }, scopeLabel: "t", blind: true, createdBy: "Ana" });
  const countOnly = (s: InventoryCountSession, id: string, n: number) =>
    s.lines.map((l) => ({ ...l, counted: l.productId === id ? n : null }));

  it("contar justo lo que dice el sistema no ajusta nada, aunque después se venda", async () => {
    const { engine, stock, calls } = setupEngine(catalog);
    const s = await start(engine);
    await engine.saveCounts(s, countOnly(s, "carne", 10)); // sistema decía 10
    stock.set("carne", 7); // se venden 3 mientras se sigue contando
    const { session, failures } = await engine.closeSession(s.id, "Ana");
    expect(failures).toEqual([]);
    expect(session.status).toBe("CLOSED");
    expect(stock.get("carne")).toBe(7); // las ventas se respetan
    expect(calls.filter((x) => x.id === "carne")).toEqual([]);
  });

  it("si se vendió ANTES de digitar y lo contado cuadra, la diferencia es 0", async () => {
    const { engine, stock, calls } = setupEngine(catalog);
    const s = await start(engine);
    stock.set("carne", 8); // se venden 2 después de abrir el conteo
    await engine.saveCounts(s, countOnly(s, "carne", 8)); // y se cuentan 8 en la nevera
    await engine.closeSession(s.id, "Ana");
    expect(stock.get("carne")).toBe(8);
    expect(calls.filter((x) => x.id === "carne")).toEqual([]);
  });

  it("un faltante real se descuenta y las ventas posteriores se conservan", async () => {
    const { engine, stock } = setupEngine(catalog);
    const s = await start(engine);
    stock.set("carne", 8); // venta antes de contar
    await engine.saveCounts(s, countOnly(s, "carne", 7)); // sistema 8, hay 7 → falta 1
    stock.set("carne", 7); // se vende 1 más después de contar
    await engine.closeSession(s.id, "Ana");
    expect(stock.get("carne")).toBe(6); // 7 contados − 1 vendido después
  });

  it("recontar cambia la foto al stock de ese momento", async () => {
    const { engine, stock } = setupEngine(catalog);
    const s = await start(engine);
    const first = await engine.saveCounts(s, countOnly(s, "carne", 8));
    expect(first.lines.find((l) => l.productId === "carne")?.systemStockAtCount).toBe(10);
    stock.set("carne", 9);
    const second = await engine.saveCounts(first, countOnly(first, "carne", 7));
    expect(second.lines.find((l) => l.productId === "carne")?.systemStockAtCount).toBe(9);
  });

  it("una cantidad que no cambia conserva su foto original", async () => {
    const { engine, stock } = setupEngine(catalog);
    const s = await start(engine);
    const first = await engine.saveCounts(s, countOnly(s, "carne", 10));
    stock.set("carne", 6);
    const again = await engine.saveCounts(first, countOnly(first, "carne", 10));
    expect(again.lines.find((l) => l.productId === "carne")?.systemStockAtCount).toBe(10);
  });

  it("la pantalla no puede imponer su propia foto", async () => {
    const { engine } = setupEngine(catalog);
    const s = await start(engine);
    const forged = s.lines.map((l) => ({ ...l, counted: l.productId === "carne" ? 5 : null, systemStockAtCount: 999 }));
    const saved = await engine.saveCounts(s, forged);
    expect(saved.lines.find((l) => l.productId === "carne")?.systemStockAtCount).toBe(10);
  });

  it("al borrar la cantidad se borra su foto", async () => {
    const { engine } = setupEngine(catalog);
    const s = await start(engine);
    const first = await engine.saveCounts(s, countOnly(s, "carne", 4));
    const cleared = await engine.saveCounts(first, countOnly(first, "carne", null as unknown as number).map((l) => ({ ...l, counted: null })));
    const line = cleared.lines.find((l) => l.productId === "carne");
    expect(line?.counted).toBeNull();
    expect(line?.systemStockAtCount).toBeUndefined();
  });

  it("un conteo antiguo sin foto se calcula contra el stock actual, como antes", async () => {
    const { engine, stock, store } = setupEngine(catalog);
    const s = await start(engine);
    const saved = await engine.saveCounts(s, countOnly(s, "carne", 8));
    const old = store.get(s.id)!;
    store.set(s.id, { ...old, lines: saved.lines.map((l) => ({ ...l, systemStockAtCount: undefined })) });
    await engine.closeSession(s.id, "Ana");
    expect(stock.get("carne")).toBe(8);
  });
});

describe("computeDifferences con foto del momento", () => {
  it("compara contra la foto y reporta cuánto cambió el stock desde entonces", () => {
    const line = { productId: "a", name: "A", categoryId: "c", systemStockAtStart: 10, counted: 8, systemStockAtCount: 10 } as any;
    const [d] = computeDifferences([line], new Map([["a", 7]]));
    expect(d.systemStock).toBe(10);
    expect(d.difference).toBe(-2);
    expect(d.stockNow).toBe(7);
    expect(d.movedSince).toBe(-3);
  });
});