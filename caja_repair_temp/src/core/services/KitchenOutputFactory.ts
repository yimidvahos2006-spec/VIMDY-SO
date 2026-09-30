import { KitchenEngine } from "../engines/KitchenEngine";
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

export function createKitchenOutput(
  salidaCocina: KitchenOutputMode,
  kitchen: KitchenEngine
): KitchenOutput {
  if (salidaCocina === "impresora") {
    return new KitchenPrinterOutput(kitchen);
  }

  return new KitchenScreenOutput(kitchen);
}