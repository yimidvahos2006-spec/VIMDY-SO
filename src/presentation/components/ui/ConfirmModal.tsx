import React, { useEffect, useRef } from "react";
import { AlertTriangle } from "lucide-react";

/**
 * Reemplazo del `window.confirm()` nativo del navegador.
 *
 * El confirm nativo muestra el nombre del dominio ("app.vimdy.co dice") y
 * botones del sistema operativo — se ve como un aviso técnico, no como parte
 * de la app, y no existe en una app instalada. Este modal se ve y se
 * comporta como el resto de VIMDY: mismo fondo oscuro, mismas tarjetas, mismos
 * botones.
 *
 * Dos formas de usarlo:
 *  - Imperativa (recomendada, igual que `window.confirm`):
 *      const ok = await confirmDialog({ title, message, danger: true });
 *    Se muestra desde <ConfirmHost /> (montado una vez en main.tsx).
 *  - Controlada: renderizar <ConfirmModal /> con un estado propio del padre
 *    (así lo usan InventoryDashboard e InsumosPanel).
 *
 * Accesibilidad: role="alertdialog", Escape cancela, tocar fuera cancela y en
 * acciones destructivas el foco inicial va a "Cancelar" para que un Enter
 * accidental nunca elimine nada.
 */
export function ConfirmModal({
  title,
  message,
  confirmLabel = "Aceptar",
  cancelLabel = "Cancelar",
  danger = false,
  onConfirm,
  onCancel,
}: {
  title: string;
  message: React.ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Resalta el botón de confirmar en rojo, para acciones destructivas (eliminar). */
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const cancelRef = useRef<HTMLButtonElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);
  const onCancelRef = useRef(onCancel);
  onCancelRef.current = onCancel;

  useEffect(() => {
    (danger ? cancelRef : confirmRef).current?.focus();

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.stopPropagation();
        onCancelRef.current();
      }
    }
    // En captura: Escape cierra SOLO este aviso y no el modal que está debajo.
    document.addEventListener("keydown", onKeyDown, true);
    return () => document.removeEventListener("keydown", onKeyDown, true);
  }, [danger]);

  return (
    <div
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="vimdy-confirm-title"
      aria-describedby="vimdy-confirm-message"
      className="fixed inset-0 z-[200] flex items-center justify-center bg-black/60 p-4"
      onClick={(e) => e.target === e.currentTarget && onCancel()}
    >
      <div
        className="w-full max-w-sm rounded-2xl border border-slate-700 bg-slate-800 p-6 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start gap-3 mb-2">
          {danger && (
            <div className="w-9 h-9 rounded-full bg-red-500/15 flex items-center justify-center shrink-0">
              <AlertTriangle size={18} className="text-red-400" />
            </div>
          )}
          <h2 id="vimdy-confirm-title" className="text-slate-100 font-semibold text-base pt-1.5">
            {title}
          </h2>
        </div>

        <p id="vimdy-confirm-message" className="text-slate-400 text-sm mb-6 whitespace-pre-line">
          {message}
        </p>

        <div className="flex justify-end gap-2">
          <button
            ref={cancelRef}
            type="button"
            onClick={onCancel}
            className="h-10 px-4 rounded-lg border border-slate-700 text-slate-300 text-sm font-medium hover:bg-slate-700/50 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-400"
          >
            {cancelLabel}
          </button>
          <button
            ref={confirmRef}
            type="button"
            onClick={onConfirm}
            className={`h-10 px-4 rounded-lg text-sm font-semibold transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-800 ${
              danger
                ? "bg-red-500 text-white hover:bg-red-400 focus-visible:ring-red-300"
                : "bg-vimdy-accent text-white hover:bg-vimdy-accent-hover focus-visible:ring-vimdy-accent"
            }`}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}