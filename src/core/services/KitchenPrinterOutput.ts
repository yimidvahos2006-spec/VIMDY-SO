import { KitchenOrder } from "../entities/Entities";
import { KitchenEngine } from "../engines/KitchenEngine";
import { KitchenOutput } from "./kitchenOutput";
import { productCatalogStore } from "../store/productCatalogStore";

/* ===========================================================================
   KitchenPrinterOutput
   ---------------------------------------------------------------------------
   Implementacion de KitchenOutput para salida por IMPRESORA (tiquetera termica).
   Genera un ticket en texto plano ASCII y lo envia a imprimir mediante
   window.print() dentro de un iframe oculto. En entornos sin navegador
   (SSR/Node) no hace nada, sin lanzar error.
 =========================================================================== */

export class KitchenPrinterOutput implements KitchenOutput {
  constructor(private readonly kitchen: KitchenEngine) {}

  public async send(order: KitchenOrder): Promise<void> {
    if (typeof window === "undefined" || typeof document === "undefined") {
      return;
    }

    const date = new Date(order.createdAt);
    const dateStr = `${String(date.getDate()).padStart(2, "0")}/${String(date.getMonth() + 1).padStart(2, "0")}/${date.getFullYear()}`;
    const timeStr = `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
    const orderNumber = order.orderNumber ?? 0;
    const origin = order.origin ?? "Sin origen";

    const lines: string[] = [];
    lines.push("========================================");
    lines.push("            VIMDY - COCINA            ");
    lines.push("========================================");
    lines.push("");
    lines.push(`Orden #${orderNumber}`);
    lines.push(origin);
    lines.push(`Fecha: ${dateStr}  Hora: ${timeStr}`);
    lines.push("----------------------------------------");

    let totalItems = 0;

    for (const item of order.items) {
      const product = productCatalogStore.getById(item.productId);
      const name = product?.name ?? item.productId.slice(0, 8);
      const qty = item.quantity;
      totalItems += qty;

      lines.push(`${String(qty).padStart(2)}x ${this.fitLine(name, 34)}`);

      if (item.note) {
        lines.push(`     ${this.fitLine(item.note.toUpperCase(), 34)}`);
      }
    }

    if (order.notes) {
      lines.push("----------------------------------------");
      lines.push(`NOTA: ${this.fitLine(order.notes.toUpperCase(), 32)}`);
    }

    lines.push("----------------------------------------");
    lines.push(`Total: ${totalItems} items`);
    lines.push("========================================");

    const ticketText = lines.join("\n");

    const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <style>
    @page { size: 80mm auto; margin: 2mm; }
    body { font-family: "Courier New", Courier, monospace; font-size: 12px; margin: 0; padding: 0; white-space: pre; }
  </style>
</head>
<body>${this.escapeHtml(ticketText)}</body>
</html>`;

    this.printTicket(html);
  }

  private fitLine(text: string, maxLength: number): string {
    if (text.length <= maxLength) return text;
    return text.slice(0, maxLength - 1);
  }

  private escapeHtml(text: string): string {
    return text
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  }

  private printTicket(html: string): void {
    const iframe = document.createElement("iframe");
    iframe.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0;opacity:0;pointer-events:none;";

    document.body.appendChild(iframe);

    const doc = iframe.contentDocument ?? iframe.contentWindow?.document;
    if (!doc) {
      document.body.removeChild(iframe);
      return;
    }

    doc.open();
    doc.write(html);
    doc.close();

    setTimeout(() => {
      iframe.contentWindow?.focus();
      iframe.contentWindow?.print();
      setTimeout(() => {
        if (document.body.contains(iframe)) {
          document.body.removeChild(iframe);
        }
      }, 1000);
    }, 50);
  }
}
