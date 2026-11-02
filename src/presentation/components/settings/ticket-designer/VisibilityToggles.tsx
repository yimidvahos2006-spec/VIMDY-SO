import React, { useId } from "react";

import type { PrintSettings } from "../../../../core/store/printSettingsStore";
import { VISIBILITY_GROUPS, type VisibilityKey } from "../../../../core/settings/ticketDesigner";
import { FOCUS_RING } from "./useRadioGroup";

interface VisibilityTogglesProps {
  settings: PrintSettings;
  onToggle: (key: VisibilityKey) => void;
  /** Aviso por interruptor (p. ej. "Falta el logo del negocio"); se lee como descripción. */
  notes?: Partial<Record<VisibilityKey, string>>;
  disabled?: boolean;
}

function SwitchRow({
  label,
  hint,
  note,
  checked,
  disabled,
  onToggle
}: {
  label: string;
  hint: string;
  note?: string;
  checked: boolean;
  disabled: boolean;
  onToggle: () => void;
}) {
  const uid = useId();
  const labelId = `${uid}-label`;
  const hintId = `${uid}-hint`;
  const noteId = `${uid}-note`;
  const showNote = Boolean(note) && checked;

  return (
    <div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-labelledby={labelId}
        aria-describedby={showNote ? `${hintId} ${noteId}` : hintId}
        disabled={disabled}
        onClick={onToggle}
        className={`flex w-full items-center justify-between gap-3 rounded-vimdy-md px-2 py-2.5 text-left transition-colors duration-vimdy-fast hover:bg-vimdy-surface-hover disabled:cursor-not-allowed disabled:opacity-50 ${FOCUS_RING}`}
      >
        <span className="min-w-0">
          <span id={labelId} className="block text-vimdy-small font-medium text-vimdy-text">
            {label}
          </span>
          <span id={hintId} className="block text-vimdy-micro text-vimdy-text-secondary">
            {hint}
          </span>
        </span>
        <span
          aria-hidden="true"
          className={`relative h-6 w-11 flex-shrink-0 rounded-full transition-colors duration-vimdy-fast ${
            checked ? "bg-vimdy-accent" : "bg-zinc-700"
          }`}
        >
          <span
            className={`absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform duration-vimdy-fast ${
              checked ? "translate-x-5" : ""
            }`}
          />
        </span>
      </button>
      {showNote && (
        <p id={noteId} className="px-2 pb-1 text-vimdy-micro text-vimdy-warning">
          {note}
        </p>
      )}
    </div>
  );
}

export function VisibilityToggles({ settings, onToggle, notes = {}, disabled = false }: VisibilityTogglesProps) {
  const headingId = useId();

  return (
    <section aria-labelledby={headingId}>
      <h4 id={headingId} className="mb-2 text-vimdy-small font-semibold text-vimdy-text">
        Qué mostrar en el ticket
      </h4>
      <div className="grid grid-cols-1 gap-x-4 gap-y-3 md:grid-cols-2">
        {VISIBILITY_GROUPS.map((group) => (
          <div
            key={group.id}
            role="group"
            aria-label={group.title}
            className="rounded-vimdy-md border border-vimdy-border-subtle bg-black/40 p-1"
          >
            <p className="px-2 pb-1 pt-1.5 text-vimdy-micro font-semibold uppercase tracking-wider text-vimdy-text-tertiary">
              {group.title}
            </p>
            {group.toggles.map((toggle) => (
              <SwitchRow
                key={toggle.key}
                label={toggle.label}
                hint={toggle.hint}
                note={notes[toggle.key]}
                checked={settings[toggle.key]}
                disabled={disabled}
                onToggle={() => onToggle(toggle.key)}
              />
            ))}
          </div>
        ))}
      </div>
    </section>
  );
}