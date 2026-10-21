import React, { useLayoutEffect, useRef } from "react";
import { formatMoneyInput } from "../../../core/utils/formatMoneyInput";

type MoneyInputProps = Omit<
  React.InputHTMLAttributes<HTMLInputElement>,
  "value" | "onChange" | "type" | "inputMode"
> & {
  value: string;
  /** Recibe el texto ya formateado ("3.000"). Para guardar usa parseMoneyInput(value). */
  onValueChange: (formatted: string) => void;
};

const isSignificant = (char: string) => /[\d,]/.test(char);

function caretAfterSignificant(formatted: string, count: number): number {
  if (count <= 0) return 0;
  let seen = 0;
  for (let i = 0; i < formatted.length; i += 1) {
    if (isSignificant(formatted[i])) seen += 1;
    if (seen === count) return i + 1;
  }
  return formatted.length;
}

/**
 * Campo de dinero: muestra los miles con punto mientras se escribe (3000 -> 3.000)
 * y conserva la posición del cursor al editar en medio del número.
 */
export function MoneyInput({ value, onValueChange, onBlur, onKeyDown, ...rest }: MoneyInputProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const pendingCaret = useRef<number | null>(null);

  useLayoutEffect(() => {
    if (pendingCaret.current !== null && inputRef.current) {
      inputRef.current.setSelectionRange(pendingCaret.current, pendingCaret.current);
      pendingCaret.current = null;
    }
  });

  const handleChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const el = event.target;
    const caret = el.selectionStart ?? el.value.length;
    const significantBefore = el.value.slice(0, caret).split("").filter(isSignificant).length;
    const formatted = formatMoneyInput(el.value);
    pendingCaret.current = caretAfterSignificant(formatted, significantBefore);
    onValueChange(formatted);
  };

  // El punto lo pone el formato: Backspace/Delete sobre un punto solo mueven el cursor,
  // si no, el punto se borra y reaparece y la persona se queda "atascada".
  const handleKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    onKeyDown?.(event);
    if (event.defaultPrevented) return;
    const el = event.currentTarget;
    if (el.selectionStart !== el.selectionEnd) return;
    const pos = el.selectionStart ?? 0;
    if (event.key === "Backspace" && el.value[pos - 1] === ".") {
      event.preventDefault();
      el.setSelectionRange(pos - 1, pos - 1);
    } else if (event.key === "Delete" && el.value[pos] === ".") {
      event.preventDefault();
      el.setSelectionRange(pos + 1, pos + 1);
    }
  };

  const handleBlur = (event: React.FocusEvent<HTMLInputElement>) => {
    if (value.endsWith(",")) onValueChange(value.slice(0, -1));
    onBlur?.(event);
  };

  return (
    <input
      {...rest}
      ref={inputRef}
      type="text"
      inputMode="decimal"
      value={value}
      onChange={handleChange}
      onKeyDown={handleKeyDown}
      onBlur={handleBlur}
    />
  );
}