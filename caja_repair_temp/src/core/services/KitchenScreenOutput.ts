import { KitchenOrder } from "../entities/Entities";
import { KitchenEngine } from "../engines/KitchenEngine";
import { KitchenOutput } from "./kitchenOutput";

/* ===========================================================================
   KitchenScreenOutput
   ---------------------------------------------------------------------------
   Implementación de KitchenOutput (ver kitchenOutput.ts) para la salida por
   PANTALLA. No es código nuevo: KitchenEngine.save() ya hace exactamente
   esto — guarda la comanda y emite "kitchen.order_created" — y eso es lo
   que ya alimenta a useKitchenOrders / KitchenDashboard (la pantalla de
   Cocina que ya existe). Esta clase solo pone ese comportamiento existente
   detrás del molde, para que quien envíe una comanda no tenga que saber
   si el destino es pantalla o (más adelante) impresora.
=========================================================================== */

export class KitchenScreenOutput implements KitchenOutput {
  constructor(private readonly kitchen: KitchenEngine) {}

  public async send(order: KitchenOrder): Promise<void> {
    await this.kitchen.save(order);
  }
}