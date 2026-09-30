import { KitchenOrder } from "../entities/Entities";

/* ===========================================================================
   kitchenOutput
   ---------------------------------------------------------------------------
   "Molde" para cualquier salida de cocina (pantalla/KDS, impresora/tiquetera,
   y lo que venga después). Este archivo NO implementa nada: solo define qué
   necesita saber cualquier salida para funcionar.

   Por qué es tan chico: KitchenOrder (ver Entities.ts) ya trae exactamente
   lo que una salida necesita —
     - items:        productos ya filtrados por requiresKitchen
                      (ver OrderEngine.sendToKitchen, línea del filtro)
     - origin:        mesa/pedido de origen (ej. "Mesa 4", "Mostrador")
     - orderNumber:   número legible del pedido
     - waiterId:      quién lo envió
     - notes:         observaciones (ej. "sin cebolla")
   No hay que inventar un tipo nuevo para eso: KitchenOrder ya es el molde.

   Implementaciones futuras de esta interfaz:
     - 5.3: KitchenScreenOutput  → conecta al KitchenDashboard que ya existe.
     - 5.4: KitchenPrinterOutput → tiquetera, todavía NO se implementa.
   BusinessProfile.salidaCocina (5.5) decide cuál de las dos se usa.
=========================================================================== */

export interface KitchenOutput {
  /**
   * Envía una comanda ya armada (items ya filtrados por requiresKitchen)
   * a esta salida. No decide QUÉ enviar, solo CÓMO mostrarlo/imprimirlo.
   */
  send(order: KitchenOrder): Promise<void>;
}

/**
 * Valor de BusinessSession.salidaCocina (ver authBusinessContext.ts) y de
 * la columna `salida_cocina` en la tabla `businesses`. "impresora" existe
 * como opción desde ya para no tener que migrar el tipo después, aunque
 * KitchenPrinterOutput todavía no esté implementada de verdad (ver 5.4).
 */
export type KitchenOutputMode = "pantalla" | "impresora";