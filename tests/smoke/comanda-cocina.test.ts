// tests/smoke/comanda-cocina.test.ts
/* ===========================================================================
   SMOKE TEST — Creación y entrega de una orden en cocina
   ---------------------------------------------------------------------------
   CRÍTICO #7 del checklist de lanzamiento — flujo #3.

   Qué cubre (KitchenEngine, el motor detrás del KDS de cocina):
     1. Una comanda nueva se crea en estado PENDIENTE y aparece en
        getActiveOrders().
     2. Cambiar su estado hasta ENTREGADO la saca de "activas" y la deja en
        el historial (getDeliveredOrders()), con `deliveredAt` fijado.
     3. `deliveredAt` NUNCA se recalcula si updateStatus(ENTREGADO) se
        vuelve a llamar sobre una comanda que ya estaba entregada (evita
        que un doble-click o un reintento de red mueva la hora real de
        entrega).
     4. Cancelar una comanda YA entregada está prohibido (no se puede
        "deshacer" una entrega desde Cocina).
     5. Cancelar exige un motivo, y ese motivo queda visible en la propia
        comanda cancelada (control interno: nunca desaparece sin razón).

   Si este flujo se rompe, la pantalla de cocina dejaría de reflejar en qué
   va cada pedido — un cocinero no sabría qué preparar ni qué ya se sirvió.
=========================================================================== */

import { describe, it, expect, beforeEach } from "vitest";

import { AuditLog, KitchenOrder } from "../../src/core/entities/Entities";
import { AuditEngine } from "../../src/core/engines/AuditEngine";
import { KitchenEngine } from "../../src/core/engines/KitchenEngine";
import { InMemoryRepository } from "../fakes/InMemoryRepository";

function buildKitchenEngine() {
  const kitchenOrders = new InMemoryRepository<KitchenOrder>("kitchen_orders");
  const auditLogs = new InMemoryRepository<AuditLog>("audit_logs");

  const audit = new AuditEngine(auditLogs);
  const kitchen = new KitchenEngine(kitchenOrders, audit);

  return { kitchen, kitchenOrders, auditLogs };
}

function buildOrder(overrides: Partial<KitchenOrder> = {}): KitchenOrder {
  return {
    id: crypto.randomUUID(),
    items: [{ productId: "prod-burger", quantity: 2, price: 18000 }],
    status: "PENDIENTE",
    createdAt: new Date(),
    origin: "Mesa 4",
    priority: "NORMAL",
    ...overrides
  };
}

describe("Smoke: creación y entrega de comanda de cocina", () => {
  let ctx: ReturnType<typeof buildKitchenEngine>;

  beforeEach(() => {
    ctx = buildKitchenEngine();
  });

  it("crea una comanda en PENDIENTE, la mueve hasta ENTREGADO y la registra en el historial", async () => {
    const order = buildOrder();
    await ctx.kitchen.save(order);

    let active = await ctx.kitchen.getActiveOrders();
    expect(active).toHaveLength(1);
    expect(active[0].status).toBe("PENDIENTE");

    await ctx.kitchen.updateStatus(order.id, "EN_PREPARACION");
    active = await ctx.kitchen.getActiveOrders();
    expect(active[0].status).toBe("EN_PREPARACION");

    await ctx.kitchen.updateStatus(order.id, "ENTREGADO");

    active = await ctx.kitchen.getActiveOrders();
    expect(active).toHaveLength(0); // ya no está "activa"

    const delivered = await ctx.kitchen.getDeliveredOrders();
    expect(delivered).toHaveLength(1);
    expect(delivered[0].id).toBe(order.id);
    expect(delivered[0].deliveredAt).toBeInstanceOf(Date);
  });

  it("no recalcula deliveredAt si ENTREGADO se dispara dos veces sobre la misma comanda", async () => {
    const order = buildOrder();
    await ctx.kitchen.save(order);

    await ctx.kitchen.updateStatus(order.id, "ENTREGADO");
    const firstDelivered = await ctx.kitchen.getById(order.id);
    const firstDeliveredAt = firstDelivered!.deliveredAt;

    // Reintento (ej. doble click en "Entregar" que alcanzó a salir antes
    // de que la UI deshabilitara el botón).
    await ctx.kitchen.updateStatus(order.id, "ENTREGADO");
    const secondDelivered = await ctx.kitchen.getById(order.id);

    expect(secondDelivered!.deliveredAt).toEqual(firstDeliveredAt);
  });

  it("no permite cancelar una comanda ya entregada, y sí exige un motivo para cancelar una activa", async () => {
    const deliveredOrder = buildOrder({ status: "ENTREGADO", deliveredAt: new Date() });
    await ctx.kitchen.save(deliveredOrder);

    await expect(
      ctx.kitchen.cancelOrder(deliveredOrder.id, "Cliente canceló", "waiter-1")
    ).rejects.toThrow(/ORDER_CANNOT_BE_CANCELLED/);

    const activeOrder = buildOrder();
    await ctx.kitchen.save(activeOrder);

    await expect(ctx.kitchen.cancelOrder(activeOrder.id, "   ", "waiter-1")).rejects.toThrow(
      /CANCEL_REASON_REQUIRED/
    );

    const cancelled = await ctx.kitchen.cancelOrder(activeOrder.id, "Producto agotado", "waiter-1");
    expect(cancelled.status).toBe("CANCELADO");
    expect(cancelled.cancelReason).toBe("Producto agotado");

    // Queda auditado: quién, qué y por qué.
    const logs = await ctx.auditLogs.findAll();
    expect(logs.some((log) => log.action === "KITCHEN_ORDER_CANCELLED")).toBe(true);
  });
});