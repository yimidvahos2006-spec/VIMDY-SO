import { beforeEach, describe, expect, it, vi } from "vitest";
import { InventoryCountEngine } from "../../src/core/inventoryCount/InventoryCountEngine";
import type { IInventoryCountGateway } from "../../src/core/inventoryCount/IInventoryCountGateway";
import type { CountLine, InventoryCountSession } from "../../src/core/inventoryCount/inventoryCountLogic";

const config = vi.hoisted(() => ({ allowNegativeStock: false }));
vi.mock("../../src/core/store/companyConfigStore", () => ({
  companyConfigStore: { get: () => ({ allowNegativeStock: config.allowNegativeStock }) }
}));

/**
 * El conteo vive en el SERVIDOR: el motor solo reenvía. Estos tests fijan ese contrato:
 * nunca viajan cifras del sistema, los errores del servidor se propagan (sin improvisar
 * con datos locales) y cerrar respeta "permitir stock negativo".
 */
const session = (id: string, createdAt: string): InventoryCountSession => ({
  id,
  status: "OPEN",
  blind: true,
  scopeLabel: "todo",
  kind: "todo",
  createdAt: new Date(createdAt),
  createdBy: "ana",
  lines: []
});

function makeGateway() {
  const gateway = {
    list: vi.fn(async () => [] as InventoryCountSession[]),
    get: vi.fn(async () => null as InventoryCountSession | null),
    start: vi.fn(async () => session("s1", "2026-10-23T10:00:00Z")),
    save: vi.fn(async () => session("s1", "2026-10-23T10:00:00Z")),
    review: vi.fn(async () => []),
    close: vi.fn(async () => ({ session: session("s1", "2026-10-23T10:00:00Z"), failures: [] }))
  };
  return { gateway, engine: new InventoryCountEngine(gateway as unknown as IInventoryCountGateway) };
}

describe("InventoryCountEngine (delegado al servidor)", () => {
  beforeEach(() => {
    config.allowNegativeStock = false;
  });

  it("lista las sesiones de la más nueva a la más vieja", async () => {
    const { gateway, engine } = makeGateway();
    gateway.list.mockResolvedValue([session("a", "2026-10-01T00:00:00Z"), session("c", "2026-10-03T00:00:00Z"), session("b", "2026-10-02T00:00:00Z")]);
    expect((await engine.listSessions()).map((s) => s.id)).toEqual(["c", "b", "a"]);
  });

  it("abrir un conteo reenvía los parámetros tal cual", async () => {
    const { gateway, engine } = makeGateway();
    const params = { kind: "todo" as const, scope: { mode: "all" as const }, scopeLabel: "todo", blind: true, createdBy: "ana" };
    await engine.startSession(params);
    expect(gateway.start).toHaveBeenCalledWith(params);
  });

  it("guardar envía SOLO producto y lo contado (nunca cifras del sistema)", async () => {
    const { gateway, engine } = makeGateway();
    const lines: CountLine[] = [
      { productId: "a", name: "A", categoryId: "c", counted: 7, systemStockAtStart: 10, systemStockAtCount: 10, unitCost: 500 },
      { productId: "b", name: "B", categoryId: "c", counted: null }
    ];
    await engine.saveCounts(session("s1", "2026-10-23T10:00:00Z"), lines, { recountedIds: ["a"] });
    expect(gateway.save).toHaveBeenCalledWith(
      "s1",
      [
        { productId: "a", counted: 7 },
        { productId: "b", counted: null }
      ],
      ["a"]
    );
  });

  it("sin recontados envía una lista vacía", async () => {
    const { gateway, engine } = makeGateway();
    await engine.saveCounts(session("s1", "2026-10-23T10:00:00Z"), []);
    expect(gateway.save).toHaveBeenCalledWith("s1", [], []);
  });

  it("si el servidor rechaza revisar o cerrar (COUNT_FORBIDDEN), el error llega intacto", async () => {
    const { gateway, engine } = makeGateway();
    gateway.review.mockRejectedValue(new Error("COUNT_FORBIDDEN"));
    gateway.close.mockRejectedValue(new Error("COUNT_FORBIDDEN"));
    await expect(engine.reviewSession("s1")).rejects.toThrow("COUNT_FORBIDDEN");
    await expect(engine.closeSession("s1", "ana")).rejects.toThrow("COUNT_FORBIDDEN");
  });

  it("si el servidor no responde, abrir falla (no se improvisa con datos locales)", async () => {
    const { gateway, engine } = makeGateway();
    gateway.start.mockRejectedValue(new Error("COUNT_SERVER_ERROR"));
    await expect(
      engine.startSession({ kind: "todo", scope: { mode: "all" }, scopeLabel: "todo", blind: true, createdBy: "ana" })
    ).rejects.toThrow("COUNT_SERVER_ERROR");
  });

  it("cerrar pasa los motivos y respeta 'permitir stock negativo'", async () => {
    const { gateway, engine } = makeGateway();
    await engine.closeSession("s1", "ana", { a: "DAÑO" });
    expect(gateway.close).toHaveBeenLastCalledWith({ sessionId: "s1", performedBy: "ana", reasons: { a: "DAÑO" }, allowNegative: false });

    config.allowNegativeStock = true;
    await engine.closeSession("s1", "ana");
    expect(gateway.close).toHaveBeenLastCalledWith({ sessionId: "s1", performedBy: "ana", reasons: {}, allowNegative: true });
  });
});