import type { Receipt } from "../../core/engines/ReceiptEngine";
import type { Business } from "../../core/store/businessStore";
import { toast } from "../../core/store/toastStore";
import { printSettingsStore } from "../../core/store/printSettingsStore";
import { renderReceiptDocument, type PrintableReceiptItem } from "./receiptTemplateRenderer";

export type { PrintableReceiptItem };

/**
 * Impresión real de un recibo de venta.
 *
 * No existe una API de navegador para hablar directo con una impresora
 * térmica sin un driver/agente externo (WebUSB requiere hardware
 * específico y permisos que este proyecto no tiene). La forma real y
 * estándar de imprimir desde una app web es generar el documento final
 * ya formateado y disparar el diálogo nativo de impresión del sistema
 * operativo (`window.print()`), que permite imprimir en cualquier
 * impresora instalada (térmica, láser) o exportar a PDF.
 *
 * El documento se arma con renderReceiptDocument (ver
 * receiptTemplateRenderer.ts), a partir de la plantilla y las opciones
 * elegidas en Configuración > Impresión (printSettingsStore) — el mismo
 * render que usa la vista previa en tiempo real de esa pantalla, así que
 * lo que el dueño ve en la vista previa es exactamente lo que sale
 * impreso.
 */
export function printReceiptDocument(
  receipt: Receipt,
  items: PrintableReceiptItem[],
  business: Business,
  // Antes este parámetro se recibía pero NUNCA se usaba dentro de la
  // función — money() estaba hardcodeada a "es-CO" con 0 decimales, así
  // que un negocio en México o España igual veía sus recibos formateados
  // como pesos colombianos. Ahora sí se usa (vía formatMoney), y por
  // defecto toma la moneda real que ya quedó guardada en el recibo.
  currency: string = receipt.currency ?? "COP"
): boolean {
  const printWindow = window.open("", "_blank", "width=380,height=640");

  if (!printWindow) {
    toast.error(
      "El navegador bloqueó la ventana de impresión. Habilita las ventanas emergentes para este sitio e intenta de nuevo."
    );
    return false;
  }

  const settings = printSettingsStore.get();
  const html = renderReceiptDocument(receipt, items, business, settings, currency, true);

  printWindow.document.open();
  printWindow.document.write(html);
  printWindow.document.close();

  return true;
}