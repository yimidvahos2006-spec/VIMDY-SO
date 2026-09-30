import React from "react";
import { Sparkles, X } from "lucide-react";

import { useCopilot } from "../../../core/store/useCopilot";
import { copilotStore } from "../../../core/store/copilotStore";

/**
 * CopilotButton
 * ---------------------------------------------------------------------------
 * Botón flotante, siempre visible en cualquier pantalla de VIMDY (se monta
 * una sola vez en VimdyAppLayout). Es la puerta de entrada al "gerente
 * virtual": un clic abre/cierra el panel de conversación.
 */
export function CopilotButton() {
  const { isOpen, isLoading } = useCopilot();

  return (
    <button
      onClick={() => copilotStore.toggle()}
      className={`
        fixed bottom-6 right-6 z-[60]
        w-16 h-16 rounded-full
        flex items-center justify-center
        shadow-2xl transition-all duration-300
        ${isOpen ? "bg-slate-800 border border-slate-600" : "bg-gradient-to-br from-cyan-500 to-cyan-600 hover:scale-105"}
      `}
      aria-label="Copiloto VIMDY"
    >
      {isOpen ? (
        <X size={26} className="text-white" />
      ) : (
        <div className="relative">
          <Sparkles size={26} className="text-white" />
          {isLoading && (
            <span className="absolute -top-1 -right-1 w-3 h-3 rounded-full bg-emerald-400 animate-ping" />
          )}
        </div>
      )}
    </button>
  );
}

export default CopilotButton;