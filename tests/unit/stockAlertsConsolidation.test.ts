import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Product } from "../../src/core/entities/Entities";

const repo = vi.hoisted(() => ({
  save: vi.fn(async () => undefined),
  delete: vi.fn(async () => undefined),
  deleteMany: vi.fn(async () => undefined),
  findAll: vi.fn(async () => [])
}));

vi.mock("../../src/infrastructure/di/CompositionRoot", () => ({
  container: { notificationRepo: repo }
}));
vi.mock("../../src/infrastructure/logging/opsLogger", () => ({
  logError: vi.fn()
}));

import { AIEngine } from "../../src/core/engines/AIEngine";
import { InventoryAI } from "../../src/core/ia/InventoryAI";
import {
  PURCHASE_SUMMARY_KEY,
  STOCK_LOW_ALERT_KEY,
  STOCK_OUT_ALERT_KEY,
  buildPurchaseSummary,
  stableStockAlertKey
} from "../../src/core/domain/notifications/purchaseAlertSummary";
import { notificationStore } from "../../src/core/store/notificationStore";

const product = (over: Partial<Product> & { id: string; name: string }) =>
  ({ stock: 0, minStock: 0, ...over }) as unknown as Product;

describe("InventoryAI: sin sugerencias vacías", () => {
  const ai = new InventoryAI();

  it("stock 0 con mínimo 0 NO genera 'Comprar 0 u.'", () => {
    const lechuga = product({ id: "l", name: "Lechuga", stock: 0, minStock: 0 });
    expect(ai.generatePurchaseRecommendations([lechuga])).toEqual([]);
  });

  it("stock 0 con mínimo real sí genera una recomendación con cantidad mayor que 0", () => {
    const tomate = product({ id: "t", name: "Tomate", stock: 0, minStock: 5 });
    const [rec] = ai.generatePurchaseRecommendations([tomate]);
    expect(rec).toMatchObject({ productId: "t", priority: "CRITICAL", recommendedPurchase: 10 });
  });

  it("stock negativo (venta sin existencias) sigue siendo una necesidad real", () => {
    const pan = product({ id: "p", name: "Pan", stock: -3, minStock: 0 });
    const [rec] = ai.generatePurchaseRecommendations([pan]);
    expect(rec.recommendedPurchase).toBe(3);
  });

  it("los productos que no manejan stock nunca se recomiendan", () => {
    const servicio = product({ id: "s", name: "Servicio", stock: 0, minStock: 5, trackStock: false });
    expect(ai.generatePurchaseRecommendations([servicio])).toEqual([]);
  });

  it("con stock enmascarado conserva la recomendación sin cantidades", () => {
    const harina = product({ id: "h", name: "Harina", stock: 0, minStock: 3, stockMasked: true, stockStatus: "OUT" });
    const [rec] = ai.generatePurchaseRecommendations([harina]);
    expect(rec).toMatchObject({ stockMasked: true, recommendedPurchase: 0, currentStock: 0 });
  });
});

describe("AIEngine: recomendaciones del Dashboard", () => {
  const engine = new AIEngine();

  it("omite productos sin necesidad real y no dice 'Comprar 0'", () => {
    const [text] = engine.generatePurchaseRecommendation([
      product({ id: "l", name: "Lechuga", stock: 0, minStock: 0 })
    ]);
    expect(text).toBe("El inventario está en buen estado. No se requieren compras urgentes.");
  });

  it("usa singular cuando falta una sola unidad", () => {
    const [text] = engine.generatePurchaseRecommendation([
      product({ id: "a", name: "Arroz", stock: 4, minStock: 5 })
    ]);
    expect(text).toBe('Comprar 1 unidad de "Arroz". Stock actual: 4.');
  });
});

describe("buildPurchaseSummary: una sola notificación", () => {
  const rec = (name: string, priority: "CRITICAL" | "HIGH" | "MEDIUM", extra = {}) => ({
    productId: name,
    productName: name,
    currentStock: 1,
    recommendedPurchase: 4,
    priority,
    ...extra
  });

  it("sin recomendaciones urgentes no devuelve nada", () => {
    expect(buildPurchaseSummary([])).toBeNull();
    expect(buildPurchaseSummary([rec("Sal", "MEDIUM")])).toBeNull();
  });

  it("un producto: texto limpio, sin cifras", () => {
    const summary = buildPurchaseSummary([rec("Lechuga", "CRITICAL")]);
    expect(summary).toEqual({
      key: PURCHASE_SUMMARY_KEY,
      message: 'Reponer stock de "Lechuga" (🔴 Agotado).'
    });
  });

  it("muchos productos: un único mensaje resumido", () => {
    const recs = [
      rec("A", "CRITICAL"), rec("B", "CRITICAL"), rec("C", "HIGH"),
      rec("D", "HIGH"), rec("E", "HIGH"), rec("F", "MEDIUM")
    ];
    const summary = buildPurchaseSummary(recs);
    expect(summary?.message).toBe(
      'Reponer stock de 5 productos: "A", "B", "C" y 2 más (🔴 2 agotados, 🟡 3 con stock bajo).'
    );
    expect(summary?.message).not.toMatch(/Comprar|quedan|\b0 u\./);
  });

  it("con stock enmascarado el texto tampoco lleva cantidades", () => {
    const summary = buildPurchaseSummary([
      rec("Harina", "HIGH", { stockMasked: true, currentStock: 0, recommendedPurchase: 0 })
    ]);
    expect(summary?.message).toBe('Reponer stock de "Harina" (🟡 Stock bajo).');
  });
});

describe("stableStockAlertKey", () => {
  it("asigna la misma clave aunque cambie el conteo del mensaje", () => {
    expect(stableStockAlertKey("Tienes 2 producto(s) agotado(s). Repón…")).toBe(STOCK_OUT_ALERT_KEY);
    expect(stableStockAlertKey("Tienes 9 producto(s) agotado(s). Repón…")).toBe(STOCK_OUT_ALERT_KEY);
    expect(stableStockAlertKey("Tienes 3 producto(s) con stock bajo. Revísalos…")).toBe(STOCK_LOW_ALERT_KEY);
    expect(stableStockAlertKey("Ventas bajando")).toBeNull();
  });
});

describe("notificationStore: consolidación real", () => {
  beforeEach(() => {
    notificationStore.clear();
    vi.clearAllMocks();
  });

  it("repetir la recomendación 30 veces deja una sola notificación", () => {
    for (let i = 0; i < 30; i += 1) {
      notificationStore.addPurchaseRecommendation('Reponer stock de "Lechuga" (🔴 Agotado).', PURCHASE_SUMMARY_KEY);
    }
    expect(notificationStore.getByCategory("IA_COMPRA")).toHaveLength(1);
    expect(repo.save).toHaveBeenCalledTimes(1);
  });

  it("si cambia el contenido actualiza la misma notificación y la marca como no leída", () => {
    notificationStore.addPurchaseRecommendation('Reponer stock de "Lechuga" (🔴 Agotado).', PURCHASE_SUMMARY_KEY);
    const [first] = notificationStore.getAll();
    notificationStore.markAsRead(first.id);
    expect(notificationStore.unreadCount()).toBe(0);

    notificationStore.addPurchaseRecommendation('Reponer stock de 2 productos: "Lechuga", "Tomate" (🔴 2 agotados).', PURCHASE_SUMMARY_KEY);

    const all = notificationStore.getAll();
    expect(all).toHaveLength(1);
    expect(all[0].id).toBe(first.id);
    expect(all[0].message).toContain("2 productos");
    expect(all[0].read).toBe(false);
  });

  it("una alerta ya leída sigue leída si su contenido no cambió", () => {
    notificationStore.upsertByKey("Alerta crítica", "🔴 Tienes 2 agotados", "error", STOCK_OUT_ALERT_KEY, "STOCK_BAJO");
    const [n] = notificationStore.getAll();
    notificationStore.markAsRead(n.id);
    notificationStore.upsertByKey("Alerta crítica", "🔴 Tienes 2 agotados", "error", STOCK_OUT_ALERT_KEY, "STOCK_BAJO");
    expect(notificationStore.getAll()[0].read).toBe(true);
  });

  it("removeWhere retira las obsoletas (incluidas las individuales antiguas) y borra en Supabase", () => {
    notificationStore.add("IA recomienda comprar", "Comprar 0 u. de lechuga", "info", "IA_COMPRA:p1", "IA_COMPRA");
    notificationStore.add("IA recomienda comprar", "Comprar 3 u. de tomate", "info", "IA_COMPRA:p2", "IA_COMPRA");
    notificationStore.addPurchaseRecommendation("Reponer stock…", PURCHASE_SUMMARY_KEY);
    notificationStore.add("Recordatorio", "Llamar al proveedor", "info", "RECORDATORIO:1", "RECORDATORIO");

    const removed = notificationStore.removeWhere(
      (n) => n.category === "IA_COMPRA" && n.key !== PURCHASE_SUMMARY_KEY
    );

    expect(removed).toBe(2);
    expect(notificationStore.getAll().map((n) => n.key).sort()).toEqual([PURCHASE_SUMMARY_KEY, "RECORDATORIO:1"].sort());
    expect(repo.deleteMany).toHaveBeenCalledTimes(1);
  });
});