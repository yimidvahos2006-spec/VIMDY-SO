import React, { useCallback, useMemo, useRef, useState } from "react";

import type { Business } from "../../../../core/store/businessStore";
import {
  ACCENT_COLORS,
  RECEIPT_TEMPLATES,
  type PrintSettings
} from "../../../../core/store/printSettingsStore";
import { PAPER_OPTIONS, PREVIEW_PAPER_WIDTH_PX } from "../../../../core/settings/ticketDesigner";
import { renderReceiptDocument } from "../../../utils/receiptTemplateRenderer";
import { buildSampleTicket } from "./sampleTicket";

const MIN_FRAME_HEIGHT = 320;

interface TicketPreviewProps {
  business: Business;
  settings: PrintSettings;
  /** Alto máximo del escenario (con scroll interno). Sin valor, crece con el ticket. */
  maxHeight?: string;
}

/**
 * Vista previa EN VIVO: usa el mismo `renderReceiptDocument` que la impresión
 * real, así que lo que se ve aquí es lo que sale impreso. Se recalcula en
 * cada render del padre (es un string; barato) y el iframe se reemplaza por
 * `srcDoc` — sin estado interno que pueda quedar desfasado.
 *
 * El iframe va en `sandbox="allow-same-origin"` SIN `allow-scripts`: el HTML
 * del ticket (con datos del negocio) nunca puede ejecutar código; el
 * same-origin solo sirve para medir el alto y evitar un scroll doble.
 */
export function TicketPreview({ business, settings, maxHeight }: TicketPreviewProps) {
  const frameRef = useRef<HTMLIFrameElement>(null);
  const [height, setHeight] = useState(MIN_FRAME_HEIGHT);

  const html = useMemo(() => {
    const sample = buildSampleTicket(business, settings.template);
    return renderReceiptDocument(
      sample.receipt,
      sample.items,
      business,
      settings,
      sample.receipt.currency,
      false,
      sample.extras
    );
  }, [business, settings]);

  const measure = useCallback(() => {
    const doc = frameRef.current?.contentDocument;
    if (!doc?.documentElement) return;
    setHeight(Math.max(MIN_FRAME_HEIGHT, doc.documentElement.scrollHeight));
  }, []);

  const templateName = RECEIPT_TEMPLATES.find((t) => t.id === settings.template)?.name ?? settings.template;
  const colorName = ACCENT_COLORS.find((c) => c.id === settings.accentColor)?.name ?? settings.accentColor;
  const paperLabel = PAPER_OPTIONS.find((p) => p.id === settings.paperWidth)?.label ?? settings.paperWidth;

  return (
    <div>
      {/* Lectores de pantalla: se anuncia el cambio de plantilla/papel/color, no cada tecla del pie. */}
      <p className="sr-only" role="status" aria-live="polite">
        Vista previa actualizada: plantilla {templateName}, papel {paperLabel}, color {colorName}.
      </p>
      <div
        className="flex justify-center overflow-auto rounded-vimdy-lg border border-vimdy-border bg-black bg-[radial-gradient(circle_at_top,rgba(56,189,248,0.10),transparent_65%)] p-4"
        style={maxHeight ? { maxHeight } : undefined}
      >
        <iframe
          ref={frameRef}
          title="Vista previa del ticket"
          srcDoc={html}
          sandbox="allow-same-origin"
          onLoad={measure}
          className="flex-shrink-0 rounded-md bg-white shadow-vimdy-lg"
          style={{ width: PREVIEW_PAPER_WIDTH_PX[settings.paperWidth], height, border: "none" }}
        />
      </div>
    </div>
  );
}