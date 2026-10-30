import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowUp, History, Mic, MicOff, MessageSquarePlus, X } from "lucide-react";

import { useCopilot } from "../../../core/store/useCopilot";
import { copilotStore } from "../../../core/store/copilotStore";
import { commandIntentStore } from "../../../core/store/commandIntentStore";
import { container } from "../../../infrastructure/di/CompositionRoot";
import { businessStore } from "../../../core/store/businessStore";
import { companyConfigStore } from "../../../core/store/companyConfigStore";
import { canAccessPath } from "../../../core/config/roleAccess";
import { startSpeechRecognition } from "../../../core/voice/speechRecognition";
import { useAuth } from "../../context/AuthContext";
import type { CopilotOrbState } from "./CopilotOrb";
import { AiAvatar } from "./AiAvatar";
import { CopilotMessageBubble, CopilotThinkingBubble } from "./CopilotMessageBubble";
import { CopilotSuggestions } from "./CopilotSuggestions";
import { CopilotSidebar } from "./CopilotSidebar";
import { detectReplyReaction, detectUserReaction, type CopilotReaction } from "./copilotMood";

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

/** Cuánto dura una reacción del avatar antes de volver a su estado normal. */
const REACTION_MS = 3500;

/**
 * CopilotPanel
 * ---------------------------------------------------------------------------
 * VIMDY IA como panel flotante (cajón a la derecha) que se abre POR ENCIMA de
 * cualquier módulo (Dashboard, Caja, Inventario…) sin sacar al usuario de la
 * pantalla en la que está. Se abre con el ítem "VIMDY IA" del menú lateral
 * (copilotStore.open/toggle) y se cierra con X, Escape o clic fuera del panel.
 *
 * Conserva el avatar de obsidiana líquida, la caja de entrada moderna y el tema
 * negro. El historial de chats vive DENTRO del panel como cajón compacto
 * (botón de historial en la cabecera): nunca ocupa espacio en el layout.
 *
 * Misma lógica de siempre: mismo copilotStore, CommandEngine, QuestionRouter y
 * CopilotService.
 */
export function CopilotPanel() {
  const {
    isOpen,
    isLoading,
    error,
    messages,
    conversations,
    activeConversationId,
    startNewConversation,
    selectConversation,
    deleteConversation
  } = useCopilot();
  const { user, can, role } = useAuth();
  const navigate = useNavigate();

  const [draft, setDraft] = useState("");
  const [isListening, setIsListening] = useState(false);
  const [isResponding, setIsResponding] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [reaction, setReaction] = useState<CopilotReaction | null>(null);
  const reactionRef = useRef<CopilotReaction | null>(null);
  const reactionTimer = useRef<number | undefined>(undefined);
  const scrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const lastSeenMessageId = useRef<string | undefined>(messages[messages.length - 1]?.id);
  const lastConversationId = useRef(activeConversationId);

  const allowed = canAccessPath("/ia", can, role?.name);
  const visible = isOpen && allowed;

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

  // Escape: primero cierra el historial; si ya está cerrado, cierra el panel.
  useEffect(() => {
    if (!visible) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (historyOpen) setHistoryOpen(false);
      else copilotStore.close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [visible, historyOpen]);

  // Al cerrar el panel el historial vuelve a quedar plegado.
  useEffect(() => {
    if (!isOpen) setHistoryOpen(false);
  }, [isOpen]);

  // Al abrir, el cursor queda listo en la caja de entrada.
  useEffect(() => {
    if (visible) textareaRef.current?.focus({ preventScroll: true });
  }, [visible]);

  // Pantalla de bienvenida: se queda arriba; con conversación, baja al último mensaje.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const atWelcome = messages.length <= 1 && !isLoading;
    el.scrollTo({ top: atWelcome ? 0 : el.scrollHeight, behavior: atWelcome ? "auto" : "smooth" });
  }, [messages, isLoading, visible]);

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

  // El cuadro de texto crece con el contenido (hasta ~5 líneas).
  useLayoutEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 128)}px`;
  }, [draft, visible]);

  // "Respondiendo": cuando llega una respuesta NUEVA del asistente, el avatar
  // muestra su estado de respuesta un rato proporcional al largo del texto.
  useEffect(() => {
    const last = messages[messages.length - 1];
    if (!last || last.id === lastSeenMessageId.current) return;
    lastSeenMessageId.current = last.id;

    if (last.role !== "assistant" || last.id === "welcome") {
      setIsResponding(false);
      return;
    }

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

    // Comandos inteligentes ("crea un producto", "abre la caja", "busca al
    // cliente Ana"): se ejecutan de una vez —navegación + intent de UI— sin
    // gastar la API. El panel sigue abierto encima del módulo al que se navega.
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

    // Consultas frecuentes ("¿cuánto vendí hoy?"): respuesta instantánea con
    // BusinessAnalyzer. Si no calza con nada conocido, se le pregunta a Claude.
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

  /** IA por voz: el texto transcrito entra por el mismo handleAsk que el escrito. */
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
    setHistoryOpen(false);
    textareaRef.current?.focus();
  }

  function handleSelectChat(id: string) {
    if (isLoading || isListening) return;
    selectConversation(id);
    setHistoryOpen(false);
  }

  if (!visible) return null;

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

  return (
    <>
      {/* Velo tenue: los módulos de fondo se siguen viendo; clic fuera cierra el panel. */}
      <div
        onClick={() => copilotStore.close()}
        aria-hidden="true"
        className="fixed inset-0 z-[58] bg-black/30 animate-vimdy-fade-in"
      />

      <section
        role="dialog"
        aria-label="VIMDY IA"
        className="
          fixed inset-0 z-[59]
          sm:inset-y-3 sm:left-auto sm:right-3 sm:w-[440px]
          flex flex-col overflow-hidden bg-black text-zinc-100
          sm:rounded-3xl sm:border sm:border-zinc-800
          sm:shadow-[0_24px_64px_-12px_rgba(0,0,0,0.85)]
          animate-vimdy-slide-in-right
        "
      >
        {/* Historial: cajón compacto DENTRO del panel */}
        <CopilotSidebar
          variant="drawer"
          conversations={conversations}
          activeConversationId={activeConversationId}
          busy={busy}
          open={historyOpen}
          onClose={() => setHistoryOpen(false)}
          onNewChat={handleNewChat}
          onSelect={handleSelectChat}
          onDelete={deleteConversation}
        />

        {/* Cabecera */}
        <header className="flex h-14 shrink-0 items-center gap-2 border-b border-zinc-900 px-3 pt-[env(safe-area-inset-top)]">
          <button
            type="button"
            onClick={() => setHistoryOpen((v) => !v)}
            aria-label={historyOpen ? "Ocultar historial" : "Mostrar historial"}
            aria-expanded={historyOpen}
            title="Historial de chats"
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-zinc-400 transition hover:bg-zinc-900 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-600"
          >
            <History size={19} aria-hidden="true" />
          </button>

          <AiAvatar size={30} />
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-sm font-semibold leading-tight tracking-tight text-zinc-100">VIMDY IA</h2>
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
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-zinc-400 transition hover:bg-zinc-900 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-600 disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-zinc-400"
          >
            <MessageSquarePlus size={19} aria-hidden="true" />
          </button>

          <button
            type="button"
            onClick={() => copilotStore.close()}
            title="Cerrar"
            aria-label="Cerrar panel"
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-zinc-400 transition hover:bg-zinc-900 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-600"
          >
            <X size={19} aria-hidden="true" />
          </button>
        </header>

        {/* Conversación */}
        <div
          ref={scrollRef}
          role="log"
          aria-label="Conversación con VIMDY IA"
          className="flex min-h-0 flex-1 flex-col overflow-y-auto overscroll-contain px-4 py-5 [scrollbar-color:#27272a_transparent] [scrollbar-width:thin]"
        >
          {showHero ? (
            <div className="my-auto flex w-full shrink-0 flex-col items-center gap-4 py-2 text-center">
              <AiAvatar size={112} />
              <div className="space-y-1.5">
                <h3 className="text-xl font-semibold tracking-tight text-zinc-50">¿En qué te ayudo hoy?</h3>
                <p className="mx-auto max-w-xs text-sm leading-relaxed text-zinc-500">
                  Veo tus ventas, tu inventario y tus alertas en tiempo real.
                </p>
              </div>
              <CopilotSuggestions variant="list" onSelect={handleAsk} disabled={busy} />
              {error && (
                <div
                  role="alert"
                  className="w-full rounded-xl border border-red-500/20 bg-red-500/10 px-3 py-2 text-xs text-red-400"
                >
                  {error}
                </div>
              )}
            </div>
          ) : (
            <div className="w-full shrink-0 space-y-5">
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
          )}
        </div>

        {/* Entrada */}
        <div className="shrink-0 space-y-2.5 px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-2">
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
              className="max-h-32 min-w-0 flex-1 resize-none self-center !border-0 !bg-transparent py-2 text-base leading-6 !text-zinc-100 placeholder-zinc-600 shadow-none focus-visible:!outline-none disabled:opacity-60 sm:text-sm"
            />
            <button
              type="button"
              onClick={handleVoice}
              disabled={isLoading}
              title="Hablarle al Copiloto"
              aria-label={isListening ? "Escuchando" : "Hablarle al Copiloto"}
              className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-500 disabled:opacity-40 ${
                isListening
                  ? "animate-pulse bg-red-500 text-white hover:bg-red-400"
                  : "text-zinc-400 hover:bg-zinc-800 hover:text-white"
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
      </section>
    </>
  );
}

export default CopilotPanel;