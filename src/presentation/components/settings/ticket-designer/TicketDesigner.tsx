import React, { useEffect, useId, useReducer, useRef, useState } from "react";
import { Check, Eye, RotateCcw } from "lucide-react";

import type { Business } from "../../../../core/store/businessStore";
import type { PrintSettings } from "../../../../core/store/printSettingsStore";
import {
  designerReducer,
  footerUsage,
  isDraftDirty,
  validateDraft
} from "../../../../core/settings/ticketDesigner";
import { VimdyButton } from "../../ui/VimdyButton";
import { AccentColorPicker } from "./AccentColorPicker";
import { PaperWidthSelector } from "./PaperWidthSelector";
import { TemplatePicker } from "./TemplatePicker";
import { TicketPreview } from "./TicketPreview";
import { TicketPreviewModal } from "./TicketPreviewModal";
import { VisibilityToggles } from "./VisibilityToggles";
import { toggleAvailabilityNotes } from "./sampleTicket";
import { FOCUS_RING } from "./useRadioGroup";

export interface TicketDesignerProps {
  business: Business;
  /** Lo último guardado. Si cambia de valor (otra sucursal, recarga), el borrador se reinicia. */
  initialSettings: PrintSettings;
  /** Persistir. Si lanza, el mensaje se muestra y el borrador se conserva. */
  onSave: (settings: PrintSettings) => void | Promise<void>;
  /** Solo lectura (p. ej. quien no es administrador): ve la vista previa, no puede editar ni guardar. */
  readOnly?: boolean;
}

type SaveState = "idle" | "saving" | "saved";

const panelClass =
  "rounded-vimdy-lg border border-vimdy-border bg-vimdy-surface/80 p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]";

export function TicketDesigner({ business, initialSettings, onSave, readOnly = false }: TicketDesignerProps) {
  const [draft, dispatch] = useReducer(designerReducer, initialSettings);
  const [baseline, setBaseline] = useState<PrintSettings>(initialSettings);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [saveError, setSaveError] = useState<string | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const previewButtonRef = useRef<HTMLButtonElement>(null);

  const footerId = useId();
  const footerHelpId = useId();
  const footerErrorId = useId();

  // Si el padre entrega OTRA configuración guardada (cambio de sucursal, recarga), se parte de ella.
  useEffect(() => {
    if (isDraftDirty(initialSettings, baseline)) {
      dispatch({ type: "reset", to: initialSettings });
      setBaseline(initialSettings);
      setSaveState("idle");
      setSaveError(null);
    }
    // `baseline` no es dependencia a propósito: solo reacciona a lo que entrega el padre.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialSettings]);

  // El aviso "Guardado" se apaga solo.
  useEffect(() => {
    if (saveState !== "saved") return undefined;
    const timer = setTimeout(() => setSaveState("idle"), 2500);
    return () => clearTimeout(timer);
  }, [saveState]);

  const dirty = isDraftDirty(draft, baseline);
  const validation = validateDraft(draft);
  const usage = footerUsage(draft.footerMessage);
  const saving = saveState === "saving";
  const canSave = !readOnly && dirty && validation.ok && !saving;
  const notes = toggleAvailabilityNotes(business);

  async function handleSave() {
    if (!canSave) return;
    setSaveState("saving");
    setSaveError(null);
    try {
      await onSave(draft);
      setBaseline(draft);
      setSaveState("saved");
    } catch (error) {
      setSaveState("idle");
      setSaveError(error instanceof Error ? error.message : "No se pudo guardar el ticket.");
    }
  }

  function handleDiscard() {
    dispatch({ type: "reset", to: baseline });
    setSaveError(null);
  }

  return (
    <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
      {/* ---------------------------- Controles ---------------------------- */}
      <div className="space-y-4">
        <div className={panelClass}>
          <TemplatePicker
            value={draft.template}
            accentColor={draft.accentColor}
            onChange={(value) => dispatch({ type: "template", value })}
            disabled={readOnly}
          />
        </div>

        <div className={`${panelClass} grid grid-cols-1 gap-5 md:grid-cols-2`}>
          <PaperWidthSelector
            value={draft.paperWidth}
            onChange={(value) => dispatch({ type: "paper", value })}
            disabled={readOnly}
          />
          <AccentColorPicker
            value={draft.accentColor}
            template={draft.template}
            onChange={(value) => dispatch({ type: "accent", value })}
            disabled={readOnly}
          />
        </div>

        <div className={panelClass}>
          <VisibilityToggles
            settings={draft}
            onToggle={(key) => dispatch({ type: "toggle", key })}
            notes={notes}
            disabled={readOnly}
          />
        </div>

        <div className={panelClass}>
          <label htmlFor={footerId} className="mb-2 block text-vimdy-small font-semibold text-vimdy-text">
            Mensaje al final del ticket
          </label>
          <textarea
            id={footerId}
            rows={3}
            value={draft.footerMessage}
            disabled={readOnly}
            onChange={(event) => dispatch({ type: "footer", value: event.target.value })}
            aria-invalid={usage.over}
            aria-describedby={usage.over ? `${footerHelpId} ${footerErrorId}` : footerHelpId}
            placeholder={"Gracias por su compra\n¡Los esperamos nuevamente!"}
            className={`w-full resize-none rounded-vimdy-md border bg-black px-3 py-2 text-vimdy-small text-vimdy-text placeholder:text-vimdy-text-tertiary disabled:cursor-not-allowed disabled:opacity-50 ${FOCUS_RING} ${
              usage.over ? "border-vimdy-danger" : "border-vimdy-border"
            }`}
          />
          <div className="mt-1 flex items-start justify-between gap-3">
            <p id={footerHelpId} className="text-vimdy-micro text-vimdy-text-secondary">
              {draft.showFooter
                ? "Se imprime debajo de los totales."
                : "El pie de página está desactivado: el texto se conserva pero no se imprime."}
            </p>
            <span
              className={`flex-shrink-0 text-vimdy-micro tabular-nums ${
                usage.over ? "font-semibold text-vimdy-danger" : "text-vimdy-text-tertiary"
              }`}
            >
              {usage.used}/{usage.max}
            </span>
          </div>
          {usage.over && !validation.ok && (
            <p id={footerErrorId} role="alert" className="mt-1 text-vimdy-micro text-vimdy-danger">
              {validation.message}
            </p>
          )}
        </div>

        {/* Acciones */}
        <div className="flex flex-wrap items-center gap-3">
          <div className="min-h-[20px] flex-1" aria-live="polite">
            {saveState === "saved" && (
              <span role="status" className="inline-flex items-center gap-1 text-vimdy-small font-semibold text-vimdy-success">
                <Check size={14} aria-hidden="true" />
                Guardado
              </span>
            )}
            {saveError && (
              <span role="alert" className="text-vimdy-small text-vimdy-danger">
                {saveError}
              </span>
            )}
            {!saveError && saveState !== "saved" && dirty && (
              <span className="text-vimdy-micro text-vimdy-warning">Tienes cambios sin guardar.</span>
            )}
          </div>

          <button
            ref={previewButtonRef}
            type="button"
            onClick={() => setPreviewOpen(true)}
            className={`inline-flex items-center gap-2 rounded-vimdy-sm border border-vimdy-border bg-vimdy-surface px-vimdy-md py-vimdy-xs text-vimdy-small font-semibold text-vimdy-text transition-colors duration-vimdy-fast hover:bg-vimdy-surface-hover xl:hidden ${FOCUS_RING}`}
          >
            <Eye size={16} aria-hidden="true" />
            Vista previa ampliada
          </button>

          {dirty && !readOnly && (
            <VimdyButton variant="ghost" size="sm" onClick={handleDiscard} disabled={saving} icon={<RotateCcw size={14} aria-hidden="true" />}>
              Descartar cambios
            </VimdyButton>
          )}
          {!readOnly && (
            <VimdyButton variant="primary" size="sm" onClick={handleSave} disabled={!canSave} loading={saving}>
              Guardar plantilla de impresión
            </VimdyButton>
          )}
        </div>
        {readOnly && (
          <p className="text-vimdy-micro text-vimdy-text-secondary">
            Solo el administrador puede cambiar el diseño del ticket.
          </p>
        )}
      </div>

      {/* ------------------------ Vista previa en vivo ------------------------ */}
      <aside aria-label="Vista previa en tiempo real" className="hidden xl:block">
        <div className="sticky top-4">
          <p className="mb-2 text-vimdy-small font-semibold text-vimdy-text">Vista previa en tiempo real</p>
          <TicketPreview business={business} settings={draft} maxHeight="calc(100vh - 8rem)" />
        </div>
      </aside>

      <TicketPreviewModal open={previewOpen} onClose={() => setPreviewOpen(false)}>
        <TicketPreview business={business} settings={draft} />
      </TicketPreviewModal>
    </div>
  );
}