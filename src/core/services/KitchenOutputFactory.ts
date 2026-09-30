import { KitchenEngine } from "../engines/KitchenEngine";
import type { KitchenOrder } from "../entities/Entities";
import { KitchenOutput, KitchenOutputMode } from "./kitchenOutput";
import { KitchenScreenOutput } from "./KitchenScreenOutput";
import { KitchenPrinterOutput } from "./KitchenPrinterOutput";

/* ===========================================================================
   createKitchenOutput
   ---------------------------------------------------------------------------
   El "if" del punto 5.5: dado BusinessSession.salidaCocina, decide cuál
   implementación de KitchenOutput usar. Nada más — no sabe de pedidos, no
   sabe de mesas, solo elige entre pantalla e impresora.

   Todos los negocios de prueba de hoy tienen salidaCocina = "pantalla"
   (ver el default en toBusinessSession, authBusinessContext.ts), así que
   en la práctica esto siempre devuelve KitchenScreenOutput mientras no
   exista un negocio real que necesite impresora.
=========================================================================== */

class NoopKitchenOutput implements KitchenOutput {
  public async send(_order: KitchenOrder): Promise<void> {
    // "none" es una configuración válida: el negocio tiene cocina manual
    // o no desea salida automática. No se persiste una comanda ficticia.
  }
}

export class KitchenCompositeOutput implements KitchenOutput {
  constructor(
    private readonly screen: KitchenScreenOutput,
    private readonly printer: KitchenPrinterOutput
  ) {}

  public async send(order: KitchenOrder): Promise<void> {
    // 1. Envía a pantalla KDS (persiste y emite evento en vivo a KDS)
    await this.screen.send(order);
    // 2. Dispara la impresión térmica de comanda física
    await this.printer.send(order, true);
  }
}

export function createKitchenOutput(
  salidaCocina: KitchenOutputMode,
  kitchen: KitchenEngine
): KitchenOutput {
  if (salidaCocina === "none") {
    return new NoopKitchenOutput();
  }

  if (salidaCocina === "impresora") {
    return new KitchenPrinterOutput(kitchen);
  }

  if (salidaCocina === "ambos") {
    return new KitchenCompositeOutput(
      new KitchenScreenOutput(kitchen),
      new KitchenPrinterOutput(kitchen)
    );
  }

  return new KitchenScreenOutput(kitchen);
}