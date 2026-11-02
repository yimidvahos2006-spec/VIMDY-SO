import React, { useState } from "react";
import { Printer } from "lucide-react";

import { printSettingsStore, type PrintSettings } from "../../../core/store/printSettingsStore";
import type { Business } from "../../../core/store/businessStore";
import { TicketDesigner } from "./ticket-designer/TicketDesigner";

/**
 * Configuración > Impresión. El editor (plantillas, papel, color, interruptores
 * y vista previa en vivo) vive en ./ticket-designer/TicketDesigner; esta
 * tarjeta solo le da el marco y decide DÓNDE se guarda.
 *
 * Hoy se guarda en el store local del dispositivo (printSettingsStore), que es
 * lo que lee printReceiptDocument. Para guardar por negocio/sucursal en
 * Supabase basta cambiar `handleSave` por `saveTicketPrintSettings(...)` de
 * infrastructure/supabase/ticketPrintSettingsRepository.
 */
export function PrintSettingsSection({ business }: { business: Business }) {
  // useState (y no printSettingsStore.get() en cada render) para que la
  // referencia sea estable y el editor no se reinicie en cada render del padre.
  const [saved, setSaved] = useState<PrintSettings>(() => printSettingsStore.get());

  function handleSave(settings: PrintSettings) {
    printSettingsStore.update(settings);
    setSaved(printSettingsStore.get());
  }

  return (
    <div className="rounded-2xl border border-vimdy-border bg-vimdy-surface p-5 lg:col-span-2">
      <div className="mb-4 flex items-center gap-3">
        <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl bg-black ring-1 ring-vimdy-border">
          <Printer size={18} aria-hidden="true" className="text-vimdy-blue" />
        </div>
        <div>
          <h3 className="font-bold text-vimdy-text">Impresión</h3>
          <p className="text-vimdy-micro text-vimdy-text-secondary">
            Diseña el ticket que reciben tus clientes. Los cambios se ven al instante en la vista previa.
          </p>
        </div>
      </div>

      <TicketDesigner business={business} initialSettings={saved} onSave={handleSave} />
    </div>
  );
}