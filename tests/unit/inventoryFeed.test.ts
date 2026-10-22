import { describe, it, expect, vi } from "vitest";
import { buildInventoryFeed, INVENTORY_AUDIT_ACTIONS, INVENTORY_AUDIT_MODULE, reasonLabel } from "../../src/core/utils/inventoryFeed";
import { describeMovement } from "../../src/core/utils/movementDisplay";
import { InventoryEngine } from "../../src/core/engines/InventoryEngine";
import { FakeProductRepository } from "../fakes/FakeProductRepository";
import type { AuditLog, InventoryMovement } from "../../src/core/entities/Entities";

const T0 = new Date("2026-10-22T15:00:00Z").getTime();
const at = (minAgo: number) => new Date(T0 - minAgo * 60_000);

const mv = (over: Partial<InventoryMovement>): InventoryMovement =>
  ({ id: "m", productId: "p", productName: "Queso", quantity: 5, date: at(0), type: "INCREASE", reason: "Compra", ...over }) as InventoryMovement;
const audit = (over: Partial<AuditLog>): AuditLog =>
  ({ id: "a", actorId: "u", action: INVENTORY_AUDIT_ACTIONS.deleted, module: INVENTORY_AUDIT_MODULE, description: 'Eliminaste el producto "X"', date: at(0), ...over }) as AuditLog;
const nameOf = (m: InventoryMovement) => m.productName ?? "?";

describe("buildInventoryFeed", () => {
  it("junta stock y eventos del catálogo, lo más nuevo primero", () => {
    const feed = buildInventoryFeed(
      [mv({ id: "m1", date: at(30) })],
      [audit({ id: "a1", date: at(5), description: 'Eliminaste el producto "Pan"' })],
      nameOf
    );
    expect(feed.map((f) => f.title)).toEqual(['Eliminaste el producto "Pan"', "Agregaste Queso"]);
    expect(feed[0]).toMatchObject({ kind: "event", tone: "down" });
    expect(feed[1]).toMatchObject({ kind: "stock", amount: "+5" });
  });

  it("ignora auditoría de otros módulos y acciones desconocidas", () => {
    const feed = buildInventoryFeed([], [audit({ module: "ventas" }), audit({ id: "b", action: "OTRA" })], nameOf);
    expect(feed).toEqual([]);
  });

  it("resume una importación de 2.000 productos en una línea (y no pierde las demás)", () => {
    const moves = Array.from({ length: 2000 }, (_, i) => mv({ id: `i${i}`, quantity: 3, reason: "Stock inicial", date: at(60) }));
    moves.push(mv({ id: "sale", type: "DECREASE", quantity: 2, reason: "Venta", date: at(10) }));
    const feed = buildInventoryFeed(moves, [], nameOf);
    expect(feed).toHaveLength(2);
    expect(feed[0].title).toBe("Vendiste Queso");
    expect(feed[1]).toMatchObject({ title: "Stock inicial de 2.000 productos", amount: "+6.000", tone: "up" });
  });

  it("no resume cuando son pocos, ni cuando hay pausas largas entre ellos", () => {
    const few = Array.from({ length: 4 }, (_, i) => mv({ id: `f${i}`, reason: "Stock inicial", date: at(i) }));
    expect(buildInventoryFeed(few, [], nameOf)).toHaveLength(4);
    const spread = Array.from({ length: 6 }, (_, i) => mv({ id: `s${i}`, reason: "Stock inicial", date: at(i * 30) }));
    expect(buildInventoryFeed(spread, [], nameOf)).toHaveLength(6);
  });

  it("resume borrados seguidos: 'Eliminaste 8 productos'", () => {
    const audits = Array.from({ length: 8 }, (_, i) => audit({ id: `d${i}`, date: at(i) }));
    const feed = buildInventoryFeed([], audits, nameOf);
    expect(feed).toHaveLength(1);
    expect(feed[0]).toMatchObject({ title: "Eliminaste 8 productos", tone: "down" });
  });

  it("'Eliminaste todos' nunca se esconde dentro de un resumen", () => {
    const audits = [
      audit({ id: "all", action: INVENTORY_AUDIT_ACTIONS.deletedAll, description: "Eliminaste todos los productos (1.802)" }),
      ...Array.from({ length: 6 }, (_, i) => audit({ id: `d${i}`, date: at(i + 1) }))
    ];
    const titles = buildInventoryFeed([], audits, nameOf).map((f) => f.title);
    expect(titles).toContain("Eliminaste todos los productos (1.802)");
    expect(titles).toContain("Eliminaste 6 productos");
  });
});

describe("textos de movimientos", () => {
  it("producción y traslados tienen su propio verbo", () => {
    expect(describeMovement({ type: "INCREASE", reason: "Producción por tanda 12" }, "Pan").title).toBe("Produjiste Pan");
    expect(describeMovement({ type: "DECREASE", reason: "Producción por tanda 12 (consumo de ingrediente)" }, "Harina").title).toBe("Usaste Harina en producción");
    expect(describeMovement({ type: "DECREASE", reason: "Transferencia enviada a otra sucursal" }, "Pan").title).toBe("Enviaste Pan");
    expect(describeMovement({ type: "INCREASE", reason: "Transferencia recibida de otra sucursal" }, "Pan").title).toBe("Recibiste Pan");
    expect(describeMovement({ type: "INCREASE", reason: "Stock inicial" }, "Queso").title).toBe("Agregaste Queso");
  });
  it("reasonLabel vuelve legibles los códigos internos", () => {
    expect(reasonLabel("AJUSTE_ADMINISTRATIVO")).toBe("Ajuste administrativo");
    expect(reasonLabel("sale")).toBe("Venta");
    expect(reasonLabel("Stock inicial")).toBe("Stock inicial");
  });
});

describe("InventoryEngine deja rastro en el panel", () => {
  const setup = () => {
    const repository = new FakeProductRepository();
    const log = vi.fn(async () => ({}));
    const engine = new InventoryEngine(repository, undefined, undefined, undefined, { log });
    return { repository, log, engine };
  };
  const base = { name: "Pan", categoryId: "c", price: 1000, minStock: 0, stock: 0, active: true } as any;

  it("registra crear, editar precio, desactivar y eliminar", async () => {
    const { engine, log } = setup();
    const p = await engine.createProduct(base);
    await engine.updateProduct(p.id, { ...base, price: 2000 });
    await engine.updateProduct(p.id, { ...base, price: 2000, active: false });
    await engine.deleteProduct(p.id);
    const calls = log.mock.calls.map((c: any[]) => [c[1], c[3]]);
    expect(calls).toEqual([
      [INVENTORY_AUDIT_ACTIONS.created, 'Creaste el producto "Pan"'],
      [INVENTORY_AUDIT_ACTIONS.updated, 'Editaste "Pan": precio: $1.000 → $2.000'],
      [INVENTORY_AUDIT_ACTIONS.deactivated, 'Desactivaste el producto "Pan"'],
      [INVENTORY_AUDIT_ACTIONS.deleted, 'Eliminaste el producto "Pan"']
    ]);
    expect(log.mock.calls.every((c: any[]) => c[2] === INVENTORY_AUDIT_MODULE)).toBe(true);
  });

  it("no registra nada si no cambió nada, y 'Eliminar todos' deja UNA sola línea", async () => {
    const { engine, log } = setup();
    const a = await engine.createProduct(base);
    await engine.createProduct({ ...base, name: "Leche" });
    log.mockClear();
    await engine.updateProduct(a.id, base);
    expect(log).not.toHaveBeenCalled();
    await engine.deleteAllByKind("products");
    expect(log).toHaveBeenCalledTimes(1);
    expect(log.mock.calls[0][3]).toBe("Eliminaste todos los productos (2)");
  });

  it("si la auditoría falla, la operación igual se completa", async () => {
    const repository = new FakeProductRepository();
    const engine = new InventoryEngine(repository, undefined, undefined, undefined, {
      log: async () => {
        throw new Error("sin permiso");
      }
    });
    await expect(engine.createProduct(base)).resolves.toMatchObject({ name: "Pan" });
  });
});