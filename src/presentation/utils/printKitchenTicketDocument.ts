import { toast } from "../../core/store/toastStore";

export interface PrintableKitchenTicketItem {
  name: string;
  quantity: number;
  estimatedPrepMinutes?: number;
  note?: string;
}

/**
 * Imprime UN ticket de cocina para UNA estación (ej. "Barra"), con solo los
 * items que le corresponden a esa estación — ver
 * kitchenTicketGrouping.groupOrderItemsByStation.
 *
 * Mismo patrón real que printReceiptDocument.ts: no hay forma de hablar
 * directo con una impresora térmica desde el navegador sin un driver
 * externo, así que se genera el documento ya formateado y se dispara el
 * diálogo de impresión nativo del sistema operativo (`window.print()`),
 * que sirve tanto para impresoras térmicas como para exportar a PDF.
 */
export function printKitchenTicketDocument(
  station: string,
  items: PrintableKitchenTicketItem[],
  meta: { orderNumber?: string; origin?: string; waiterName?: string; notes?: string }
): boolean {
  const printWindow = window.open("", "_blank", "width=380,height=600");

  if (!printWindow) {
    toast.error(
      "El navegador bloqueó la ventana de impresión. Habilita las ventanas emergentes para este sitio e intenta de nuevo."
    );
    return false;
  }

  const rows = items
    .map(
      (item) => `
        <tr>
          <td class="qty">${item.quantity}x</td>
          <td class="item-name">
            ${escapeHtml(item.name)}
            ${item.estimatedPrepMinutes ? `<span class="time">~${item.estimatedPrepMinutes} min</span>` : ""}
            ${item.note ? `<div class="note">${escapeHtml(item.note)}</div>` : ""}
          </td>
        </tr>`
    )
    .join("");

  const html = `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8" />
<title>Ticket ${escapeHtml(station)}</title>
<style>
  * { box-sizing: border-box; }
  body {
    font-family: 'Courier New', monospace;
    width: 300px;
    margin: 0 auto;
    padding: 12px;
    color: #000;
    font-size: 13px;
  }
  h1 { font-size: 20px; text-align: center; margin: 0 0 4px; letter-spacing: 1px; text-transform: uppercase; }
  .subtitle { text-align: center; font-size: 11px; margin-bottom: 8px; }
  .divider { border-top: 1px dashed #000; margin: 8px 0; }
  .meta p { margin: 2px 0; }
  table { width: 100%; border-collapse: collapse; margin-top: 6px; }
  .qty { width: 42px; font-weight: bold; vertical-align: top; padding: 4px 0; }
  .item-name { font-weight: bold; padding: 4px 0; }
  .time { display: block; font-weight: normal; font-size: 11px; color: #333; }
  .note { margin-top: 4px; font-size: 11px; color: #333; font-style: italic; }
  .notes { margin-top: 8px; font-size: 12px; }
  .footer { text-align: center; margin-top: 14px; font-size: 10px; }
  @media print {
    body { width: 100%; }
  }
</style>
</head>
<body>
  <h1>${escapeHtml(station)}</h1>
  <p class="subtitle">Ticket de cocina · VIMDY</p>
  <div class="divider"></div>
  <div class="meta">
    ${meta.orderNumber ? `<p><strong>Pedido:</strong> ${escapeHtml(meta.orderNumber)}</p>` : ""}
    ${meta.origin ? `<p><strong>Origen:</strong> ${escapeHtml(meta.origin)}</p>` : ""}
    ${meta.waiterName ? `<p><strong>Mesero:</strong> ${escapeHtml(meta.waiterName)}</p>` : ""}
    <p><strong>Hora:</strong> ${new Date().toLocaleTimeString("es-CO")}</p>
  </div>
  <div class="divider"></div>
  <table>
    ${rows}
  </table>
  ${meta.notes ? `<div class="divider"></div><p class="notes"><strong>Nota:</strong> ${escapeHtml(meta.notes)}</p>` : ""}
  <div class="footer">Generado por VIMDY OS</div>
  <script>
    window.onload = function () {
      window.focus();
      window.print();
    };
    window.onafterprint = function () {
      window.close();
    };
  </script>
</body>
</html>`;

  printWindow.document.open();
  printWindow.document.write(html);
  printWindow.document.close();

  return true;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}