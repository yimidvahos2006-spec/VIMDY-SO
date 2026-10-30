import React from "react";
import {
  Activity,
  CalendarDays,
  Clock,
  ShoppingCart,
  TrendingUp,
  Trophy,
  Wallet,
  type LucideIcon
} from "lucide-react";

interface Suggestion {
  readonly question: string;
  /** Texto corto que explica qué responde la pregunta. */
  readonly hint: string;
  readonly icon: LucideIcon;
}

/**
 * Mismas 7 preguntas que ya usaba el Copiloto: todas las resuelve el
 * QuestionRouter o el CopilotService, así que no hay que tocar nada más.
 */
export const COPILOT_SUGGESTIONS: readonly Suggestion[] = [
  { question: "¿Cómo voy?", hint: "Resumen del negocio", icon: Activity },
  { question: "¿Cuánto dinero hay en caja?", hint: "Efectivo esperado", icon: Wallet },
  { question: "¿Qué pedidos están retrasados?", hint: "Cocina en vivo", icon: Clock },
  { question: "¿Qué producto me deja más ganancia?", hint: "Márgenes", icon: TrendingUp },
  { question: "¿Qué empleado vende más?", hint: "Ranking de ventas", icon: Trophy },
  { question: "¿Qué debería comprar mañana?", hint: "Reposición", icon: ShoppingCart },
  { question: "¿Qué pasará esta semana?", hint: "Proyección de 7 días", icon: CalendarDays }
];

interface CopilotSuggestionsProps {
  /**
   * "grid": tarjetas en 2 columnas (pantalla ancha). "list": tarjetas en 1 columna
   * (panel flotante angosto). "chips": fila compacta con scroll horizontal.
   */
  variant: "grid" | "list" | "chips";
  onSelect: (question: string) => void;
  disabled?: boolean;
}

export function CopilotSuggestions({ variant, onSelect, disabled = false }: CopilotSuggestionsProps) {
  if (variant === "chips") {
    return (
      <div
        className="-mx-3 flex scroll-px-3 snap-x gap-2 overflow-x-auto overscroll-x-contain px-3 pb-0.5 [-webkit-overflow-scrolling:touch] [mask-image:linear-gradient(to_right,transparent,#000_12px,#000_calc(100%-24px),transparent)] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        onWheel={(e) => {
          // Rueda del mouse (vertical) → scroll horizontal, para escritorio.
          if (e.deltaY !== 0 && Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
            e.currentTarget.scrollLeft += e.deltaY;
          }
        }}
        role="group"
        aria-label="Preguntas rápidas"
      >
        {COPILOT_SUGGESTIONS.map(({ question, icon: Icon }) => (
          <button
            key={question}
            type="button"
            onClick={() => onSelect(question)}
            disabled={disabled}
            className="inline-flex shrink-0 snap-start items-center gap-1.5 whitespace-nowrap rounded-full border border-zinc-800 bg-zinc-950 px-3.5 py-2 text-xs text-zinc-300 transition hover:border-zinc-700 hover:bg-zinc-900 hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Icon size={13} className="text-zinc-500" aria-hidden="true" />
            {question}
          </button>
        ))}
      </div>
    );
  }

  const isList = variant === "list";

  return (
    <div
      className={`grid w-full text-left grid-cols-1 gap-2 ${isList ? "" : "max-w-2xl gap-2.5 sm:grid-cols-2"}`}
      role="group"
      aria-label="Preguntas rápidas"
    >
      {COPILOT_SUGGESTIONS.map(({ question, hint, icon: Icon }) => (
        <button
          key={question}
          type="button"
          onClick={() => onSelect(question)}
          disabled={disabled}
          className={`group flex items-center gap-3 rounded-2xl border border-zinc-800 bg-zinc-950 px-3 py-2.5 text-left transition hover:border-zinc-700 hover:bg-zinc-900 disabled:cursor-not-allowed disabled:opacity-50 ${
            isList ? "" : "sm:px-4 sm:py-3 sm:last:odd:col-span-2"
          }`}
        >
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-zinc-900 text-zinc-300 transition group-hover:bg-zinc-800">
            <Icon size={17} aria-hidden="true" />
          </span>
          <span className="min-w-0">
            <span className="block text-sm font-medium text-zinc-100">{question}</span>
            <span className={`text-xs text-zinc-500 ${isList ? "block" : "hidden sm:block"}`}>{hint}</span>
          </span>
        </button>
      ))}
    </div>
  );
}

export default CopilotSuggestions;