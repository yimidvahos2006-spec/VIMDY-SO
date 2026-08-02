// tests/smoke/salida-cocina.test.ts
/* ===========================================================================
   SMOKE TEST — createKitchenOutput / KitchenScreenOutput / KitchenPrinterOutput
   ---------------------------------------------------------------------------
   Cubre el punto 5.6: mientras todos los negocios de prueba usan
   salidaCocina = "pantalla", esta prueba confirma dos cosas:

     1. Con "pantalla", createKitchenOutput() devuelve algo que de verdad
        conecta con KitchenEngine (la misma pieza que ya alimenta
        KitchenDashboard) — una comanda enviada por ahí termina guardada
        y visible como cualquier otra comanda real.

     2. Con "impresora", createKitchenOutput() devuelve el hueco (5.4), que
        avisa ruidosamente que no está implementado en vez de fingir que
        imprimió. Así, si algún día algo cambia salidaCocina por error
        antes de que la impresora exista de verdad, se nota de inmediato
        en vez de perder pedidos en silencio.
=========================================================================== */

import { describe, it, expect } from "vitest";

import { KitchenOrder } from "../../src/core/entities/Entities";
import { KitchenEngine } from "../../src/core/engines/KitchenEngine";
import { AuditEngine } from "../../src/core/engines/AuditEngine";
import { createKitchenOutput } from "../../src/core/services/KitchenOutputFactory";

import { InMemoryRepository } from "../fakes/InMemoryRepository";

function buildKitchenEngine() {
  const kitchenOrders = new InMemoryRepository<KitchenOrder>("kitchen_orders");
  const auditLogs = new InMemoryRepository("audit_logs");
  const kitchen = new KitchenEngine(kitchenOrders, new AuditEngine(auditLogs as any));
  return { kitchen, kitchenOrders };
}

const SAMPLE_ORDER: KitchenOrder = {
  id: "kitchen-order-1",
  items: [
    {
      productId: "prod-burger",
      productName: "Hamburguesa Clásica",
      quantity: 1,
      price: 18000,
      requiresKitchen: true
    } as any
  ],
  status: "PENDIENTE",
  createdAt: new Date(),
  origin: "Mesa 4",
  orderNumber: 154
};

describe("Smoke: salidaCocina decide pantalla vs impresora", () => {
  it('"pantalla" guarda de verdad la comanda a través del KitchenEngine existente', async () => {
    const { kitchen, kitchenOrders } = buildKitchenEngine();
    const output = createKitchenOutput("pantalla", kitchen);

    await output.send(SAMPLE_ORDER);

    const saved = await kitchenOrders.findAll();
    expect(saved).toHaveLength(1);
    expect(saved[0].id).toBe(SAMPLE_ORDER.id);
    expect(saved[0].items).toHaveLength(1);
  });

  it('"impresora" no guarda nada y falla explícitamente, porque todavía es un hueco', async () => {
    const { kitchen, kitchenOrders } = buildKitchenEngine();
    const output = createKitchenOutput("impresora", kitchen);

    await expect(output.send(SAMPLE_ORDER)).rejects.toThrow(
      /KITCHEN_PRINTER_NOT_IMPLEMENTED/
    );

    const saved = await kitchenOrders.findAll();
    expect(saved).toHaveLength(0);
  });
});