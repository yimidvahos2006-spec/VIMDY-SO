import React, { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowUp, Maximize2, Mic, MicOff, MessageSquarePlus, X } from "lucide-react";

import { useCopilot } from "../../../core/store/useCopilot";
import { copilotStore } from "../../../core/store/copilotStore";
import { commandIntentStore } from "../../../core/store/commandIntentStore";
import { container } from "../../../infrastructure/di/CompositionRoot";
import { businessStore } from "../../../core/store/businessStore";
import { companyConfigStore } from "../../../core/store/companyConfigStore";
import { startSpeechRecognition } from "../../../core/voice/speechRecognition";
import { useAuth } from "../../context/AuthContext";
import type { CopilotOrbState } from "./CopilotOrb";
import { AiAvatar } from "./AiAvatar";
import { CopilotMessageBubble, CopilotThinkingBubble } from "./CopilotMessageBubble";
import { CopilotSuggestions } from "./CopilotSuggestions";

const STATUS_LABEL: Record<CopilotOrbState, string> = {
  idle: "En línea",
  listening: "Te escucho…",
  thinking: "Analizando tu negocio…",
  responding: "Respondiendo…",
  angry: "En línea",
  wink: "En línea",
  success: "En línea",
  warning: "En línea"
};

/**
 * CopilotPanel
 * ---------------------------------------------------------------------------
 * Panel deslizable con la conversación del Copiloto VIMDY. Cada pregunta
 * dispara CopilotService.ask(), que arma el contexto real del negocio
 * (ventas, inventario, alertas) y se lo manda a Claude vía la Edge Function.
 */
export function CopilotPanel() {
  const { isOpen, isLoading, error, messages } = useCopilot();
  const [draft, setDraft] = useState("");
  const [isListening, setIsListening] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const navigate = useNavigate();
  const { user } = useAuth();

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, isLoading]);

  async function handleAsk(question: string) {
    const trimmed = question.trim();
    if (!trimmed || isLoading) return;

    setDraft("");
    copilotStore.addUserMessage(trimmed);

    // PASO 6 — Comandos Inteligentes: si el texto es una orden reconocida
    // ("crea un producto", "abre la caja", "busca al cliente Ana"), se
    // ejecuta de una vez —navegación + intent de UI— sin gastar la API de
    // Claude ni esperar respuesta de red.
    const command = await container.commandEngine.get().parse(trimmed);
    if (command) {
      if (command.intent) {
        commandIntentStore.dispatch(command.intent);
      }
      navigate(command.route);
      copilotStore.addAssistantMessage(command.confirmationMessage);
      return;
    }

    const business = businessStore.get();
    const config = companyConfigStore.get();

    // Router de intenciones: si la pregunta calza con una consulta frecuente
    // ("¿cuánto vendí hoy?", "¿qué debo comprar?", "¿quién vende más?"),
    // responde al instante con BusinessAnalyzer, sin gastar la API de Claude
    // ni esperar respuesta de red. Si no calza con nada conocido, sigue el
    // camino normal y se lo pregunta a Claude con todo el contexto.
    const quickAnswer = await container.questionRouter.get().answer(
      trimmed,
      business.name || "Mi negocio",
      config.currency
    );
    if (quickAnswer) {
      copilotStore.addAssistantMessage(quickAnswer);
      return;
    }

    copilotStore.setLoading(true);

    try {
      const reply = await container.copilotService.get().ask(
        trimmed,
        copilotStore.getHistoryForApi(),
        business.name || "Mi negocio",
        config.currency
      );

      copilotStore.addAssistantMessage(reply);
    } catch (err) {
      copilotStore.setError(
        err instanceof Error ? err.message : "No pude conectarme con el Copiloto. Intenta de nuevo."
      );
    }
  }

  /**
   * Nuevo chat: limpia la conversación (misma acción que en /ia, porque
   * comparten copilotStore). No se permite mientras hay una respuesta en
   * camino o se está escuchando: caería dentro de la conversación nueva.
   */
  function handleNewChat() {
    if (isLoading || isListening) return;
    setDraft("");
    copilotStore.reset();
    inputRef.current?.focus();
  }

  /**
   * PASO 7 — IA por Voz. Reutiliza el mismo motor de reconocimiento de voz
   * que ya usa VIMDY Voice en el POS (startSpeechRecognition). El texto
   * transcrito entra por el MISMO handleAsk que el texto escrito, así que
   * automáticamente aprovecha también los comandos del PASO 6 ("crea un
   * producto", "abre la caja") sin duplicar ninguna lógica.
   */
  async function handleVoice() {
    if (isListening || isLoading) return;

    setIsListening(true);
    const speech = await startSpeechRecognition();
    setIsListening(false);

    if (!speech.success) {
      copilotStore.setError(speech.error || "No fue posible escuchar. Intenta de nuevo.");
      return;
    }

    await handleAsk(speech.text);
  }

  if (!isOpen) return null;

  const orbState: CopilotOrbState = isListening ? "listening" : isLoading ? "thinking" : "idle";
  const hasConversation = messages.length > 1 || Boolean(error);

  return (
    <section
      role="dialog"
      aria-label="VIMDY IA"
      className="
        fixed inset-x-3 bottom-24 z-[59]
        sm:inset-x-auto sm:right-6 sm:bottom-28 sm:w-[400px]
        h-[600px] max-h-[calc(100dvh-7.5rem)] sm:max-h-[calc(100dvh-8.5rem)]
        flex flex-col overflow-hidden rounded-3xl
        border border-zinc-800 bg-black
        shadow-[0_24px_64px_-12px_rgba(0,0,0,0.8)]
        animate-vimdy-slide-up
      "
    >
      {/* Cabecera */}
      <header className="relative flex items-center gap-3 border-b border-zinc-900 px-4 py-3">
        <div className="shrink-0">
          <AiAvatar />
        </div>
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-base font-bold leading-tight tracking-tight text-zinc-100">VIMDY IA</h2>
          <p className="flex items-center gap-1.5 text-xs text-zinc-500" role="status" aria-live="polite">
            <span
              className={`h-1.5 w-1.5 shrink-0 rounded-full ${
                orbState === "idle" ? "bg-emerald-400" : "animate-pulse bg-zinc-300"
              }`}
              aria-hidden="true"
            />
            <span className="truncate">{STATUS_LABEL[orbState]}</span>
          </p>
        </div>

        <button
          type="button"
          onClick={handleNewChat}
          disabled={!hasConversation || isLoading || isListening}
          title="Nuevo chat"
          aria-label="Nuevo chat: limpiar la conversación"
          className="inline-flex h-10 shrink-0 items-center gap-1.5 rounded-xl border border-zinc-800 bg-zinc-950 px-3 text-xs font-medium text-zinc-200 transition hover:border-zinc-700 hover:bg-zinc-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-600 disabled:cursor-not-allowed disabled:opacity-40"
        >
          <MessageSquarePlus size={16} aria-hidden="true" />
          <span className="hidden min-[400px]:inline">Nuevo chat</span>
        </button>

        <button
          type="button"
          onClick={() => {
            copilotStore.close();
            navigate("/ia");
          }}
          title="Abrir en pantalla completa"
          aria-label="Abrir VIMDY IA en pantalla completa"
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-zinc-400 transition hover:bg-zinc-900 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-600"
        >
          <Maximize2 size={17} aria-hidden="true" />
        </button>

        <button
          type="button"
          onClick={() => copilotStore.close()}
          title="Cerrar"
          aria-label="Cerrar panel"
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-zinc-400 transition hover:bg-zinc-900 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-600"
        >
          <X size={18} aria-hidden="true" />
        </button>
      </header>

      {/* Conversación */}
      <div
        ref={scrollRef}
        role="log"
        aria-label="Conversación con VIMDY IA"
        className="relative min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain px-3.5 py-4 sm:px-4"
      >
        {messages.map((message) => (
          <CopilotMessageBubble key={message.id} message={message} userName={user?.name} compact />
        ))}

        {isLoading && <CopilotThinkingBubble compact />}

        {error && (
          <div
            role="alert"
            className="rounded-xl border border-red-500/20 bg-red-500/10 px-3 py-2 text-xs text-red-400"
          >
            {error}
          </div>
        )}
      </div>

      {/* Entrada */}
      <div className="relative space-y-2.5 border-t border-zinc-900 bg-black px-3.5 pb-3 pt-3 sm:px-4">
        {/* Sugerencias: una sola fila compacta con scroll horizontal */}
        <CopilotSuggestions variant="chips" onSelect={handleAsk} disabled={isLoading || isListening} />

        <div className="flex items-center gap-2">
          <input
            ref={inputRef}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.nativeEvent.isComposing) handleAsk(draft);
            }}
            placeholder={isListening ? "Escuchando…" : "Pregúntale algo a tu negocio…"}
            aria-label="Escribe tu pregunta"
            disabled={isListening}
            className="min-w-0 flex-1 rounded-2xl border border-zinc-800 bg-zinc-950 px-4 py-3 text-base text-zinc-100 placeholder-zinc-600 outline-none transition focus:border-zinc-600 disabled:opacity-60 sm:text-sm"
          />
          <button
            type="button"
            onClick={handleVoice}
            disabled={isLoading}
            title="Hablarle al Copiloto"
            aria-label={isListening ? "Escuchando" : "Hablarle al Copiloto"}
            className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl transition disabled:opacity-40 ${
              isListening
                ? "animate-pulse bg-red-500 hover:bg-red-400"
                : "border border-zinc-800 bg-zinc-950 hover:bg-zinc-900"
            }`}
          >
            {isListening ? (
              <MicOff size={18} className="text-white" />
            ) : (
              <Mic size={18} className="text-zinc-300" />
            )}
          </button>
          <button
            type="button"
            onClick={() => handleAsk(draft)}
            disabled={isLoading || isListening || !draft.trim()}
            aria-label="Enviar pregunta"
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-white text-black transition hover:bg-zinc-200 disabled:bg-zinc-800 disabled:text-zinc-600 disabled:hover:bg-zinc-800"
          >
            <ArrowUp size={19} strokeWidth={2.4} aria-hidden="true" />
          </button>
        </div>

        <p className="text-center text-[11px] leading-snug text-zinc-600">
          VIMDY IA puede cometer errores. Verifique la información importante.
        </p>
      </div>
    </section>
  );
}

export default CopilotPanel;