import React, { forwardRef, useId } from "react";

interface VimdySelectProps
  extends Omit<React.SelectHTMLAttributes<HTMLSelectElement>, "className" | "size"> {
  className?: string;
  label?: string;
  error?: string;
  hint?: string;
  size?: "sm" | "md";
  children: React.ReactNode;
}

export const VimdySelect = forwardRef<HTMLSelectElement, VimdySelectProps>(
  ({ className = "", label, error, hint, size = "md", id, children, ...props }, ref) => {
    const generatedId = useId();
    const selectId = id ?? generatedId;

    const SIZE_CLASS =
      size === "sm" ? "text-vimdy-small py-vimdy-xs" : "text-vimdy-body py-vimdy-sm";

    const select = (
      <select
        ref={ref}
        id={selectId}
        aria-invalid={!!error}
        aria-describedby={error ? `${selectId}-error` : hint ? `${selectId}-hint` : undefined}
        className={`
          w-full
          rounded-vimdy-sm
          border
          bg-vimdy-surface
          px-vimdy-md
          ${SIZE_CLASS}
          text-vimdy-text
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
      >
        {children}
      </select>
    );

    if (!label && !error && !hint) {
      return select;
    }

    return (
      <div className="flex w-full flex-col gap-1.5">
        {label && (
          <label htmlFor={selectId} className="vimdy-small text-vimdy-text-secondary">
            {label}
          </label>
        )}
        {select}
        {error ? (
          <span id={`${selectId}-error`} className="vimdy-micro normal-case text-vimdy-danger">
            {error}
          </span>
        ) : hint ? (
          <span id={`${selectId}-hint`} className="vimdy-micro normal-case text-vimdy-text-tertiary">
            {hint}
          </span>
        ) : null}
      </div>
    );
  }
);

VimdySelect.displayName = "VimdySelect";
