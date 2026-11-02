import React, { useId } from "react";

import type { PaperWidth } from "../../../../core/store/printSettingsStore";
import { PAPER_OPTIONS } from "../../../../core/settings/ticketDesigner";
import { FOCUS_RING, useRadioGroup } from "./useRadioGroup";

interface PaperWidthSelectorProps {
  value: PaperWidth;
  onChange: (next: PaperWidth) => void;
  disabled?: boolean;
}

const PAPER_IDS = PAPER_OPTIONS.map((option) => option.id);

export function PaperWidthSelector({ value, onChange, disabled = false }: PaperWidthSelectorProps) {
  const labelId = useId();
  const { getItemProps } = useRadioGroup(PAPER_IDS, value, onChange, disabled);

  return (
    <div>
      <p id={labelId} className="mb-2 text-vimdy-small font-semibold text-vimdy-text">
        Ancho de papel
      </p>
      <div
        role="radiogroup"
        aria-labelledby={labelId}
        className="grid grid-cols-3 gap-1 rounded-vimdy-md border border-vimdy-border bg-black p-1"
      >
        {PAPER_OPTIONS.map((option, index) => {
          const selected = option.id === value;
          return (
            <button
              key={option.id}
              type="button"
              {...getItemProps(index)}
              className={`rounded-vimdy-sm px-2 py-2 text-center transition-colors duration-vimdy-fast disabled:cursor-not-allowed disabled:opacity-50 ${FOCUS_RING} ${
                selected
                  ? "bg-vimdy-surface-active text-vimdy-text ring-1 ring-vimdy-accent-hover"
                  : "text-vimdy-text-secondary hover:bg-vimdy-surface-hover hover:text-vimdy-text"
              }`}
            >
              <span className="block text-vimdy-small font-semibold">{option.label}</span>
              <span className="block text-vimdy-micro opacity-80">{option.hint}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}