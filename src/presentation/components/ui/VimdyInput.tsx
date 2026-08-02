import React, { forwardRef, useId } from "react";

/**
 * VIMDY DESIGN SYSTEM v1.0 — VimdyInput
 * -------------------------------------------------------------
 * Única versión oficial de input de texto. Todos los módulos
 * deben usar este componente — nunca un <input> suelto con
 * clases propias (ver ejemplo del <select> a mano en
 * FirstProductStep.tsx, que se migra a VimdySelect en el
 * siguiente archivo de este mismo paso).
 *
 * `label` y `error` son opcionales: si no se pasan, el
 * componente se comporta exactamente como el input plano
 * anterior (compatibilidad total con los ~13 usos actuales).
 * -------------------------------------------------------------
 */

interface VimdyInputProps
  extends Omit<React.InputHTMLAttributes<HTMLInputElement>, "className" | "size"> {
  className?: string;
  label?: string;
  error?: string;
  hint?: string;
  icon?: React.ReactNode;
  size?: "sm" | "md";
}

export const VimdyInput = forwardRef<HTMLInputElement, VimdyInputProps>(
  ({ className = "", label, error, hint, icon, size = "md", id, ...props }, ref) => {
    const generatedId = useId();
    const inputId = id ?? generatedId;

    const SIZE_CLASS =
      size === "sm" ? "text-vimdy-small py-vimdy-xs" : "text-vimdy-body py-vimdy-sm";

    const input = (
      <div className="relative w-full">
        {icon && (
          <span className="pointer-events-none absolute left-vimdy-md top-1/2 -translate-y-1/2 text-vimdy-text-tertiary">
            {icon}
          </span>
        )}
        <input
          ref={ref}
          id={inputId}
          aria-invalid={!!error}
          aria-describedby={error ? `${inputId}-error` : hint ? `${inputId}-hint` : undefined}
          className={`
            w-full
            rounded-vimdy-sm
            border
            bg-vimdy-surface
            px-vimdy-md
            ${icon ? "pl-10" : ""}
            ${SIZE_CLASS}
            text-vimdy-text
            placeholder:text-vimdy-text-tertiary
            outline-none
            transition-colors
            duration-vimdy-fast
            disabled:opacity-50
            disabled:cursor-not-allowed
            ${
              error
                ? "border-vimdy-danger focus:border-vimdy-danger focus:ring-2 focus:ring-vimdy-danger/20"
                : "border-vimdy-border focus:border-vimdy-accent focus:ring-2 focus:ring-vimdy-accent/20"
            }
            ${className}
          `}
          {...props}
        />
      </div>
    );

    if (!label && !error && !hint) {
      return input;
    }

    return (
      <div className="flex w-full flex-col gap-1.5">
        {label && (
          <label htmlFor={inputId} className="vimdy-small text-vimdy-text-secondary">
            {label}
          </label>
        )}
        {input}
        {error ? (
          <span id={`${inputId}-error`} className="vimdy-micro normal-case text-vimdy-danger">
            {error}
          </span>
        ) : hint ? (
          <span id={`${inputId}-hint`} className="vimdy-micro normal-case text-vimdy-text-tertiary">
            {hint}
          </span>
        ) : null}
      </div>
    );
  }
);

VimdyInput.displayName = "VimdyInput";