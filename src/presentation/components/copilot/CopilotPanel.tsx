import React, { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Sparkles, Send, Loader2, Mic, MicOff } from "lucide-react";

import { useCopilot } from "../../../core/store/useCopilot";
import { copilotStore } from "../../../core/store/copilotStore";
import { commandIntentStore } from "../../../core/store/commandIntentStore";
import { container } from "../../../infrastructure/di/CompositionRoot";
import { businessStore } from "../../../core/store/businessStore";
import { companyConfigStore } from "../../../core/store/companyConfigStore";
import { startSpeechRecognition } from "../../../core/voice/speechRecognition";

const SUGGESTED_QUESTIONS = [
  "¿Cómo voy?",
  "¿Cuánto dinero hay en caja?",
  "¿Qué pedidos están retrasados?",
  "¿Qué producto me deja más ganancia?",
  "¿Qué empleado vende más?",
  "¿Qué debería comprar mañana?",
  "¿Qué pasará esta semana?"
];

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
  const navigate = useNavigate();

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
    const command = await container.commandEngine.parse(trimmed);
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
    const quickAnswer = await container.questionRouter.answer(
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
      const reply = await container.copilotService.ask(
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

  return (
    <div
      className="
        fixed bottom-28 right-6 z-[59]
        w-[380px] max-w-[92vw] h-[560px] max-h-[75vh]
        rounded-[28px] border border-cyan-500/20 bg-[#0B1522]
        shadow-2xl flex flex-col overflow-hidden
      "
    >
      {/* Header */}
      <div className="flex items-center gap-3 p-5 border-b border-cyan-500/15 bg-[#08111F]">
        <div className="w-10 h-10 rounded-xl bg-cyan-500/15 flex items-center justify-center">
          <Sparkles size={20} className="text-cyan-400" />
        </div>
        <div>
          <p className="text-white font-bold leading-tight">Copiloto VIMDY</p>
          <p className="text-xs text-cyan-300">Tu gerente virtual</p>
        </div>
      </div>

      {/* Mensajes */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-3">
        {messages.map((message) => (
          <div
            key={message.id}
            className={`flex ${message.role === "user" ? "justify-end" : "justify-start"}`}
          >
            <div
              className={`
                max-w-[85%] rounded-2xl px-4 py-3 text-sm leading-relaxed whitespace-pre-wrap
                ${message.role === "user"
                  ? "bg-cyan-500 text-white rounded-br-sm"
                  : "bg-[#131F30] text-slate-200 border border-cyan-500/10 rounded-bl-sm"}
              `}
            >
              {message.content}
            </div>
          </div>
        ))}

        {isLoading && (
          <div className="flex justify-start">
            <div className="bg-[#131F30] border border-cyan-500/10 rounded-2xl rounded-bl-sm px-4 py-3 flex items-center gap-2">
              <Loader2 size={16} className="text-cyan-400 animate-spin" />
              <span className="text-slate-400 text-sm">Analizando tu negocio…</span>
            </div>
          </div>
        )}

        {error && (
          <div className="text-red-400 text-xs bg-red-500/10 border border-red-500/20 rounded-xl px-3 py-2">
            {error}
          </div>
        )}
      </div>

      {/* Preguntas sugeridas (solo si es la primera interacción) */}
      {messages.length <= 1 && (
        <div className="px-4 pb-2 flex flex-wrap gap-2">
          {SUGGESTED_QUESTIONS.map((question) => (
            <button
              key={question}
              onClick={() => handleAsk(question)}
              className="text-xs bg-cyan-500/10 hover:bg-cyan-500/20 border border-cyan-500/20 text-cyan-300 rounded-full px-3 py-1.5 transition"
            >
              {question}
            </button>
          ))}
        </div>
      )}

      {/* Input */}
      <div className="p-4 border-t border-cyan-500/15 bg-[#08111F] flex items-center gap-2">
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") handleAsk(draft);
          }}
          placeholder={isListening ? "Escuchando…" : "Pregúntale algo a tu negocio…"}
          disabled={isListening}
          className="flex-1 bg-[#131F30] border border-cyan-500/15 rounded-2xl px-4 py-3 text-sm text-white placeholder-slate-500 outline-none focus:border-cyan-500/40 disabled:opacity-60"
        />
        <button
          onClick={handleVoice}
          disabled={isLoading}
          title="Hablarle al Copiloto"
          className={`w-11 h-11 rounded-2xl flex items-center justify-center transition disabled:opacity-40 ${
            isListening
              ? "bg-red-500 hover:bg-red-400 animate-pulse"
              : "bg-[#131F30] border border-cyan-500/20 hover:bg-cyan-500/15"
          }`}
        >
          {isListening ? (
            <MicOff size={18} className="text-white" />
          ) : (
            <Mic size={18} className="text-cyan-300" />
          )}
        </button>
        <button
          onClick={() => handleAsk(draft)}
          disabled={isLoading || isListening || !draft.trim()}
          className="w-11 h-11 rounded-2xl bg-cyan-500 hover:bg-cyan-400 disabled:opacity-40 disabled:hover:bg-cyan-500 flex items-center justify-center transition"
        >
          <Send size={18} className="text-white" />
        </button>
      </div>
    </div>
  );
}

export default CopilotPanel;