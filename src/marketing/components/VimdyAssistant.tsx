import { useEffect, useId, useRef, useState } from "react";
import { ChevronRight, MessageCircle, X } from "lucide-react";
import { VIMDY_CONTACT } from "../../core/config/contact";
import { MULTI_BRANCH_ANSWER, PRICING_SUMMARY } from "../pricingCopy";

const responses: Record<string, string> = {
  default:
    "No quiero darte información incorrecta. Puedes hablar con nuestro equipo de VIMDY por WhatsApp.",
  que_es_vimdy:
    "VIMDY es una plataforma todo en uno para negocios de alimentos y bebidas. Integra ventas, caja, inventario, cocina y reportes.",
  cuanto_cuesta: PRICING_SUMMARY,
  varias_sedes: MULTI_BRANCH_ANSWER,
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
  { id: "varias_sedes", label: "¿Tengo varias sedes?" },
  { id: "para_que_negocios", label: "¿Para qué negocios sirve?" },
  { id: "como_funciona", label: "¿Cómo funciona?" },
  { id: "tiene_inventario", label: "¿Tiene inventario?" },
  { id: "soporte", label: "Hablar con soporte" },
];

const WHATSAPP_LINK = `${VIMDY_CONTACT.whatsapp.link}?text=${encodeURIComponent(
  "Hola VIMDY, quiero más información."
)}`;

function WhatsAppIcon({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M17.47 14.38c-.3-.15-1.76-.87-2.03-.97-.27-.1-.47-.15-.67.15-.2.3-.77.97-.94 1.17-.17.2-.35.22-.65.07-.3-.15-1.26-.46-2.4-1.48-.89-.79-1.49-1.77-1.66-2.07-.17-.3-.02-.46.13-.61.13-.13.3-.35.45-.52.15-.17.2-.3.3-.5.1-.2.05-.37-.03-.52-.07-.15-.67-1.61-.92-2.2-.24-.58-.49-.5-.67-.51h-.57c-.2 0-.52.07-.8.37-.27.3-1.04 1.02-1.04 2.48 0 1.46 1.07 2.88 1.21 3.08.15.2 2.1 3.2 5.08 4.49.71.31 1.26.49 1.69.63.71.23 1.36.2 1.87.12.57-.08 1.76-.72 2.01-1.41.25-.69.25-1.29.17-1.41-.07-.12-.27-.2-.57-.35zM12.05 21.8h-.01a9.87 9.87 0 0 1-5.03-1.38l-.36-.21-3.74.98 1-3.65-.24-.37a9.86 9.86 0 0 1-1.51-5.26c0-5.45 4.44-9.88 9.89-9.88a9.82 9.82 0 0 1 6.99 2.9 9.82 9.82 0 0 1 2.89 6.99c0 5.45-4.44 9.88-9.88 9.88zM20.52 3.45A11.8 11.8 0 0 0 12.05 0C5.5 0 .16 5.34.16 11.89c0 2.1.55 4.14 1.59 5.95L.06 24l6.3-1.65a11.88 11.88 0 0 0 5.68 1.45h.01c6.55 0 11.89-5.34 11.89-11.89 0-3.18-1.24-6.17-3.48-8.42z" />
    </svg>
  );
}

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

          <div className="relative border-t border-white/[0.07] bg-black/10 px-4 py-3 sm:px-5">
            <a
              href={WHATSAPP_LINK}
              target="_blank"
              rel="noopener noreferrer"
              aria-label="Escribir a VIMDY por WhatsApp"
              className="flex w-full items-center justify-center gap-2.5 rounded-xl bg-[#25D366] px-4 py-3 text-sm font-semibold text-[#052e16] shadow-[0_8px_28px_rgba(37,211,102,0.22)] transition-[transform,background-color,box-shadow] duration-300 hover:-translate-y-px hover:bg-[#3ee27a] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#86efac]/70"
            >
              <WhatsAppIcon size={20} />
              <span>Escríbenos por WhatsApp</span>
            </a>
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