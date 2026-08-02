import { KitchenOrder } from "../entities/Entities";
import { KitchenOutput } from "./kitchenOutput";

/* ===========================================================================
   KitchenPrinterOutput
   ---------------------------------------------------------------------------
   Hueco para la salida por IMPRESORA (tiquetera). Implementa el molde
   KitchenOutput (ver kitchenOutput.ts) para que el resto del sistema
   (BusinessProfile.salidaCocina = "impresora", ver punto 5.5) ya pueda
   referenciarla sin romper nada.

   A PROPÓSITO no imprime nada todavía: ningún negocio de prueba la usa hoy.
   Se implementa de verdad (conexión a la impresora física/térmica, formato
   de tiquete, etc.) cuando exista un negocio real que la necesite — no antes.
   Mientras tanto, si alguien intenta usarla por error, falla ruidosamente
   en vez de fallar en silencio (fingir que imprimió sin imprimir nada).
=========================================================================== */

export class KitchenPrinterOutput implements KitchenOutput {
  public async send(_order: KitchenOrder): Promise<void> {
    throw new Error(
      "KITCHEN_PRINTER_NOT_IMPLEMENTED: la salida por impresora todavía no está implementada."
    );
  }
}