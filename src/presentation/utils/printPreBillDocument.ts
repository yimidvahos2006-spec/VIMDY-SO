// src/presentation/utils/printPreBillDocument.ts
/* ===========================================================================
   Pre-cuenta imprimible (o vista previa) de una mesa
   ---------------------------------------------------------------------------
   Igual que el recibo (printReceiptDocument), la impresión real en una app
   web es: armar el documento ya formateado y abrir el diálogo nativo de
   impresión del sistema (window.print). Aquí se respeta Configuración >
   Impresión (ancho de papel, logo, dirección, teléfono, pie de página…).

   La pre-cuenta tiene su PROPIO diseño, a propósito: lleva la leyenda
   "No es factura ni comprobante de pago" y no muestra campos de pago
   (recibido, cambio, método) para que nunca se confunda con un recibo.

   Ventana emergente — dos pasos:
     1) openPreBillWindow()   → se llama DE INMEDIATO en el toque del botón.
                                Los navegadores solo permiten abrir ventanas
                                en respuesta directa a un toque; si se abre
                                después de un `await`, la bloquean.
     2) writePreBillDocument()→ cuando ya están los datos frescos de la mesa.
   =========================================================================== */

import type { Business } from "../../core/store/businessStore";
import type { PrintSettings } from "../../core/store/printSettingsStore";
import { ACCENT_COLORS } from "../../core/store/printSettingsStore";
import type { PreBill } from "../../core/services/tableBill";
import { formatMoney } from "../../core/utils/formatMoney";

export type PreBillMode = "print" | "preview";

export const PRE_BILL_DISCLAIMER = "Pre-cuenta: no es factura ni comprobante de pago.";

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function paperCss(settings: PrintSettings): { width: string; fontSize: string; padding: string } {
  switch (settings.paperWidth) {
    case "58mm":
      return { width: "220px", fontSize: "11px", padding: "12px" };
    case "a4":
      return { width: "560px", fontSize: "13px", padding: "28px" };
    case "80mm":
    default:
      return { width: "300px", fontSize: "12px", padding: "14px" };
  }
}

function metaLine(label: string, value: string | undefined): string {
  const clean = (value ?? "").trim();
  if (!clean) return "";
  return `<div class="meta-line"><span class="meta-label">${escapeHtml(label)}</span>${escapeHtml(clean)}</div>`;
}

/**
 * HTML completo de la pre-cuenta. Función pura: mismos datos → mismo documento
 * (por eso se puede probar sin abrir ninguna ventana).
 */
export function renderPreBillDocument(
  preBill: PreBill,
  business: Business,
  settings: PrintSettings,
  currency: string,
  mode: PreBillMode
): string {
  const money = (value: number) => formatMoney(Math.max(value, 0), currency);
  const accent = ACCENT_COLORS.find((color) => color.id === settings.accentColor)?.hex ?? "#06b6d4";
  const { width, fontSize, padding } = paperCss(settings);

  const header = `
    <h1>${escapeHtml(business.name || "VIMDY")}</h1>
    <p class="subtitle">
      ${business.nit ? `NIT ${escapeHtml(business.nit)}<br/>` : ""}
      ${settings.showAddress && business.address ? `${escapeHtml(business.address)}<br/>` : ""}
      ${settings.showPhone && business.phone ? escapeHtml(business.phone) : ""}
    </p>`;

  const meta = [
    metaLine("Mesa:", preBill.tableName),
    metaLine("Personas:", String(preBill.peopleCount)),
    settings.showCashier ? metaLine("Atendió:", preBill.waiterName) : "",
    metaLine("Fecha:", preBill.issuedAt.toLocaleString("es-CO"))
  ].join("");

  const rows = preBill.lines
    .map(
      (line) => `
      <tr>
        <td colspan="2" class="item-name">${escapeHtml(line.name)}</td>
      </tr>
      ${line.note ? `<tr><td colspan="2" class="item-note">${escapeHtml(line.note)}</td></tr>` : ""}
      <tr>
        <td class="qty">${line.quantity} x ${money(line.unitPrice)}</td>
        <td class="line-total">${money(line.lineTotal)}</td>
      </tr>`
    )
    .join("");

  const totals = `
    <tr><td class="label">Subtotal</td><td class="value">${money(preBill.subtotal)}</td></tr>
    ${settings.showTax ? `<tr><td class="label">IVA</td><td class="value">${money(preBill.tax)}</td></tr>` : ""}
    ${settings.showDiscount && preBill.discount > 0 ? `<tr><td class="label">Descuento</td><td class="value">-${money(preBill.discount)}</td></tr>` : ""}
    <tr class="grand-total"><td class="label">TOTAL A PAGAR</td><td class="value">${money(preBill.total)}</td></tr>`;

  const footerLines =
    settings.showFooter && settings.footerMessage
      ? settings.footerMessage
          .split("\n")
          .map((line) => escapeHtml(line.trim()))
          .filter(Boolean)
          .join("<br/>")
      : "";

  const toolbar =
    mode === "preview"
      ? `<div class="toolbar no-print">
          <button type="button" onclick="window.print()">Imprimir</button>
          <button type="button" class="secondary" onclick="window.close()">Cerrar</button>
        </div>`
      : "";

  const autoPrintScript =
    mode === "print"
      ? `<script>
    window.onload = function () { window.focus(); window.print(); };
    window.onafterprint = function () { window.close(); };
  </script>`
      : "";

  return `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Pre-cuenta ${escapeHtml(preBill.tableName)}</title>
<style>
  * { box-sizing: border-box; }
  html, body { background: #fff; }
  body {
    font-family: 'Segoe UI', Arial, sans-serif;
    width: ${width};
    max-width: 100%;
    margin: 0 auto;
    padding: ${padding};
    color: #111;
    font-size: ${fontSize};
    line-height: 1.45;
  }
  h1 { font-size: 16px; text-align: center; margin: 0 0 2px; letter-spacing: .5px; }
  .subtitle { text-align: center; font-size: 10px; color: #555; margin: 0 0 8px; }
  .badge { text-align: center; font-weight: 800; letter-spacing: 2px; border: 2px solid ${accent}; color: ${accent}; border-radius: 6px; padding: 4px 0; margin: 6px 0; }
  .disclaimer { text-align: center; font-size: 10px; color: #555; margin: 4px 0 8px; }
  .divider { border-top: 1px dashed #999; margin: 8px 0; }
  .meta-line { margin: 2px 0; }
  .meta-label { color: #666; margin-right: 4px; }
  table { width: 100%; border-collapse: collapse; margin-top: 6px; }
  .item-name { padding-top: 6px; font-weight: 600; }
  .item-note { font-size: 10px; font-style: italic; color: #555; }
  .qty { color: #555; }
  .line-total, .value { text-align: right; }
  .totals td { padding-top: 2px; }
  .totals .label { color: #555; }
  .grand-total td { font-size: 14px; font-weight: 800; border-top: 1px solid #111; padding-top: 4px; color: #111; }
  .footer { text-align: center; margin-top: 14px; font-size: 10px; color: #555; }
  .toolbar { display: flex; gap: 8px; justify-content: center; margin-bottom: 12px; }
  .toolbar button { height: 40px; padding: 0 18px; border-radius: 8px; border: 0; background: ${accent}; color: #fff; font-weight: 700; font-size: 14px; cursor: pointer; }
  .toolbar button.secondary { background: #e5e7eb; color: #111; }
  @media print { .no-print { display: none !important; } }
</style>
</head>
<body>
  ${toolbar}
  ${header}
  <div class="badge">PRE-CUENTA</div>
  <div class="disclaimer">${escapeHtml(PRE_BILL_DISCLAIMER)}</div>
  <div class="divider"></div>
  ${meta}
  <div class="divider"></div>
  <table>${rows}</table>
  <div class="divider"></div>
  <table class="totals">${totals}</table>
  ${footerLines ? `<div class="footer">${footerLines}</div>` : ""}
  ${autoPrintScript}
</body>
</html>`;
}

/**
 * Paso 1 — abrir la ventana YA, dentro del toque del botón.
 * Devuelve null si el navegador la bloqueó (el llamador avisa al mesero).
 */
export function openPreBillWindow(mode: PreBillMode): Window | null {
  const size = mode === "preview" ? "width=460,height=760" : "width=380,height=640";
  const win = window.open("", "_blank", size);
  if (!win) return null;

  win.document.open();
  win.document.write(
    `<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8" /><title>Pre-cuenta</title></head>` +
      `<body style="font-family:Arial,sans-serif;padding:24px;color:#555;text-align:center">Preparando pre-cuenta…</body></html>`
  );
  win.document.close();
  return win;
}

/** Paso 2 — escribir el documento final en la ventana ya abierta. */
export function writePreBillDocument(win: Window, html: string): void {
  win.document.open();
  win.document.write(html);
  win.document.close();
}