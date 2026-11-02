import { useRef, type KeyboardEvent } from "react";
import { nextRadioIndex } from "../../../../core/settings/ticketDesigner";

/**
 * Comportamiento WAI-ARIA de un `radiogroup` con "roving tabindex":
 * una sola parada con Tab (la opción elegida), flechas/Home/End mueven el foco
 * y seleccionan, y la opción elegida es la única con tabIndex 0.
 */
export function useRadioGroup<T extends string>(
  ids: readonly T[],
  value: T,
  onChange: (next: T) => void,
  disabled = false
) {
  const refs = useRef<Array<HTMLButtonElement | null>>([]);
  const selectedIndex = Math.max(0, ids.indexOf(value));

  function getItemProps(index: number) {
    return {
      role: "radio" as const,
      "aria-checked": ids[index] === value,
      disabled,
      tabIndex: index === selectedIndex ? 0 : -1,
      ref: (element: HTMLButtonElement | null) => {
        refs.current[index] = element;
      },
      onClick: () => onChange(ids[index]),
      onKeyDown: (event: KeyboardEvent<HTMLButtonElement>) => {
        const next = nextRadioIndex(index, event.key, ids.length);
        if (next === null) return;
        event.preventDefault();
        onChange(ids[next]);
        refs.current[next]?.focus();
      }
    };
  }

  return { getItemProps };
}

/** Clases de foco visible compartidas por todos los controles del editor. */
export const FOCUS_RING =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-vimdy-accent-hover focus-visible:ring-offset-2 focus-visible:ring-offset-black";