import React from "react";
import { AlertTriangle } from "lucide-react";

/**
 * Reemplazo del `window.confirm()` nativo del navegador.
 *
 * El confirm nativo muestra el nombre del dominio ("localhost:5173 dice") y
 * botones del sistema operativo — se ve como un aviso técnico, no como parte
 * de la app, y en producción (dominio real) seguiría rompiendo la experiencia
 * igual. Este modal se ve y se comporta como el resto de VIMDY: mismo fondo
 * oscuro, mismas tarjetas, mismos botones.
 *
 * Uso: se controla con un solo estado en el componente padre (ej. el
 * producto que se quiere eliminar). Mientras ese estado es `null`, el modal
 * no se renderiza — no hay que manejar visibilidad aparte.
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
  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 p-4"
      onClick={(e) => e.target === e.currentTarget && onCancel()}
    >
      <div
        className="w-full max-w-sm rounded-2xl border border-slate-700 bg-slate-800 p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start gap-3 mb-2">
          {danger && (
            <div className="w-9 h-9 rounded-full bg-red-500/15 flex items-center justify-center shrink-0">
              <AlertTriangle size={18} className="text-red-400" />
            </div>
          )}
          <h2 className="text-slate-100 font-semibold text-base pt-1.5">{title}</h2>
        </div>

        <p className="text-slate-400 text-sm mb-6 pl-0">{message}</p>

        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="h-10 px-4 rounded-lg border border-slate-700 text-slate-300 text-sm font-medium hover:bg-slate-700/50 transition-colors"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            autoFocus
            className={`h-10 px-4 rounded-lg text-sm font-semibold transition-colors ${
              danger
                ? "bg-red-500 text-white hover:bg-red-400"
                : "bg-vimdy-accent text-white hover:bg-vimdy-accent-hover"
            }`}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}