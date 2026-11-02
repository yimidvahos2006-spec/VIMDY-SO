import React, { useEffect, useId, useRef, type KeyboardEvent } from "react";
import { X } from "lucide-react";

import { useEscapeToClose } from "../../../../hooks/useEscapeToClose";
import { FOCUS_RING } from "./useRadioGroup";

interface TicketPreviewModalProps {
  open: boolean;
  onClose: () => void;
  title?: string;
  children: React.ReactNode;
}

const FOCUSABLE =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Diálogo accesible para la vista previa ampliada:
 *  - role="dialog" + aria-modal + aria-labelledby (nombre accesible = el título visible)
 *  - Escape cierra (useEscapeToClose); clic en el fondo también
 *  - el foco entra al diálogo al abrir, queda atrapado con Tab/Shift+Tab y
 *    vuelve al botón que lo abrió al cerrar
 *  - bloquea el scroll del fondo mientras está abierto
 */
export function TicketPreviewModal({
  open,
  onClose,
  title = "Vista previa del ticket",
  children
}: TicketPreviewModalProps) {
  const titleId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  useEscapeToClose(onClose, open);

  useEffect(() => {
    if (!open) return undefined;
    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeRef.current?.focus();

    return () => {
      document.body.style.overflow = previousOverflow;
      previouslyFocused?.focus();
    };
  }, [open]);

  if (!open) return null;

  function trapTab(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key !== "Tab") return;
    const focusable = Array.from(dialogRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? []);
    if (focusable.length === 0) {
      event.preventDefault();
      return;
    }
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    const active = document.activeElement;
    if (event.shiftKey && (active === first || !dialogRef.current?.contains(active))) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && (active === last || !dialogRef.current?.contains(active))) {
      event.preventDefault();
      first.focus();
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onKeyDown={trapTab}
        className="flex max-h-[90vh] w-full max-w-xl flex-col rounded-vimdy-xl border border-vimdy-border bg-vimdy-surface shadow-vimdy-lg"
      >
        <div className="flex items-center justify-between border-b border-vimdy-border-subtle px-5 py-4">
          <h2 id={titleId} className="text-vimdy-h3 text-vimdy-text">
            {title}
          </h2>
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            aria-label="Cerrar vista previa"
            className={`flex h-9 w-9 items-center justify-center rounded-full text-vimdy-text-secondary transition-colors duration-vimdy-fast hover:bg-vimdy-surface-hover hover:text-vimdy-text ${FOCUS_RING}`}
          >
            <X size={18} aria-hidden="true" />
          </button>
        </div>
        <div className="overflow-y-auto p-5">{children}</div>
      </div>
    </div>
  );
}