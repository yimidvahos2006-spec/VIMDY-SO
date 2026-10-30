import React, { useEffect, useMemo, useState } from "react";
import { Check, MessageSquarePlus, Trash2, X } from "lucide-react";

import type { CopilotConversationSummary } from "../../../core/store/copilotStore";
import { AiAvatar } from "./AiAvatar";

interface CopilotSidebarProps {
  conversations: CopilotConversationSummary[];
  activeConversationId: string;
  /** Bloquea cambiar/borrar el chat activo mientras hay una respuesta en camino. */
  busy: boolean;
  /** Abierto/cerrado. */
  open: boolean;
  /**
   * "column": en escritorio es una columna fija (layout de pantalla completa).
   * "drawer": SIEMPRE un cajón superpuesto dentro de su contenedor (panel flotante),
   * nunca ocupa espacio en el layout.
   */
  variant?: "column" | "drawer";
  onClose: () => void;
  onNewChat: () => void;
  onSelect: (id: string) => void;
  onDelete: (id: string) => void;
}

interface Group {
  label: string;
  items: CopilotConversationSummary[];
}

function groupByDate(conversations: CopilotConversationSummary[]): Group[] {
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  const day = 24 * 60 * 60 * 1000;

  const buckets: Group[] = [
    { label: "Hoy", items: [] },
    { label: "Ayer", items: [] },
    { label: "Últimos 7 días", items: [] },
    { label: "Anteriores", items: [] }
  ];

  for (const c of conversations) {
    const age = startOfToday.getTime() - c.updatedAt.getTime();
    if (age <= 0) buckets[0].items.push(c);
    else if (age <= day) buckets[1].items.push(c);
    else if (age <= 7 * day) buckets[2].items.push(c);
    else buckets[3].items.push(c);
  }
  return buckets.filter((b) => b.items.length > 0);
}

/**
 * CopilotSidebar
 * ---------------------------------------------------------------------------
 * Historial de chats de VIMDY IA (estilo ChatGPT). Cada chat se puede abrir y
 * borrar; el borrado pide confirmación en la misma fila para evitar accidentes.
 */
export function CopilotSidebar({
  conversations,
  activeConversationId,
  busy,
  open,
  variant = "column",
  onClose,
  onNewChat,
  onSelect,
  onDelete
}: CopilotSidebarProps) {
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const groups = useMemo(() => groupByDate(conversations), [conversations]);
  const drawer = variant === "drawer";

  // Si el chat en confirmación desaparece (o se cierra el cajón), se cancela.
  useEffect(() => {
    if (confirmingId && !conversations.some((c) => c.id === confirmingId)) setConfirmingId(null);
  }, [conversations, confirmingId]);
  useEffect(() => {
    if (!open) setConfirmingId(null);
  }, [open]);

  return (
    <>
      {/* Fondo del cajón (solo móvil) */}
      <div
        onClick={onClose}
        aria-hidden="true"
        className={`absolute inset-0 z-30 bg-black/70 backdrop-blur-sm transition-opacity duration-200 ${
          drawer ? "" : "md:hidden"
        } ${open ? "opacity-100" : "pointer-events-none opacity-0"}`}
      />

      <aside
        aria-label="Historial de chats"
        className={`absolute inset-y-0 left-0 z-40 flex w-[85%] max-w-[300px] flex-col overflow-hidden border-r border-zinc-800 bg-black transition-transform duration-200 ease-out ${
          drawer
            ? ""
            : "md:static md:z-auto md:w-[280px] md:max-w-none md:shrink-0 md:transition-[margin]"
        } ${
          open
            ? `translate-x-0 ${drawer ? "" : "md:ml-0"}`
            : `-translate-x-full ${drawer ? "" : "md:ml-[-280px] md:translate-x-0"}`
        }`}
        // Cerrado: fuera del orden de tabulación y de lectores de pantalla.
        {...(!open ? { inert: true } : {})}
      >
        <div className="flex items-center gap-3 px-4 pb-3 pt-4">
          <AiAvatar size={32} />
          <span className="flex-1 truncate text-sm font-semibold tracking-tight text-zinc-100">VIMDY IA</span>
          <button
            type="button"
            onClick={onClose}
            aria-label="Cerrar historial"
            className={`flex h-9 w-9 items-center justify-center rounded-lg text-zinc-400 transition hover:bg-zinc-900 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-600 ${
              drawer ? "" : "md:hidden"
            }`}
          >
            <X size={18} aria-hidden="true" />
          </button>
        </div>

        <div className="px-3 pb-2">
          <button
            type="button"
            onClick={onNewChat}
            disabled={busy}
            className="flex w-full items-center gap-2.5 rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-2.5 text-sm font-medium text-zinc-100 transition hover:border-zinc-700 hover:bg-zinc-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-600 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <MessageSquarePlus size={16} aria-hidden="true" />
            Nuevo chat
          </button>
        </div>

        <nav className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-2 pb-3 [scrollbar-color:#27272a_transparent] [scrollbar-width:thin]">
          {groups.length === 0 ? (
            <p className="px-3 py-6 text-center text-xs leading-relaxed text-zinc-600">
              Aún no tienes chats guardados. Tus conversaciones aparecerán aquí.
            </p>
          ) : (
            groups.map((group) => (
              <div key={group.label} className="mt-3 first:mt-1">
                <h3 className="px-3 pb-1 text-[11px] font-medium uppercase tracking-wider text-zinc-600">
                  {group.label}
                </h3>
                <ul className="space-y-0.5">
                  {group.items.map((chat) => {
                    const isActive = chat.id === activeConversationId;
                    const isConfirming = confirmingId === chat.id;
                    const lockedActive = isActive && busy;

                    return (
                      <li key={chat.id}>
                        <div
                          className={`group relative flex items-center rounded-xl transition ${
                            isActive ? "bg-zinc-900" : "hover:bg-zinc-950"
                          }`}
                        >
                          {isConfirming ? (
                            <div className="flex w-full items-center gap-1 px-3 py-2" role="alert">
                              <span className="min-w-0 flex-1 truncate text-sm text-zinc-300">¿Eliminar este chat?</span>
                              <button
                                type="button"
                                onClick={() => {
                                  setConfirmingId(null);
                                  onDelete(chat.id);
                                }}
                                aria-label="Confirmar: eliminar chat"
                                className="flex h-8 w-8 items-center justify-center rounded-lg text-red-400 transition hover:bg-red-500/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500/50"
                              >
                                <Check size={16} aria-hidden="true" />
                              </button>
                              <button
                                type="button"
                                onClick={() => setConfirmingId(null)}
                                aria-label="Cancelar"
                                className="flex h-8 w-8 items-center justify-center rounded-lg text-zinc-400 transition hover:bg-zinc-800 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-600"
                              >
                                <X size={16} aria-hidden="true" />
                              </button>
                            </div>
                          ) : (
                            <>
                              <button
                                type="button"
                                onClick={() => onSelect(chat.id)}
                                disabled={busy && !isActive}
                                aria-current={isActive ? "true" : undefined}
                                title={chat.title}
                                className="min-w-0 flex-1 truncate rounded-xl px-3 py-2.5 text-left text-sm text-zinc-300 transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-600 disabled:cursor-not-allowed disabled:opacity-50"
                              >
                                <span className={isActive ? "text-white" : undefined}>{chat.title}</span>
                              </button>
                              <button
                                type="button"
                                onClick={() => setConfirmingId(chat.id)}
                                disabled={lockedActive}
                                aria-label={`Eliminar chat: ${chat.title}`}
                                title="Eliminar chat"
                                className="mr-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-zinc-500 transition hover:bg-zinc-800 hover:text-red-400 focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-600 disabled:cursor-not-allowed disabled:opacity-30 md:opacity-0 md:group-hover:opacity-100"
                              >
                                <Trash2 size={15} aria-hidden="true" />
                              </button>
                            </>
                          )}
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))
          )}
        </nav>

      </aside>
    </>
  );
}

export default CopilotSidebar;