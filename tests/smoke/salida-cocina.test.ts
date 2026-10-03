// tests/smoke/salida-cocina.test.ts
/* ===========================================================================
   SMOKE TEST — createKitchenOutput / KitchenScreenOutput / KitchenPrinterOutput
   ---------------------------------------------------------------------------
   Cubre el punto 5.6:

      1. Con "pantalla", createKitchenOutput() devuelve algo que de verdad
         conecta con KitchenEngine — una comanda enviada por ahí termina guardada
         y visible como cualquier otra comanda real.

      2. Con "impresora", createKitchenOutput() devuelve una implementación
         real que genera el ticket de comanda. No guarda en KitchenEngine
         (la impresora es un canal paralelo), pero tampoco lanza error.
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

  it('"impresora" registra la comanda en KitchenEngine y no lanza error aunque no haya navegador', async () => {
    // La salida "impresora" SI persiste la comanda en KitchenEngine (asi queda
    // historial y el ciclo de la orden se puede seguir) y ademas intenta
    // imprimir. Este test se escribio cuando KitchenPrinterOutput era un stub
    // no-op y por eso esperaba 0 guardados; hoy la salida esta implementada de
    // verdad, y "ambos" usa el flag alreadySaved justamente para no guardar dos
    // veces cuando la pantalla ya lo hizo.
    //
    // La impresion fisica no es verificable en Node (no hay window): el output
    // lo detecta y retorna sin error. Eso es BLOCKED_ENVIRONMENT, no un fallo.
    const { kitchen, kitchenOrders } = buildKitchenEngine();
    const output = createKitchenOutput("impresora", kitchen);

    await expect(output.send(SAMPLE_ORDER)).resolves.toBeUndefined();

    const saved = await kitchenOrders.findAll();
    expect(saved).toHaveLength(1);
    expect(saved[0].id).toBe(SAMPLE_ORDER.id);
  });
});