import React, { useMemo, useState } from "react";
import { Printer, Check } from "lucide-react";

import {
  printSettingsStore,
  PrintSettings,
  RECEIPT_TEMPLATES,
  ACCENT_COLORS,
  ReceiptTemplateId,
  PaperWidth,
  AccentColor
} from "../../../core/store/printSettingsStore";
import { Business } from "../../../core/store/businessStore";
import { VimdyButton } from "../ui/VimdyButton";
import type { Receipt } from "../../../core/engines/ReceiptEngine";
import {
  renderReceiptDocument,
  PrintableReceiptItem
} from "../../utils/receiptTemplateRenderer";

const inputClass =
  "w-full h-10 rounded-xl bg-vimdy-surface border border-slate-700 px-3 text-white text-sm outline-none focus:border-cyan-500";

function Toggle({
  label,
  checked,
  onChange
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className="w-full flex items-center justify-between gap-3 py-2 text-left"
    >
      <span className="text-white text-sm">{label}</span>
      <span
        className={`relative flex-shrink-0 h-6 w-11 rounded-full transition-colors ${
          checked ? "bg-cyan-500" : "bg-slate-700"
        }`}
      >
        <span
          className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white transition-transform ${
            checked ? "translate-x-5" : ""
          }`}
        />
      </span>
    </button>
  );
}

/** Recibo + items de ejemplo, solo para que la vista previa tenga algo que mostrar. */
function buildSampleReceipt(business: Business): { receipt: Receipt; items: PrintableReceiptItem[] } {
  const items: PrintableReceiptItem[] = [
    { name: "Plato de Chorizos", quantity: 2, price: 3500 },
    { name: "Limonada natural", quantity: 1, price: 8000 }
  ];
  const subtotal = items.reduce((sum, i) => sum + i.quantity * i.price, 0);
  const tax = Math.round(subtotal * 0.19);
  const total = subtotal + tax;

  const receipt: Receipt = {
    id: "preview",
    code: "A-000124",
    customerId: "preview",
    customerName: "Juan Pérez",
    cashier: "Carlos",
    paymentMethod: "Efectivo",
    items: [],
    currency: business.currency || "COP",
    subtotal,
    tax,
    discount: 0,
    tip: 0,
    total,
    received: total,
    change: 0,
    createdAt: new Date()
  };

  return { receipt, items };
}

export function PrintSettingsSection({ business }: { business: Business }) {
  const [settings, setSettings] = useState<PrintSettings>(printSettingsStore.get());
  const [saved, setSaved] = useState(false);

  const { receipt, items } = useMemo(() => buildSampleReceipt(business), [business]);

  const previewHtml = useMemo(
    () => renderReceiptDocument(receipt, items, business, settings, settings ? receipt.currency : "COP", false),
    [receipt, items, business, settings]
  );

  function patch(data: Partial<PrintSettings>) {
    setSettings((prev) => ({ ...prev, ...data }));
  }

  function handleSave() {
    printSettingsStore.update(settings);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  return (
    <div className="rounded-2xl border border-slate-700 bg-slate-800 p-5 lg:col-span-2">
      <div className="flex items-center gap-3 mb-1">
        <div className="w-10 h-10 rounded-xl bg-vimdy-surface flex items-center justify-center flex-shrink-0">
          <Printer size={18} className="text-cyan-400" />
        </div>
        <div>
          <h3 className="text-white font-bold">Impresión</h3>
          <p className="text-slate-400 text-xs">
            Diseña el ticket que reciben tus clientes. Los cambios se ven al instante en la vista previa.
          </p>
        </div>
      </div>

      <div className="mt-4 grid grid-cols-1 xl:grid-cols-[1fr_320px] gap-6">
        {/* Controles */}
        <div className="space-y-5">
          {/* Plantillas */}
          <div>
            <p className="text-xs text-slate-400 mb-2">Plantilla</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {RECEIPT_TEMPLATES.map((tpl) => (
                <button
                  key={tpl.id}
                  type="button"
                  aria-pressed={settings.template === tpl.id}
                  onClick={() => patch({ template: tpl.id as ReceiptTemplateId })}
                  className={`text-left rounded-xl border px-3 py-2.5 transition ${
                    settings.template === tpl.id
                      ? "border-cyan-500 bg-cyan-500/10"
                      : "border-slate-700 bg-vimdy-surface hover:border-slate-600"
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="text-white text-sm font-semibold">{tpl.name}</span>
                    {settings.template === tpl.id && <Check size={14} className="text-cyan-400" />}
                  </div>
                  <p className="text-slate-500 text-xs mt-0.5">{tpl.description}</p>
                </button>
              ))}
            </div>
          </div>

          {/* Ancho de papel + color */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-slate-400">Ancho de papel</label>
              <select
                className={`${inputClass} mt-1`}
                value={settings.paperWidth}
                onChange={(e) => patch({ paperWidth: e.target.value as PaperWidth })}
              >
                <option value="58mm">58 mm (térmica angosta)</option>
                <option value="80mm">80 mm (térmica estándar)</option>
                <option value="a4">A4 / carta</option>
              </select>
            </div>
            <div>
              <label className="text-xs text-slate-400">Color principal</label>
              <div className="mt-1 flex items-center gap-2 h-10">
                {ACCENT_COLORS.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    title={c.name}
                    aria-label={c.name}
                    aria-pressed={settings.accentColor === c.id}
                    onClick={() => patch({ accentColor: c.id as AccentColor })}
                    className={`w-7 h-7 rounded-full border-2 transition ${
                      settings.accentColor === c.id ? "border-white scale-110" : "border-transparent"
                    }`}
                    style={{ backgroundColor: c.hex }}
                  />
                ))}
              </div>
            </div>
          </div>
          <p className="text-slate-500 text-xs -mt-2">
            El color solo afecta la vista previa e impresoras a color; las térmicas imprimen en negro.
          </p>

          {/* Toggles */}
          <div>
            <p className="text-xs text-slate-400 mb-1">Qué mostrar en el ticket</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 divide-y divide-slate-700/60 sm:divide-y-0">
              <Toggle label="Logo" checked={settings.showLogo} onChange={(v) => patch({ showLogo: v })} />
              <Toggle label="Código QR" checked={settings.showQr} onChange={(v) => patch({ showQr: v })} />
              <Toggle label="Dirección" checked={settings.showAddress} onChange={(v) => patch({ showAddress: v })} />
              <Toggle label="Teléfono" checked={settings.showPhone} onChange={(v) => patch({ showPhone: v })} />
              <Toggle label="Correo" checked={settings.showEmail} onChange={(v) => patch({ showEmail: v })} />
              <Toggle label="Cajero" checked={settings.showCashier} onChange={(v) => patch({ showCashier: v })} />
              <Toggle label="Cliente" checked={settings.showCustomer} onChange={(v) => patch({ showCustomer: v })} />
              <Toggle label="IVA" checked={settings.showTax} onChange={(v) => patch({ showTax: v })} />
              <Toggle
                label="Descuentos"
                checked={settings.showDiscount}
                onChange={(v) => patch({ showDiscount: v })}
              />
            </div>
          </div>

          {/* Mensaje final */}
          <div>
            <label className="text-xs text-slate-400">Mensaje al final del ticket</label>
            <textarea
              className={`${inputClass} h-16 py-2 resize-none`}
              value={settings.footerMessage}
              onChange={(e) => patch({ footerMessage: e.target.value })}
              placeholder={"Gracias por su compra\n¡Los esperamos nuevamente!"}
            />
          </div>

          <div className="flex items-center justify-between pt-1">
            {saved && (
              <span className="inline-flex items-center gap-1 text-xs font-semibold text-green-400">
                <Check size={13} />
                Guardado
              </span>
            )}
            <VimdyButton
              onClick={handleSave}
              variant="primary"
              size="sm"
              className="ml-auto"
            >
              Guardar plantilla de impresión
            </VimdyButton>
          </div>
        </div>

        {/* Vista previa en tiempo real */}
        <div>
          <p className="text-xs text-slate-400 mb-2">Vista previa en tiempo real</p>
          <div className="rounded-xl border border-slate-700 bg-slate-950 p-3 h-[560px] overflow-auto flex justify-center">
            <iframe
              title="Vista previa del ticket"
              srcDoc={previewHtml}
              className="bg-white rounded-md shadow-inner"
              style={{ width: settings.paperWidth === "a4" ? "100%" : "260px", height: "1400px", border: "none" }}
            />
          </div>
        </div>
      </div>
    </div>
  );
}