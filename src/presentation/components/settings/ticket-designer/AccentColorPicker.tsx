import React, { useId } from "react";
import { Check } from "lucide-react";

import {
  ACCENT_COLORS,
  RECEIPT_TEMPLATES,
  type AccentColor,
  type ReceiptTemplateId
} from "../../../../core/store/printSettingsStore";
import { ACCENT_IDS } from "../../../../core/settings/ticketDesigner";
import { ACCENT_AWARE_TEMPLATES } from "../../../utils/receiptTemplateRenderer";
import { FOCUS_RING, useRadioGroup } from "./useRadioGroup";

interface AccentColorPickerProps {
  value: AccentColor;
  template: ReceiptTemplateId;
  onChange: (next: AccentColor) => void;
  disabled?: boolean;
}

export function AccentColorPicker({ value, template, onChange, disabled = false }: AccentColorPickerProps) {
  const labelId = useId();
  const noteId = useId();
  const { getItemProps } = useRadioGroup(ACCENT_IDS, value, onChange, disabled);

  const templateName = RECEIPT_TEMPLATES.find((t) => t.id === template)?.name ?? "";
  const aware = ACCENT_AWARE_TEMPLATES.includes(template);
  const awareNames = RECEIPT_TEMPLATES.filter((t) => ACCENT_AWARE_TEMPLATES.includes(t.id))
    .map((t) => t.name)
    .join(", ");

  return (
    <div>
      <p id={labelId} className="mb-2 text-vimdy-small font-semibold text-vimdy-text">
        Color principal
      </p>
      <div
        role="radiogroup"
        aria-labelledby={labelId}
        aria-describedby={noteId}
        className="flex items-center gap-3"
      >
        {ACCENT_COLORS.map((color, index) => {
          const selected = color.id === value;
          return (
            <button
              key={color.id}
              type="button"
              {...getItemProps(index)}
              aria-label={color.name}
              title={color.name}
              className={`flex h-10 w-10 items-center justify-center rounded-full border-2 transition-transform duration-vimdy-fast disabled:cursor-not-allowed disabled:opacity-50 ${FOCUS_RING} ${
                selected ? "scale-110 border-white" : "border-white/20 hover:border-white/50"
              }`}
              style={{ backgroundColor: color.hex }}
            >
              {selected && <Check size={16} aria-hidden="true" className="text-white drop-shadow" />}
            </button>
          );
        })}
      </div>
      <p id={noteId} className="mt-2 text-vimdy-micro text-vimdy-text-secondary">
        {aware
          ? `El color se ve en ${awareNames}. Las impresoras térmicas imprimen en negro.`
          : `${templateName} imprime en negro: el color solo se ve en ${awareNames}.`}
      </p>
    </div>
  );
}