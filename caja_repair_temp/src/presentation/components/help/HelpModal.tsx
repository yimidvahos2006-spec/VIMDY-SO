import { useState } from "react";
import { HelpCircle, X } from "lucide-react";

export interface HelpSection {
  title: string;
  content: string;
}

export interface HelpContent {
  title: string;
  description: string;
  sections: HelpSection[];
  tips?: string[];
}

interface HelpModalProps {
  isOpen: boolean;
  onClose: () => void;
  content: HelpContent;
}

/**
 * Modal de ayuda contextual.
 *
 * Muestra información sobre cómo funciona un módulo específico.
 * Se abre desde el botón de ayuda (?) en cada módulo.
 */
export function HelpModal({ isOpen, onClose, content }: HelpModalProps) {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[9999] bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="w-full max-w-2xl max-h-[80vh] rounded-3xl bg-vimdy-surface border border-slate-700 shadow-2xl overflow-hidden flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-700 shrink-0">
          <div className="flex items-center gap-3">
            <HelpCircle size={20} className="text-vimdy-accent" />
            <h2 className="text-xl font-bold text-white">{content.title}</h2>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-lg flex items-center justify-center text-slate-400 hover:text-white hover:bg-slate-700 transition-colors"
          >
            <X size={18} />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto px-6 py-6">
          <p className="text-slate-300 mb-6">{content.description}</p>

          <div className="space-y-6">
            {content.sections.map((section, idx) => (
              <div key={idx}>
                <h3 className="text-lg font-semibold text-white mb-2">{section.title}</h3>
                <p className="text-slate-400 text-sm whitespace-pre-line leading-relaxed">
                  {section.content}
                </p>
              </div>
            ))}
          </div>

          {content.tips && content.tips.length > 0 && (
            <div className="mt-6 p-4 rounded-xl bg-vimdy-accent/10 border border-vimdy-accent/30">
              <h4 className="text-sm font-semibold text-vimdy-accent mb-2">💡 Consejos</h4>
              <ul className="space-y-1">
                {content.tips.map((tip, idx) => (
                  <li key={idx} className="text-sm text-slate-300">
                    • {tip}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-slate-700 shrink-0">
          <button
            onClick={onClose}
            className="w-full h-10 rounded-xl bg-vimdy-accent text-slate-950 font-bold hover:bg-vimdy-accent-hover transition-colors"
          >
            Entendido
          </button>
        </div>
      </div>
    </div>
  );
}

interface HelpButtonProps {
  onClick: () => void;
  className?: string;
}

/**
 * Botón de ayuda contextual.
 *
 * Se coloca en la esquina de cada módulo para abrir el modal de ayuda.
 */
export function HelpButton({ onClick, className = "" }: HelpButtonProps) {
  return (
    <button
      onClick={onClick}
      aria-label="Ayuda"
      className={`w-8 h-8 rounded-lg flex items-center justify-center text-slate-400 hover:text-white hover:bg-slate-700 transition-colors ${className}`}
    >
      <HelpCircle size={18} />
    </button>
  );
}

/**
 * Hook para manejar el estado de ayuda contextual.
 */
export function useHelp(initialState = false) {
  const [isHelpOpen, setIsHelpOpen] = useState(initialState);

  const openHelp = () => setIsHelpOpen(true);
  const closeHelp = () => setIsHelpOpen(false);
  const toggleHelp = () => setIsHelpOpen(prev => !prev);

  return { isHelpOpen, openHelp, closeHelp, toggleHelp };
}
