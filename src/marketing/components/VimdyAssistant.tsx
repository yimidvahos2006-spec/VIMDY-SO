import { useEffect, useId, useRef, useState } from "react";
import { ChevronRight, MessageCircle, X } from "lucide-react";

const responses: Record<string, string> = {
  default:
    "No quiero darte información incorrecta. Puedes hablar con nuestro equipo de VIMDY por WhatsApp.",
  que_es_vimdy:
    "VIMDY es una plataforma todo en uno para negocios de alimentos y bebidas. Integra ventas, caja, inventario, cocina y reportes.",
  cuanto_cuesta:
    "Plan mensual: $59.900 COP/mes. Plan anual: $718.800 COP/año, sin descuento implícito.",
  para_que_negocios:
    "Restaurantes, cafeterías, bares, panaderías, pizzerías, food trucks y cualquier negocio de alimentos y bebidas.",
  como_funciona:
    "Te registras, creas tu negocio y empiezas a operar. Puedes registrar ventas, controlar caja, gestionar inventario y ver reportes.",
  tiene_inventario:
    "Sí. Incluye control de inventario con alertas de stock bajo, recetas para productos elaborados y trazabilidad completa.",
  soporte: "Puedes contactarnos por WhatsApp o correo electrónico: hola@vimdy.co",
};

const quickActions = [
  { id: "que_es_vimdy", label: "¿Qué es VIMDY?" },
  { id: "cuanto_cuesta", label: "¿Cuánto cuesta?" },
  { id: "para_que_negocios", label: "¿Para qué negocios sirve?" },
  { id: "como_funciona", label: "¿Cómo funciona?" },
  { id: "tiene_inventario", label: "¿Tiene inventario?" },
  { id: "soporte", label: "Hablar con soporte" },
];

type Message = {
  from: "user" | "assistant";
  text: string;
};

export function VimdyAssistant() {
  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const dialogId = useId().replace(/:/g, "");
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);
  const messagesRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setIsOpen(false);
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    closeButtonRef.current?.focus();

    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    messagesRef.current?.scrollTo({
      top: messagesRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [isOpen, messages]);

  function handleSend(actionId: string) {
    const action = quickActions.find((item) => item.id === actionId);
    if (!action) return;

    setMessages((prev) => [
      ...prev,
      {
        from: "user",
        text: action.label,
      },
      {
        from: "assistant",
        text: responses[actionId] ?? responses.default,
      },
    ]);
  }

  function handleClose() {
    setIsOpen(false);
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setIsOpen(true)}
        aria-label="Abrir asistente de VIMDY"
        aria-expanded={isOpen}
        aria-controls={dialogId}
        className="fixed bottom-5 right-5 z-50 flex h-14 w-14 items-center justify-center rounded-full border border-cyan-300/15 bg-cyan-400 text-[#041014] shadow-[0_12px_40px_rgba(34,211,238,0.2)] transition-[transform,background-color,box-shadow] duration-300 hover:-translate-y-0.5 hover:bg-cyan-300 hover:shadow-[0_16px_48px_rgba(34,211,238,0.28)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-200/70 focus-visible:ring-offset-4 focus-visible:ring-offset-[#05070a] sm:bottom-6 sm:right-6"
      >
        <MessageCircle size={23} strokeWidth={1.9} aria-hidden="true" />
      </button>

      {isOpen && (
        <div
          id={dialogId}
          role="dialog"
          aria-modal="false"
          aria-labelledby={`${dialogId}-title`}
          className="fixed bottom-[84px] right-4 z-50 w-[min(390px,calc(100vw-2rem))] overflow-hidden rounded-[28px] border border-white/[0.09] bg-[#080b0f]/96 shadow-[0_30px_100px_rgba(0,0,0,0.48)] backdrop-blur-2xl sm:bottom-24 sm:right-6"
        >
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-x-0 top-0 h-24 bg-[radial-gradient(circle_at_80%_0%,rgba(34,211,238,0.13),transparent_55%)]"
          />

          <div className="relative flex items-start justify-between gap-4 border-b border-white/[0.07] px-5 py-4 sm:px-6">
            <div>
              <div className="flex items-center gap-2.5">
                <span
                  aria-hidden="true"
                  className="h-2 w-2 rounded-full bg-cyan-300 shadow-[0_0_14px_rgba(103,232,249,0.65)]"
                />
                <h2
                  id={`${dialogId}-title`}
                  className="text-sm font-semibold tracking-[-0.01em] text-white"
                >
                  VIMDY Assistant
                </h2>
              </div>
              <p className="mt-1 text-xs text-zinc-500">
                Información rápida sobre VIMDY.
              </p>
            </div>

            <button
              ref={closeButtonRef}
              type="button"
              onClick={handleClose}
              aria-label="Cerrar asistente"
              className="rounded-full border border-white/[0.07] bg-white/[0.025] p-2 text-zinc-500 transition-[background-color,border-color,color] duration-300 hover:border-white/[0.14] hover:bg-white/[0.06] hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/50"
            >
              <X size={17} aria-hidden="true" />
            </button>
          </div>

          <div
            ref={messagesRef}
            aria-live="polite"
            className="relative max-h-[330px] space-y-3 overflow-y-auto px-5 py-5 [scrollbar-color:rgba(255,255,255,0.12)_transparent] [scrollbar-width:thin] sm:px-6"
          >
            {messages.length === 0 ? (
              <div className="rounded-2xl border border-white/[0.06] bg-white/[0.02] px-4 py-3.5">
                <p className="text-sm leading-6 text-zinc-300">
                  👋 Hola. Soy VIMDY. ¿Qué quieres conocer?
                </p>
              </div>
            ) : (
              messages.map((message, index) => (
                <div
                  key={`${message.from}-${index}`}
                  className={message.from === "user" ? "text-right" : "text-left"}
                >
                  <span
                    className={[
                      "inline-block max-w-[88%] rounded-2xl px-3.5 py-2.5 text-sm leading-6",
                      message.from === "user"
                        ? "rounded-br-md bg-cyan-400 text-[#041014]"
                        : "rounded-bl-md border border-white/[0.06] bg-white/[0.035] text-zinc-300",
                    ].join(" ")}
                  >
                    {message.text}
                  </span>
                </div>
              ))
            )}
          </div>

          {messages.length === 0 && (
            <div className="relative border-t border-white/[0.07] bg-black/10 px-4 py-4 sm:px-5">
              <p className="mb-3 px-1 text-[10px] font-semibold uppercase tracking-[0.2em] text-zinc-600">
                Preguntas rápidas
              </p>

              <div className="space-y-1.5">
                {quickActions.map((action) => (
                  <button
                    key={action.id}
                    type="button"
                    onClick={() => handleSend(action.id)}
                    className="group flex w-full items-center justify-between gap-3 rounded-xl border border-transparent bg-white/[0.02] px-3.5 py-3 text-left text-sm text-zinc-400 transition-[background-color,border-color,color] duration-200 hover:border-white/[0.07] hover:bg-white/[0.045] hover:text-zinc-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-cyan-300/45"
                  >
                    <span>{action.label}</span>
                    <ChevronRight
                      size={15}
                      aria-hidden="true"
                      className="shrink-0 text-zinc-700 transition-transform duration-200 group-hover:translate-x-0.5 group-hover:text-cyan-300/70"
                    />
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </>
  );
}