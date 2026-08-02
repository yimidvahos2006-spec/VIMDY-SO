import React, { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Sparkles, Send, Loader2, Mic, MicOff } from "lucide-react";

import { useCopilot } from "../../core/store/useCopilot";
import { copilotStore } from "../../core/store/copilotStore";
import { commandIntentStore } from "../../core/store/commandIntentStore";
import { container } from "../../infrastructure/di/CompositionRoot";
import { businessStore } from "../../core/store/businessStore";
import { companyConfigStore } from "../../core/store/companyConfigStore";
import { startSpeechRecognition } from "../../core/voice/speechRecognition";
import { RequirePermission } from "../navigation/RequirePermission";

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
 * CopilotPage — "/ia"
 * ---------------------------------------------------------------------------
 * El ícono "VIMDY IA" del Sidebar (VimdySidebar.tsx, path "/ia") apuntaba a
 * una ruta que nunca existió en App.tsx, así que caía al 404. El backend
 * (Edge Function copilot-chat) y el panel flotante (CopilotPanel.tsx) ya
 * funcionaban de verdad — solo faltaba esta página de vista completa.
 *
 * Reutiliza EXACTAMENTE la misma lógica que CopilotPanel (mismo
 * copilotStore, mismo CommandEngine, mismo QuestionRouter, mismo
 * CopilotService) para que el historial y el comportamiento sean
 * idénticos entre el panel flotante y esta página — es la misma
 * conversación, solo con más espacio en pantalla.
 */
function CopilotPageContent() {
  const { isLoading, error, messages } = useCopilot();
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

  return (
    <div className="min-h-screen px-6 py-8 flex flex-col">
      <div className="max-w-4xl w-full mx-auto flex flex-col flex-1">
        {/* Header — mismo patrón que Centro de notificaciones / Reportes */}
        <div className="flex items-center gap-3 mb-6">
          <div className="w-11 h-11 rounded-2xl bg-vimdy-surface border border-slate-800 flex items-center justify-center">
            <Sparkles className="text-cyan-400" size={20} />
          </div>
          <div>
            <h1 className="text-slate-100 text-xl font-bold">VIMDY IA</h1>
            <p className="text-slate-500 text-sm">Tu gerente virtual, con el contexto real de tu negocio.</p>
          </div>
        </div>

        {/* Conversación */}
        <div className="flex-1 flex flex-col rounded-[28px] border border-cyan-500/20 bg-[#0B1522] overflow-hidden">
          <div ref={scrollRef} className="flex-1 overflow-y-auto p-6 space-y-3 min-h-[420px]">
            {messages.length === 0 && !isLoading && (
              <div className="h-full flex flex-col items-center justify-center text-center gap-2 py-10">
                <div className="w-12 h-12 rounded-2xl bg-cyan-500/15 flex items-center justify-center mb-2">
                  <Sparkles size={22} className="text-cyan-400" />
                </div>
                <p className="text-slate-200 font-semibold">Pregúntale algo a tu negocio</p>
                <p className="text-slate-500 text-sm max-w-sm">
                  VIMDY IA ve tus ventas, tu inventario y tus alertas en tiempo real para responderte.
                </p>
              </div>
            )}

            {messages.map((message) => (
              <div
                key={message.id}
                className={`flex ${message.role === "user" ? "justify-end" : "justify-start"}`}
              >
                <div
                  className={`
                    max-w-[75%] rounded-2xl px-4 py-3 text-sm leading-relaxed whitespace-pre-wrap
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

          {messages.length <= 1 && (
            <div className="px-6 pb-3 flex flex-wrap gap-2">
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
      </div>
    </div>
  );
}

export function CopilotPage() {
  return (
    <RequirePermission requires="reports.view">
      <CopilotPageContent />
    </RequirePermission>
  );
}

export default CopilotPage;