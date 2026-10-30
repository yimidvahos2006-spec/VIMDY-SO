import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "react-router-dom";
import { ArrowUp, Mic, MicOff, MessageSquarePlus, PanelLeft } from "lucide-react";

import { useCopilot } from "../../core/store/useCopilot";
import { copilotStore } from "../../core/store/copilotStore";
import { commandIntentStore } from "../../core/store/commandIntentStore";
import { container } from "../../infrastructure/di/CompositionRoot";
import { businessStore } from "../../core/store/businessStore";
import { companyConfigStore } from "../../core/store/companyConfigStore";
import { startSpeechRecognition } from "../../core/voice/speechRecognition";
import { RequirePermission } from "../navigation/RequirePermission";
import { useAuth } from "../context/AuthContext";
import type { CopilotOrbState } from "../components/copilot/CopilotOrb";
import { AiAvatar } from "../components/copilot/AiAvatar";
import { CopilotMessageBubble, CopilotThinkingBubble } from "../components/copilot/CopilotMessageBubble";
import { CopilotSuggestions } from "../components/copilot/CopilotSuggestions";
import { CopilotSidebar } from "../components/copilot/CopilotSidebar";
import { detectReplyReaction, detectUserReaction, type CopilotReaction } from "../components/copilot/copilotMood";

const STATUS_LABEL: Record<CopilotOrbState, string> = {
  idle: "En línea",
  listening: "Te escucho…",
  thinking: "Analizando tu negocio…",
  responding: "Respondiendo…",
  angry: "Eso no me gustó…",
  wink: "¡Gracias! 😉",
  success: "Buenas noticias",
  warning: "Ojo con esto"
};

/** Cuánto dura una reacción del orbe antes de volver a su estado normal. */
const REACTION_MS = 3500;

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
  const {
    isLoading,
    error,
    messages,
    conversations,
    activeConversationId,
    startNewConversation,
    selectConversation,
    deleteConversation
  } = useCopilot();
  const { user } = useAuth();
  const [draft, setDraft] = useState("");
  const [isListening, setIsListening] = useState(false);
  const [isResponding, setIsResponding] = useState(false);
  const [reaction, setReaction] = useState<CopilotReaction | null>(null);
  const reactionRef = useRef<CopilotReaction | null>(null);
  const reactionTimer = useRef<number | undefined>(undefined);
  const scrollRef = useRef<HTMLDivElement>(null);
  const lastSeenMessageId = useRef<string | undefined>(messages[messages.length - 1]?.id);
  const lastConversationId = useRef(activeConversationId);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [sidebarOpen, setSidebarOpen] = useState(
    () => typeof window !== "undefined" && window.matchMedia("(min-width: 768px)").matches
  );
  const [heroSize, setHeroSize] = useState(() =>
    typeof window !== "undefined" && window.innerWidth < 640 ? 120 : window.innerHeight < 760 ? 132 : 168
  );
  const navigate = useNavigate();

  function showReaction(next: CopilotReaction) {
    window.clearTimeout(reactionTimer.current);
    reactionRef.current = next;
    setReaction(next);
    reactionTimer.current = window.setTimeout(() => {
      reactionRef.current = null;
      setReaction(null);
    }, REACTION_MS);
  }

  useEffect(() => () => window.clearTimeout(reactionTimer.current), []);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    // Pantalla de bienvenida: se queda arriba; con conversación, baja al último mensaje.
    const atWelcome = messages.length <= 1 && !isLoading;
    el.scrollTo({ top: atWelcome ? 0 : el.scrollHeight, behavior: atWelcome ? "auto" : "smooth" });
  }, [messages, isLoading]);

  // Cambiar de chat: ir al final al instante, sin animar y sin disparar "Respondiendo…".
  useLayoutEffect(() => {
    if (lastConversationId.current === activeConversationId) return;
    lastConversationId.current = activeConversationId;
    lastSeenMessageId.current = messages[messages.length - 1]?.id;
    window.clearTimeout(reactionTimer.current);
    reactionRef.current = null;
    setReaction(null);
    setIsResponding(false);
    setDraft("");
    const el = scrollRef.current;
    if (el) el.scrollTo({ top: messages.length <= 1 ? 0 : el.scrollHeight });
  }, [activeConversationId, messages]);

  // La página ocupa toda la pantalla: se bloquea el scroll del fondo y se
  // cierra el panel flotante (ya no tiene sentido tener los dos a la vez).
  useEffect(() => {
    copilotStore.close();
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, []);

  useEffect(() => {
    const onResize = () => setHeroSize(window.innerWidth < 640 ? 120 : window.innerHeight < 760 ? 132 : 168);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  // Escape cierra el cajón del historial en móvil.
  useEffect(() => {
    if (!sidebarOpen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && window.innerWidth < 768) setSidebarOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [sidebarOpen]);

  // El cuadro de texto crece con el contenido (hasta ~6 líneas).
  useLayoutEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 168)}px`;
  }, [draft]);

  // "Respondiendo": cuando llega una respuesta NUEVA del asistente, el orbe
  // muestra las ondas de audio un rato proporcional al largo del texto. No se
  // dispara con mensajes que ya estaban al abrir la página.
  useEffect(() => {
    const last = messages[messages.length - 1];
    if (!last || last.id === lastSeenMessageId.current) return;
    lastSeenMessageId.current = last.id;

    // El mensaje de bienvenida (inicio o "Nuevo chat") no cuenta como respuesta.
    if (last.role !== "assistant" || last.id === "welcome") {
      setIsResponding(false);
      return;
    }

    // Estado de negocio que se nota en la respuesta (alerta, buena noticia, récord).
    // Si el usuario acaba de provocar enojo o guiño, esa reacción no se pisa.
    const replyReaction = detectReplyReaction(last.content);
    if (replyReaction && reactionRef.current !== "angry" && reactionRef.current !== "wink") {
      showReaction(replyReaction);
    }

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

    const userReaction = detectUserReaction(trimmed);
    if (userReaction) showReaction(userReaction);

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

  // Nuevo chat: el actual queda guardado en el historial. No se puede mientras
  // se espera una respuesta o se escucha (caería en la conversación nueva).
  function handleNewChat() {
    if (isLoading || isListening) return;
    setDraft("");
    setIsResponding(false);
    startNewConversation();
    if (window.innerWidth < 768) setSidebarOpen(false);
    textareaRef.current?.focus();
  }

  function handleSelectChat(id: string) {
    if (isLoading || isListening) return;
    selectConversation(id);
    if (window.innerWidth < 768) setSidebarOpen(false);
  }

  function handleExit() {
    navigate("/");
  }

  const orbState: CopilotOrbState = isListening
    ? "listening"
    : isLoading
      ? "thinking"
      : reaction
        ? reaction
        : isResponding
          ? "responding"
          : "idle";

  // Pantalla inicial: solo existe el mensaje de bienvenida y no hay nada en curso.
  const showHero = messages.length <= 1 && !isLoading;

  const busy = isLoading || isListening;

  const page = (
    <div
      className="fixed inset-0 z-[70] flex h-[100dvh] w-screen overflow-hidden bg-black text-zinc-100"
      role="region"
      aria-label="VIMDY IA"
    >
      <CopilotSidebar
        conversations={conversations}
        activeConversationId={activeConversationId}
        busy={busy}
        open={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
        onNewChat={handleNewChat}
        onSelect={handleSelectChat}
        onDelete={deleteConversation}
        onExit={handleExit}
      />

      <section className="flex min-w-0 flex-1 flex-col">
        {/* Cabecera */}
        <header className="flex h-14 shrink-0 items-center gap-2 border-b border-zinc-900 px-3 pt-[env(safe-area-inset-top)] sm:px-4">
          <button
            type="button"
            onClick={() => setSidebarOpen((v) => !v)}
            aria-label={sidebarOpen ? "Ocultar historial" : "Mostrar historial"}
            aria-expanded={sidebarOpen}
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-zinc-400 transition hover:bg-zinc-900 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-600"
          >
            <PanelLeft size={20} aria-hidden="true" />
          </button>

          <AiAvatar size={30} />
          <div className="min-w-0">
            <h1 className="truncate text-sm font-semibold leading-tight tracking-tight text-zinc-100">VIMDY IA</h1>
            <p
              className="flex items-center gap-1.5 text-xs leading-tight text-zinc-500"
              role="status"
              aria-live="polite"
            >
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
            disabled={busy || showHero}
            title="Nuevo chat"
            aria-label="Nuevo chat"
            className="ml-auto flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-zinc-400 transition hover:bg-zinc-900 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-600 disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-zinc-400"
          >
            <MessageSquarePlus size={19} aria-hidden="true" />
          </button>
        </header>

        {/* Conversación */}
        <div
          ref={scrollRef}
          role="log"
          aria-label="Conversación con VIMDY IA"
          className="flex min-h-0 flex-1 flex-col overflow-y-auto overscroll-contain px-4 py-6 [scrollbar-color:#27272a_transparent] [scrollbar-width:thin] sm:px-6"
        >
          {showHero ? (
            <div className="mx-auto my-auto flex w-full max-w-3xl shrink-0 flex-col items-center gap-5 py-4 text-center sm:gap-6">
              <AiAvatar size={heroSize} />
              <div className="space-y-2">
                <h2 className="text-2xl font-semibold tracking-tight text-zinc-50 sm:text-3xl">¿En qué te ayudo hoy?</h2>
                <p className="mx-auto max-w-md text-sm leading-relaxed text-zinc-500">
                  Veo tus ventas, tu inventario y tus alertas en tiempo real. Pregúntame lo que quieras sobre tu negocio.
                </p>
              </div>
              <CopilotSuggestions variant="grid" onSelect={handleAsk} disabled={busy} />
              {error && (
                <div
                  role="alert"
                  className="w-full max-w-2xl rounded-xl border border-red-500/20 bg-red-500/10 px-3 py-2 text-xs text-red-400"
                >
                  {error}
                </div>
              )}
            </div>
          ) : (
            <div className="mx-auto w-full max-w-3xl shrink-0 space-y-6">
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
        </div>

        {/* Entrada */}
        <div className="shrink-0 px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-2 sm:px-6">
          <div className="mx-auto w-full max-w-3xl space-y-2.5">
            {!showHero && <CopilotSuggestions variant="chips" onSelect={handleAsk} disabled={busy} />}

            <div className="flex items-end gap-2 rounded-3xl border border-zinc-800 bg-zinc-950 p-2 pl-4 transition focus-within:border-zinc-600">
              <textarea
                ref={textareaRef}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                    e.preventDefault();
                    handleAsk(draft);
                  }
                }}
                rows={1}
                placeholder={isListening ? "Escuchando…" : "Pregúntale algo a tu negocio…"}
                aria-label="Escribe tu pregunta"
                disabled={isListening}
                className="max-h-[168px] min-w-0 flex-1 resize-none self-center !border-0 !bg-transparent py-2 text-base leading-6 !text-zinc-100 placeholder-zinc-600 shadow-none focus-visible:!outline-none disabled:opacity-60 sm:text-sm"
              />
              <button
                type="button"
                onClick={handleVoice}
                disabled={isLoading}
                title="Hablarle al Copiloto"
                aria-label={isListening ? "Escuchando" : "Hablarle al Copiloto"}
                className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-500 disabled:opacity-40 ${
                  isListening ? "animate-pulse bg-red-500 text-white hover:bg-red-400" : "text-zinc-400 hover:bg-zinc-800 hover:text-white"
                }`}
              >
                {isListening ? <MicOff size={18} aria-hidden="true" /> : <Mic size={18} aria-hidden="true" />}
              </button>
              <button
                type="button"
                onClick={() => handleAsk(draft)}
                disabled={busy || !draft.trim()}
                aria-label="Enviar pregunta"
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-white text-black transition hover:bg-zinc-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-400 disabled:bg-zinc-800 disabled:text-zinc-600 disabled:hover:bg-zinc-800"
              >
                <ArrowUp size={19} strokeWidth={2.4} aria-hidden="true" />
              </button>
            </div>

            <p className="text-center text-[11px] leading-snug text-zinc-600">
              VIMDY IA puede cometer errores. Verifique la información importante del negocio.
            </p>
          </div>
        </div>
      </section>
    </div>
  );

  // Portal al <body>: cubre por completo el menú y la barra de la app.
  return createPortal(page, document.body);
}

export function CopilotPage() {
  return (
    <RequirePermission requires="reports.view">
      <CopilotPageContent />
    </RequirePermission>
  );
}

export default CopilotPage;