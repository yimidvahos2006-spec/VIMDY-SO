import type { Receipt } from "../../core/engines/ReceiptEngine";
import type { Business } from "../../core/store/businessStore";
import type { PrintSettings } from "../../core/store/printSettingsStore";
import { ACCENT_COLORS } from "../../core/store/printSettingsStore";
import { formatMoney } from "../../core/utils/formatMoney";

export interface PrintableReceiptItem {
  name: string;
  quantity: number;
  price: number;
  unit?: string;
  quantityRaw?: number;
  selectedSizeId?: string;
  selectedExtraIds?: readonly string[];
  discount?: { type: "PERCENT" | "FIXED"; value: number };
  taxRate?: number;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function accentHex(settings: PrintSettings): string {
  return ACCENT_COLORS.find((c) => c.id === settings.accentColor)?.hex ?? "#06b6d4";
}

function paperWidthCss(settings: PrintSettings): { width: string; fontSize: string } {
  switch (settings.paperWidth) {
    case "58mm":
      return { width: "220px", fontSize: "11px" };
    case "a4":
      return { width: "560px", fontSize: "13px" };
    case "80mm":
    default:
      return { width: "300px", fontSize: "12px" };
  }
}

/**
 * URL de un QR generado externamente (api.qrserver.com). Es un "mejor
 * esfuerzo": si el negocio imprime sin internet, el navegador simplemente
 * no carga la imagen y el resto del ticket se imprime igual — nunca bloquea
 * la impresión real.
 */
function qrImageUrl(content: string, sizePx: number = 90): string {
  const encoded = encodeURIComponent(content);
  return `https://api.qrserver.com/v1/create-qr-code/?size=${sizePx}x${sizePx}&data=${encoded}`;
}

/**
 * Link de WhatsApp (wa.me) al número real de pedidos del negocio, con un
 * mensaje pre-escrito. wa.me solo acepta dígitos (sin "+", espacios ni
 * guiones), así que se limpia lo que el dueño haya escrito en
 * Configuración > Datos del negocio.
 *
 * `whatsappOrders` es el número dedicado a domicilios; si no está lleno
 * (negocio sin Domicilios activado) se usa el teléfono general del
 * negocio como respaldo. Si ninguno de los dos existe, no hay a dónde
 * apuntar el QR — el llamador debe omitir el bloque entero en ese caso.
 */
function whatsappOrderLink(business: Business): string | null {
  const rawNumber = (business.whatsappOrders?.trim() || business.phone?.trim() || "");
  const digits = rawNumber.replace(/\D/g, "");
  if (!digits) return null;

  const message = `Hola ${business.name || "VIMDY"}, quiero hacer un pedido 🛵`;
  return `https://wa.me/${digits}?text=${encodeURIComponent(message)}`;
}

function metaLine(label: string, value: string): string {
  if (!value) return "";
  return `<p class="meta-line"><span class="meta-label">${escapeHtml(label)}</span> ${escapeHtml(value)}</p>`;
}

/**
 * Arma el bloque de líneas de producto. Todas las plantillas comparten la
 * misma fuente de datos (PrintableReceiptItem[]); lo que cambia entre
 * plantillas es solo el CSS y el envoltorio alrededor de este bloque.
 */
function renderItemRows(items: PrintableReceiptItem[], money: (v: number) => string): string {
  return items
    .map(
      (item) => {
        const displayQty =
          item.quantityRaw !== undefined && item.unit
            ? `${item.quantityRaw} ${item.unit}`
            : String(item.quantity);
        const sizeLabel = item.selectedSizeId ? `[${item.selectedSizeId}] ` : "";
        const extrasLabel =
          item.selectedExtraIds && item.selectedExtraIds.length > 0
            ? `+ ${item.selectedExtraIds.join(", ")}`
            : "";
        const label = [sizeLabel, item.name, extrasLabel].filter(Boolean).join(" ");
        const discountLabel =
          item.discount && item.discount.type === "PERCENT"
            ? ` (${item.discount.value}% off)`
            : item.discount && item.discount.type === "FIXED"
              ? ` (-${money(item.discount.value)})`
              : "";
        return `
        <tr>
          <td colspan="2" class="item-name">${escapeHtml(label)}${discountLabel ? escapeHtml(discountLabel) : ""}</td>
        </tr>
        <tr>
          <td class="qty">${displayQty} x ${money(item.price)}</td>
          <td class="line-total">${money(item.quantity * item.price)}</td>
        </tr>`;
      }
    )
    .join("");
}

function renderTotalsRows(
  receipt: Receipt,
  settings: PrintSettings,
  money: (v: number) => string
): string {
  return `
    <tr><td class="label">Subtotal</td><td class="value">${money(receipt.subtotal)}</td></tr>
    ${settings.showTax ? `<tr><td class="label">IVA</td><td class="value">${money(receipt.tax)}</td></tr>` : ""}
    ${settings.showDiscount && receipt.discount > 0 ? `<tr><td class="label">Descuento</td><td class="value">-${money(receipt.discount)}</td></tr>` : ""}
    ${receipt.tip > 0 ? `<tr><td class="label">Propina</td><td class="value">${money(receipt.tip)}</td></tr>` : ""}
    <tr class="grand-total"><td class="label">TOTAL</td><td class="value">${money(receipt.total)}</td></tr>
    ${receipt.received > 0 ? `<tr><td class="label">Recibido</td><td class="value">${money(receipt.received)}</td></tr>` : ""}
    ${receipt.change > 0 ? `<tr><td class="label">Cambio</td><td class="value">${money(receipt.change)}</td></tr>` : ""}
  `;
}

function renderFooter(settings: PrintSettings): string {
  const lines = settings.footerMessage
    .split("\n")
    .map((line) => escapeHtml(line.trim()))
    .filter(Boolean);
  return lines.join("<br/>");
}

function renderHeader(business: Business, settings: PrintSettings, accent: string): string {
  const logo =
    settings.showLogo && business.logo
      ? `<img src="${escapeHtml(business.logo)}" alt="" class="logo" />`
      : "";
  return `
    ${logo}
    <h1>${escapeHtml(business.name || "VIMDY")}</h1>
    <p class="subtitle">
      ${business.nit ? `NIT ${escapeHtml(business.nit)}<br/>` : ""}
      ${settings.showAddress && business.address ? `${escapeHtml(business.address)}<br/>` : ""}
      ${settings.showPhone && business.phone ? `${escapeHtml(business.phone)}` : ""}
      ${settings.showPhone && business.phone && settings.showEmail && business.email ? " · " : ""}
      ${settings.showEmail && business.email ? `${escapeHtml(business.email)}` : ""}
    </p>
  `;
}

function renderMeta(receipt: Receipt, settings: PrintSettings): string {
  return `
    <div class="meta">
      ${metaLine("Factura:", receipt.code)}
      ${metaLine("Fecha:", receipt.createdAt.toLocaleString("es-CO"))}
      ${settings.showCustomer ? metaLine("Cliente:", receipt.customerName) : ""}
      ${settings.showCashier ? metaLine("Cajero:", receipt.cashier) : ""}
      ${metaLine("Pago:", receipt.paymentMethod)}
    </div>
  `;
}

function renderQr(business: Business, settings: PrintSettings): string {
  if (!settings.showQr) return "";

  const link = whatsappOrderLink(business);
  if (!link) return "";

  return `
    <div class="qr-wrap">
      <div class="qr-block">
        <img src="${qrImageUrl(link)}" alt="QR WhatsApp" width="90" height="90" />
        <p class="qr-caption">Escanea y pide por WhatsApp</p>
      </div>
    </div>
  `;
}

/**
 * Genera el HTML completo del documento (listo para window.print) de un
 * ticket, según la plantilla y las opciones elegidas en Configuración >
 * Impresión. Todas las plantillas comparten estructura de datos; lo que
 * cambia es el CSS y qué bloques se muestran/omiten.
 */
export function renderReceiptDocument(
  receipt: Receipt,
  items: PrintableReceiptItem[],
  business: Business,
  settings: PrintSettings,
  currency: string,
  autoPrint: boolean
): string {
  const money = (value: number) => formatMoney(Math.max(value, 0), currency);
  const accent = accentHex(settings);
  const { width, fontSize } = paperWidthCss(settings);
  const isA4 = settings.paperWidth === "a4";

  const rows = renderItemRows(items, money);
  const totals = renderTotalsRows(receipt, settings, money);
  const header = renderHeader(business, settings, accent);
  const meta = renderMeta(receipt, settings);
  const qr = renderQr(business, settings);
  const footer = renderFooter(settings);

  const baseStyle = `
    * { box-sizing: border-box; }
    html, body { background: ${settings.template === "moderno" ? "#f4f4f5" : "#fff"}; }
    body {
      font-family: ${settings.template === "clasico" || settings.template === "supermercado" ? "'Courier New', monospace" : "'Segoe UI', Arial, sans-serif"};
      width: ${width};
      margin: 0 auto;
      padding: ${isA4 ? "28px" : "14px"};
      color: #111;
      font-size: ${fontSize};
      line-height: 1.45;
    }
    .ticket { ${settings.template === "moderno" ? `background:#fff; border-radius:14px; padding:16px; box-shadow:0 1px 3px rgba(0,0,0,.08);` : ""} }
    .logo { display:block; margin:0 auto 6px; max-width:64px; max-height:64px; object-fit:contain; }
    h1 { font-size: ${isA4 ? "22px" : "16px"}; text-align: center; margin: 0 0 2px; letter-spacing: .5px; }
    .subtitle { text-align: center; font-size: 10px; color:#555; margin-bottom: 8px; }
    .divider { border-top: 1px dashed #999; margin: 8px 0; }
    .meta-line { margin: 2px 0; }
    .meta-label { color: #666; margin-right: 4px; }
    table { width: 100%; border-collapse: collapse; margin-top: 6px; }
    .item-name { padding-top: 6px; font-weight: 600; }
    .qty { color: #555; }
    .line-total { text-align: right; }
    .totals td { padding-top: 2px; }
    .totals .label { color: #555; }
    .totals .value { text-align: right; }
    .grand-total { font-size: ${isA4 ? "18px" : "14px"}; font-weight: 800; border-top: 1px solid #111; padding-top: 4px; color: ${settings.template === "moderno" ? accent : "#111"}; }
    .footer { text-align: center; margin-top: 14px; font-size: 10px; color:#555; }
    .qr-wrap { display:flex; justify-content:center; margin: 12px 0 4px; }
    .qr-block { display:flex; flex-direction:column; align-items:center; gap:3px; }
    .qr-caption { font-size: 9px; color:#666; margin:0; }
    .powered { text-align:center; font-size:9px; color:#aaa; margin-top:6px; }
    @media print { html, body { background: #fff; } .ticket { box-shadow:none; } }
  `;

  const templateStyle: Record<string, string> = {
    clasico: `
      h1 { letter-spacing: 1px; }
      .grand-total { color:#111; }
    `,
    moderno: `
      h1 { color:#111; }
      .divider { border-top: 1px dashed ${accent}55; }
      .meta { background:#fafafa; border-radius:10px; padding:8px 10px; }
      .item-name { color:#111; }
      body { background:#f4f4f5; }
    `,
    restaurante: `
      h1 { text-transform: uppercase; }
      .meta { border: 1px dashed #999; border-radius:8px; padding:6px 8px; }
      .item-name { font-size: 1.05em; }
    `,
    supermercado: `
      .item-name { font-weight: 400; }
      .divider { border-top: 1px solid #ccc; }
      .grand-total { font-size: 15px; }
    `,
    cafeteria: `
      body { padding-top: 8px; }
      .subtitle { margin-bottom: 4px; }
      .footer { margin-top: 8px; }
    `
  };

  const html = `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8" />
<title>Recibo ${escapeHtml(receipt.code)}</title>
<style>${baseStyle}${templateStyle[settings.template] ?? ""}</style>
</head>
<body>
  <div class="ticket">
    ${header}
    <div class="divider"></div>
    ${meta}
    <div class="divider"></div>
    <table>${rows}</table>
    <div class="divider"></div>
    <table class="totals">${totals}</table>
    ${qr}
    <div class="footer">${footer}</div>
    <div class="powered">Generado por VIMDY OS</div>
  </div>
  ${
    autoPrint
      ? `<script>
    window.onload = function () { window.focus(); window.print(); };
    window.onafterprint = function () { window.close(); };
  </script>`
      : ""
  }
</body>
</html>`;

  return html;
}