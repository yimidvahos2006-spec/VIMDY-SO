import React from "react";
import { User } from "lucide-react";

import type { CopilotMessage } from "../../../core/types/CopilotTypes";
import { AiAvatar } from "./AiAvatar";

/* ---------------------------------------------------------------------------
 * Contenido del mensaje
 * ---------------------------------------------------------------------------
 * Gemini responde con formato tipo Markdown (**negrita**, listas con - o *,
 * listas numeradas, títulos con #). Mostrarlo crudo se ve como texto con
 * asteriscos, así que se convierte a elementos de React. No se usa
 * dangerouslySetInnerHTML: todo el texto del modelo se renderiza como texto,
 * por lo que no hay forma de inyectar HTML.
 * ------------------------------------------------------------------------- */

type Block =
  | { type: "p"; text: string }
  | { type: "h"; text: string }
  | { type: "ul"; items: string[] }
  | { type: "ol"; items: string[] };

function parseBlocks(content: string): Block[] {
  const blocks: Block[] = [];
  let paragraph: string[] = [];

  const flushParagraph = () => {
    if (paragraph.length > 0) {
      blocks.push({ type: "p", text: paragraph.join("\n") });
      paragraph = [];
    }
  };

  for (const line of content.replace(/\r\n/g, "\n").split("\n")) {
    const heading = line.match(/^\s*#{1,6}\s+(.+)$/);
    const bullet = line.match(/^\s*[-*•]\s+(.+)$/);
    const ordered = line.match(/^\s*\d+[.)]\s+(.+)$/);

    if (heading) {
      flushParagraph();
      blocks.push({ type: "h", text: heading[1] });
    } else if (bullet) {
      flushParagraph();
      const last = blocks[blocks.length - 1];
      if (last && last.type === "ul") last.items.push(bullet[1]);
      else blocks.push({ type: "ul", items: [bullet[1]] });
    } else if (ordered) {
      flushParagraph();
      const last = blocks[blocks.length - 1];
      if (last && last.type === "ol") last.items.push(ordered[1]);
      else blocks.push({ type: "ol", items: [ordered[1]] });
    } else if (line.trim() === "") {
      flushParagraph();
    } else {
      paragraph.push(line);
    }
  }

  flushParagraph();
  return blocks;
}

/** Convierte **texto** en <strong>; el resto queda como texto plano. */
function renderInline(text: string): React.ReactNode[] {
  return text.split(/(\*\*[^*]+\*\*)/g).map((part, index) => {
    if (part.length > 4 && part.startsWith("**") && part.endsWith("**")) {
      return (
        <strong key={index} className="font-semibold text-white">
          {part.slice(2, -2)}
        </strong>
      );
    }
    return <React.Fragment key={index}>{part}</React.Fragment>;
  });
}

export function CopilotMessageContent({ content }: { content: string }) {
  const blocks = parseBlocks(content);

  return (
    <div className="space-y-2.5">
      {blocks.map((block, index) => {
        switch (block.type) {
          case "h":
            return (
              <p key={index} className="font-semibold text-white">
                {renderInline(block.text)}
              </p>
            );
          case "ul":
            return (
              <ul key={index} className="space-y-1.5">
                {block.items.map((item, i) => (
                  <li key={i} className="flex gap-2.5">
                    <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-zinc-500" />
                    <span className="min-w-0">{renderInline(item)}</span>
                  </li>
                ))}
              </ul>
            );
          case "ol":
            return (
              <ol key={index} className="space-y-1.5">
                {block.items.map((item, i) => (
                  <li key={i} className="flex gap-2.5">
                    <span className="w-5 shrink-0 text-right font-semibold text-zinc-400">{i + 1}.</span>
                    <span className="min-w-0">{renderInline(item)}</span>
                  </li>
                ))}
              </ol>
            );
          default:
            return (
              <p key={index} className="whitespace-pre-line">
                {renderInline(block.text)}
              </p>
            );
        }
      })}
    </div>
  );
}

/* ---------------------------------------------------------------------------
 * Burbujas
 * ------------------------------------------------------------------------- */

function formatTime(date: Date): string {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return "";
  return date.toLocaleTimeString("es-CO", { hour: "2-digit", minute: "2-digit" });
}

interface CopilotMessageBubbleProps {
  message: CopilotMessage;
  /** Nombre de la persona que usa VIMDY (para la inicial del avatar). */
  userName?: string;
  /** Versión reducida (avatares y márgenes más chicos) para el panel flotante. */
  compact?: boolean;
}

export function CopilotMessageBubble({ message, userName, compact = false }: CopilotMessageBubbleProps) {
  const time = formatTime(message.createdAt);

  if (message.role === "user") {
    const initial = userName?.trim().charAt(0).toUpperCase();

    return (
      <div className={`flex flex-row-reverse items-start animate-vimdy-slide-up ${compact ? "gap-2" : "gap-3"}`}>
        <div
          className={`mt-0.5 flex shrink-0 items-center justify-center rounded-full border border-zinc-800 bg-zinc-900 font-semibold text-zinc-200 ${
            compact ? "h-7 w-7 text-xs" : "h-9 w-9 text-sm"
          }`}
          aria-hidden="true"
        >
          {initial ? initial : <User size={compact ? 13 : 16} />}
        </div>

        <div
          className={`flex min-w-0 flex-col items-end ${
            compact ? "max-w-[85%]" : "max-w-[85%] sm:max-w-[75%]"
          }`}
        >
          <div className="mb-1 flex items-baseline gap-2">
            {time && <span className="text-xs text-zinc-600">{time}</span>}
            <span className="text-xs font-semibold tracking-wide text-zinc-400">Tú</span>
          </div>
          <div className="rounded-2xl rounded-tr-md border border-zinc-800 bg-zinc-900 px-4 py-3 text-sm leading-relaxed text-zinc-100">
            <p className="whitespace-pre-wrap break-words">{message.content}</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={`flex items-start animate-vimdy-slide-up ${compact ? "gap-2" : "gap-3"}`}>
      <div className="mt-0.5 shrink-0">
        <AiAvatar size={compact ? 28 : 40} />
      </div>

      <div className={`min-w-0 ${compact ? "max-w-[88%]" : "max-w-[88%] sm:max-w-[80%]"}`}>
        <div className="mb-1 flex items-baseline gap-2">
          <span className="text-xs font-semibold tracking-wide text-zinc-300">VIMDY IA</span>
          {time && <span className="text-xs text-zinc-600">{time}</span>}
        </div>
        <div className="break-words rounded-2xl rounded-tl-md border border-zinc-800 bg-zinc-950 px-4 py-3 text-sm leading-relaxed text-zinc-200">
          <CopilotMessageContent content={message.content} />
        </div>
      </div>
    </div>
  );
}

/** Burbuja "pensando": tres puntos animados junto al avatar de VIMDY IA. */
export function CopilotThinkingBubble({ compact = false }: { compact?: boolean }) {
  return (
    <div className={`flex items-start animate-vimdy-fade-in ${compact ? "gap-2" : "gap-3"}`}>
      <div className="mt-0.5 shrink-0">
        <AiAvatar size={compact ? 28 : 40} />
      </div>

      <div className="min-w-0">
        <div className="mb-1">
          <span className="text-xs font-semibold tracking-wide text-zinc-300">VIMDY IA</span>
        </div>
        <div className="flex items-center gap-3 rounded-2xl rounded-tl-md border border-zinc-800 bg-zinc-950 px-4 py-3">
          <span className="flex items-center gap-1" aria-hidden="true">
            {[0, 1, 2].map((i) => (
              <span
                key={i}
                className="h-1.5 w-1.5 animate-bounce rounded-full bg-zinc-400"
                style={{ animationDelay: `${i * 0.15}s` }}
              />
            ))}
          </span>
          <span className="text-sm text-zinc-500">Analizando tu negocio…</span>
        </div>
      </div>
    </div>
  );
}

export default CopilotMessageBubble;