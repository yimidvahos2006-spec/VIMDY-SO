import React, { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Send, Mic, MicOff } from "lucide-react";

import { useCopilot } from "../../core/store/useCopilot";
import { copilotStore } from "../../core/store/copilotStore";
import { commandIntentStore } from "../../core/store/commandIntentStore";
import { container } from "../../infrastructure/di/CompositionRoot";
import { businessStore } from "../../core/store/businessStore";
import { companyConfigStore } from "../../core/store/companyConfigStore";
import { startSpeechRecognition } from "../../core/voice/speechRecognition";
import { RequirePermission } from "../navigation/RequirePermission";
import { useAuth } from "../context/AuthContext";
import { CopilotOrb, type CopilotOrbState } from "../components/copilot/CopilotOrb";
import { CopilotMessageBubble, CopilotThinkingBubble } from "../components/copilot/CopilotMessageBubble";
import { CopilotSuggestions } from "../components/copilot/CopilotSuggestions";

const STATUS_LABEL: Record<CopilotOrbState, string> = {
  idle: "En línea",
  listening: "Te escucho…",
  thinking: "Analizando tu negocio…",
  responding: "Respondiendo…"
};

/**
 * CopilotPage — "/ia"
 * ---------------------------------------------------------------------------
 * Vista completa del Copiloto. Reutiliza EXACTAMENTE la misma lógica que
 * CopilotPanel (mismo copilotStore, mismo CommandEngine, mismo
 * QuestionRouter, mismo CopilotService) para que el historial y el
 * comportamiento sean idénticos entre el panel flotante y esta página — es
 * la misma conversación, solo con más espacio en pantalla.
 *
 * Esta versión solo rediseña la presentación: orbe animado con 4 estados
 * (reposo / escuchando / pensando / respondiendo), burbujas con avatares y
 * sugerencias en tarjetas. La lógica de handleAsk / handleVoice no cambió.
 */
function CopilotPageContent() {
  const { isLoading, error, messages } = useCopilot();
  const { user } = useAuth();
  const [draft, setDraft] = useState("");
  const [isListening, setIsListening] = useState(false);
  const [isResponding, setIsResponding] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const lastSeenMessageId = useRef<string | undefined>(messages[messages.length - 1]?.id);
  const navigate = useNavigate();

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, isLoading]);

  // "Respondiendo": cuando llega una respuesta NUEVA del asistente, el orbe
  // muestra las ondas de audio un rato proporcional al largo del texto. No se
  // dispara con mensajes que ya estaban al abrir la página.
  useEffect(() => {
    const last = messages[messages.length - 1];
    if (!last || last.id === lastSeenMessageId.current) return;
    lastSeenMessageId.current = last.id;

    if (last.role !== "assistant") return;

    setIsResponding(true);
    const duration = Math.min(5000, Math.max(1800, last.content.length * 18));
    const timer = window.setTimeout(() => setIsResponding(false), duration);
    return () => window.clearTimeout(timer);
  }, [messages]);

  async function handleAsk(question: string) {
    const trimmed = question.trim();
    if (!trimmed || isLoading) return;

    setDraft("");
    copilotStore.addUserMessage(trimmed);

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

  const orbState: CopilotOrbState = isListening
    ? "listening"
    : isLoading
      ? "thinking"
      : isResponding
        ? "responding"
        : "idle";

  // Pantalla inicial: solo existe el mensaje de bienvenida y no hay nada en curso.
  const showHero = messages.length <= 1 && !isLoading;

  return (
    <div className="flex h-full flex-col px-4 py-4 sm:px-6 sm:py-6">
      <div className="mx-auto flex min-h-0 w-full max-w-4xl flex-1 flex-col">
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-3xl border border-cyan-500/20 bg-gradient-to-b from-[#0D1A2B] to-[#08111F] shadow-vimdy-lg">
          {/* Encabezado */}
          <div className="flex items-center gap-4 border-b border-cyan-500/10 px-5 py-3 sm:px-6">
            {!showHero && <CopilotOrb state={orbState} size={64} />}
            <div className="min-w-0">
              <h1 className="text-lg font-bold tracking-tight text-slate-100">VIMDY IA</h1>
              <p
                className="flex items-center gap-2 text-sm text-slate-400"
                role="status"
                aria-live="polite"
              >
                <span
                  className={`h-2 w-2 rounded-full ${
                    orbState === "idle" ? "bg-emerald-400" : "animate-pulse bg-cyan-400"
                  }`}
                  aria-hidden="true"
                />
                {STATUS_LABEL[orbState]}
              </p>
            </div>
          </div>

          {/* Conversación */}
          <div
            ref={scrollRef}
            role="log"
            aria-label="Conversación con VIMDY IA"
            className="min-h-0 flex-1 overflow-y-auto px-4 py-6 sm:px-6"
          >
            {showHero ? (
              <div className="flex min-h-full flex-col items-center justify-center gap-6 py-4 text-center">
                <CopilotOrb state={orbState} size={168} />
                <div className="space-y-1.5">
                  <h2 className="text-2xl font-bold tracking-tight text-slate-100">¿En qué te ayudo hoy?</h2>
                  <p className="mx-auto max-w-md text-sm text-slate-400">
                    Veo tus ventas, tu inventario y tus alertas en tiempo real. Pregúntame lo que quieras sobre tu negocio.
                  </p>
                </div>
                <CopilotSuggestions variant="grid" onSelect={handleAsk} disabled={isLoading || isListening} />
              </div>
            ) : (
              <div className="mx-auto w-full max-w-3xl space-y-5">
                {messages.map((message) => (
                  <CopilotMessageBubble key={message.id} message={message} userName={user?.name} />
                ))}

                {isLoading && <CopilotThinkingBubble />}

                {error && (
                  <div
                    role="alert"
                    className="rounded-xl border border-red-500/20 bg-red-500/10 px-3 py-2 text-xs text-red-400"
                  >
                    {error}
                  </div>
                )}
              </div>
            )}

            {showHero && error && (
              <div
                role="alert"
                className="mx-auto mt-4 max-w-2xl rounded-xl border border-red-500/20 bg-red-500/10 px-3 py-2 text-xs text-red-400"
              >
                {error}
              </div>
            )}
          </div>

          {/* Entrada */}
          <div className="space-y-3 border-t border-cyan-500/10 bg-[#08111F]/80 px-4 py-3 sm:px-6 sm:py-4">
            {!showHero && (
              <div className="mx-auto w-full max-w-3xl">
                <CopilotSuggestions variant="chips" onSelect={handleAsk} disabled={isLoading || isListening} />
              </div>
            )}

            <div className="mx-auto flex w-full max-w-3xl items-center gap-2">
              <input
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.nativeEvent.isComposing) handleAsk(draft);
                }}
                placeholder={isListening ? "Escuchando…" : "Pregúntale algo a tu negocio…"}
                aria-label="Escribe tu pregunta"
                disabled={isListening}
                className="min-w-0 flex-1 rounded-2xl border border-cyan-500/15 bg-[#0F1A2B] px-4 py-3 text-sm text-white placeholder-slate-500 outline-none transition focus:border-cyan-400/50 focus:shadow-vimdy-accent disabled:opacity-60"
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
                    : "border border-cyan-500/20 bg-[#0F1A2B] hover:bg-cyan-500/15"
                }`}
              >
                {isListening ? (
                  <MicOff size={18} className="text-white" />
                ) : (
                  <Mic size={18} className="text-cyan-300" />
                )}
              </button>
              <button
                type="button"
                onClick={() => handleAsk(draft)}
                disabled={isLoading || isListening || !draft.trim()}
                aria-label="Enviar pregunta"
                className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-cyan-500 to-blue-600 transition hover:from-cyan-400 hover:to-blue-500 disabled:opacity-40 disabled:hover:from-cyan-500 disabled:hover:to-blue-600"
              >
                <Send size={18} className="text-white" />
              </button>
            </div>
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