import React, { useId } from "react";
import { Check } from "lucide-react";

import {
  ACCENT_COLORS,
  RECEIPT_TEMPLATES,
  type AccentColor,
  type ReceiptTemplateId
} from "../../../../core/store/printSettingsStore";
import { TEMPLATE_IDS } from "../../../../core/settings/ticketDesigner";
import { FOCUS_RING, useRadioGroup } from "./useRadioGroup";

interface TemplatePickerProps {
  value: ReceiptTemplateId;
  accentColor: AccentColor;
  onChange: (next: ReceiptTemplateId) => void;
  disabled?: boolean;
}

/** Cada miniatura es solo un dibujo del "carácter" de la plantilla; es decorativa (aria-hidden). */
function TemplateThumb({ id, accent }: { id: ReceiptTemplateId; accent: string }) {
  const line = "h-[3px] rounded-full bg-zinc-400/70";
  const mono = id === "clasico" || id === "supermercado";
  const rows = id === "supermercado" ? 7 : id === "cafeteria" ? 2 : 4;

  return (
    <div
      aria-hidden="true"
      className={`flex h-[72px] w-14 flex-shrink-0 flex-col gap-[5px] rounded-md p-1.5 ${
        id === "moderno" ? "bg-zinc-100 ring-1 ring-white/10" : "bg-white"
      }`}
    >
      {id !== "supermercado" && (
        <div
          className="mx-auto h-[5px] w-8 rounded-full"
          style={{ backgroundColor: id === "restaurante" ? accent : "#27272a" }}
        />
      )}
      {id === "moderno" && <div className="mx-auto h-4 w-4 rounded-sm bg-zinc-300" />}
      {id === "restaurante" && (
        <div className="rounded-sm border border-dashed border-zinc-400 p-[3px]">
          <div className={`${line} w-6`} />
        </div>
      )}
      <div className="flex flex-col gap-[3px]">
        {Array.from({ length: rows }, (_, index) => (
          <div key={index} className={`${line} ${mono ? "w-full" : index % 2 ? "w-7" : "w-9"}`} />
        ))}
      </div>
      <div
        className="mt-auto h-[5px] w-10 self-end rounded-full"
        style={{ backgroundColor: id === "clasico" || id === "supermercado" ? "#27272a" : accent }}
      />
    </div>
  );
}

export function TemplatePicker({ value, accentColor, onChange, disabled = false }: TemplatePickerProps) {
  const labelId = useId();
  const { getItemProps } = useRadioGroup(TEMPLATE_IDS, value, onChange, disabled);
  const accent = ACCENT_COLORS.find((color) => color.id === accentColor)?.hex ?? "#06b6d4";

  return (
    <div>
      <p id={labelId} className="mb-2 text-vimdy-small font-semibold text-vimdy-text">
        Plantilla
      </p>
      <div role="radiogroup" aria-labelledby={labelId} className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {RECEIPT_TEMPLATES.map((template, index) => {
          const selected = template.id === value;
          return (
            <button
              key={template.id}
              type="button"
              {...getItemProps(index)}
              className={`group flex items-center gap-3 rounded-vimdy-md border p-2.5 text-left transition-colors duration-vimdy-fast disabled:cursor-not-allowed disabled:opacity-50 ${FOCUS_RING} ${
                selected
                  ? "border-vimdy-accent-hover bg-vimdy-accent/10 ring-1 ring-vimdy-accent-hover"
                  : "border-vimdy-border bg-vimdy-surface hover:border-zinc-600 hover:bg-vimdy-surface-hover"
              }`}
            >
              <TemplateThumb id={template.id} accent={accent} />
              <span className="min-w-0 flex-1">
                <span className="flex items-center justify-between gap-2">
                  <span className="text-vimdy-small font-semibold text-vimdy-text">{template.name}</span>
                  {selected && <Check size={16} aria-hidden="true" className="text-vimdy-accent-hover" />}
                </span>
                <span className="mt-0.5 block text-vimdy-micro text-vimdy-text-secondary">
                  {template.description}
                </span>
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}