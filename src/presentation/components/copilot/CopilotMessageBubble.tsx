import React from "react";
import { User } from "lucide-react";

import type { CopilotMessage } from "../../../core/types/CopilotTypes";
import { CopilotOrb } from "./CopilotOrb";

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
                    <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-cyan-400" />
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
                    <span className="w-5 shrink-0 text-right font-semibold text-cyan-300">{i + 1}.</span>
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
}

export function CopilotMessageBubble({ message, userName }: CopilotMessageBubbleProps) {
  const time = formatTime(message.createdAt);

  if (message.role === "user") {
    const initial = userName?.trim().charAt(0).toUpperCase();

    return (
      <div className="flex flex-row-reverse items-start gap-3 animate-vimdy-slide-up">
        <div
          className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-slate-600/60 bg-gradient-to-br from-slate-600 to-slate-800 text-sm font-semibold text-slate-100"
          aria-hidden="true"
        >
          {initial ? initial : <User size={16} />}
        </div>

        <div className="flex min-w-0 max-w-[85%] flex-col items-end sm:max-w-[75%]">
          <div className="mb-1 flex items-baseline gap-2">
            {time && <span className="text-xs text-slate-500">{time}</span>}
            <span className="text-xs font-semibold tracking-wide text-slate-300">Tú</span>
          </div>
          <div className="rounded-2xl rounded-tr-md bg-gradient-to-br from-cyan-500 to-blue-600 px-4 py-3 text-sm leading-relaxed text-white shadow-vimdy-sm">
            <p className="whitespace-pre-wrap break-words">{message.content}</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex items-start gap-3 animate-vimdy-slide-up">
      <div className="mt-0.5 shrink-0">
        <CopilotOrb size={40} animated={false} />
      </div>

      <div className="min-w-0 max-w-[88%] sm:max-w-[80%]">
        <div className="mb-1 flex items-baseline gap-2">
          <span className="text-xs font-semibold tracking-wide text-cyan-300">VIMDY IA</span>
          {time && <span className="text-xs text-slate-500">{time}</span>}
        </div>
        <div className="break-words rounded-2xl rounded-tl-md border border-cyan-500/15 bg-[#0F1A2B] px-4 py-3 text-sm leading-relaxed text-slate-200 shadow-vimdy-sm">
          <CopilotMessageContent content={message.content} />
        </div>
      </div>
    </div>
  );
}

/** Burbuja "pensando": tres puntos animados junto al avatar de VIMDY IA. */
export function CopilotThinkingBubble() {
  return (
    <div className="flex items-start gap-3 animate-vimdy-fade-in">
      <div className="mt-0.5 shrink-0">
        <CopilotOrb size={40} animated={false} />
      </div>

      <div className="min-w-0">
        <div className="mb-1">
          <span className="text-xs font-semibold tracking-wide text-cyan-300">VIMDY IA</span>
        </div>
        <div className="flex items-center gap-3 rounded-2xl rounded-tl-md border border-cyan-500/15 bg-[#0F1A2B] px-4 py-3 shadow-vimdy-sm">
          <span className="flex items-center gap-1" aria-hidden="true">
            {[0, 1, 2].map((i) => (
              <span
                key={i}
                className="h-1.5 w-1.5 animate-bounce rounded-full bg-cyan-400"
                style={{ animationDelay: `${i * 0.15}s` }}
              />
            ))}
          </span>
          <span className="text-sm text-slate-400">Analizando tu negocio…</span>
        </div>
      </div>
    </div>
  );
}

export default CopilotMessageBubble;