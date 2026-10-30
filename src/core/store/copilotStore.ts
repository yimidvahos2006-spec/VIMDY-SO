import { ObservableStore } from "./ObservableStore";
import { CopilotMessage } from "../types/CopilotTypes";

/** Resumen de un chat guardado: lo que necesita la barra lateral del historial. */
export interface CopilotConversationSummary {
  readonly id: string;
  readonly title: string;
  readonly updatedAt: Date;
  readonly messageCount: number;
}

export interface CopilotSnapshot {
  readonly isOpen: boolean;
  readonly isLoading: boolean;
  readonly error: string | null;
  /** Mensajes del chat ACTIVO (el panel flotante y /ia leen siempre esto). */
  readonly messages: CopilotMessage[];
  /** Id del chat activo. Un chat sin mensajes del usuario aún no aparece en `conversations`. */
  readonly activeConversationId: string;
  /** Historial: solo chats con al menos un mensaje del usuario, el más reciente primero. */
  readonly conversations: CopilotConversationSummary[];
}

const WELCOME_MESSAGE: CopilotMessage = {
  id: "welcome",
  role: "assistant",
  content:
    "Hola, soy el Copiloto VIMDY 👋 Pregúntame lo que quieras sobre tu negocio: ventas, inventario, productos, cocina o alertas. Por ejemplo: \"¿Cuánto vendí hoy?\" o \"¿Qué debo comprar?\".",
  createdAt: new Date()
};

interface Conversation {
  id: string;
  title: string;
  createdAt: Date;
  updatedAt: Date;
  /** Sin el mensaje de bienvenida: se antepone al activar el chat. */
  messages: CopilotMessage[];
}

/* ---------------------------------------------------------------------------
 * Persistencia del historial (localStorage)
 * ---------------------------------------------------------------------------
 * Las conversaciones contienen datos del negocio, así que se borran por
 * completo al cerrar sesión (ver clearAll, llamado desde AuthContext). Todo
 * acceso va en try/catch: modo privado, cuota llena o storage bloqueado no
 * deben romper el Copiloto — simplemente no se guarda el historial.
 * ------------------------------------------------------------------------- */

const STORAGE_KEY = "vimdy.copilot.conversations.v1";
const MAX_CONVERSATIONS = 50;
const MAX_MESSAGES_PER_CONVERSATION = 200;
const TITLE_MAX_LENGTH = 48;

interface StoredMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  createdAt: string;
}

interface StoredConversation {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  messages: StoredMessage[];
}

function toDate(value: unknown): Date {
  const date = new Date(typeof value === "string" || typeof value === "number" ? value : NaN);
  return Number.isNaN(date.getTime()) ? new Date() : date;
}

function loadConversations(): Conversation[] {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];

    const result: Conversation[] = [];
    for (const item of parsed as StoredConversation[]) {
      if (!item || typeof item.id !== "string" || !Array.isArray(item.messages)) continue;

      const messages: CopilotMessage[] = [];
      for (const m of item.messages) {
        if (!m || typeof m.content !== "string" || (m.role !== "user" && m.role !== "assistant")) continue;
        messages.push({
          id: typeof m.id === "string" ? m.id : `${m.role}-${messages.length}`,
          role: m.role,
          content: m.content,
          createdAt: toDate(m.createdAt)
        });
      }
      if (!messages.some((m) => m.role === "user")) continue;

      result.push({
        id: item.id,
        title: typeof item.title === "string" && item.title.trim() ? item.title : buildTitle(messages),
        createdAt: toDate(item.createdAt),
        updatedAt: toDate(item.updatedAt),
        messages
      });
    }
    return result.slice(0, MAX_CONVERSATIONS);
  } catch {
    return [];
  }
}

function persistConversations(conversations: Conversation[]): void {
  try {
    const stored: StoredConversation[] = conversations
      .filter((c) => c.messages.some((m) => m.role === "user"))
      .slice(0, MAX_CONVERSATIONS)
      .map((c) => ({
        id: c.id,
        title: c.title,
        createdAt: c.createdAt.toISOString(),
        updatedAt: c.updatedAt.toISOString(),
        messages: c.messages.slice(-MAX_MESSAGES_PER_CONVERSATION).map((m) => ({
          id: m.id,
          role: m.role,
          content: m.content,
          createdAt: m.createdAt.toISOString()
        }))
      }));

    if (stored.length === 0) {
      window.localStorage.removeItem(STORAGE_KEY);
    } else {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(stored));
    }
  } catch {
    /* sin storage disponible: el historial dura solo mientras la pestaña esté abierta */
  }
}

function buildTitle(messages: CopilotMessage[]): string {
  const firstUser = messages.find((m) => m.role === "user");
  const text = (firstUser?.content ?? "").replace(/\s+/g, " ").trim();
  if (!text) return "Nuevo chat";
  return text.length > TITLE_MAX_LENGTH ? `${text.slice(0, TITLE_MAX_LENGTH - 1).trimEnd()}…` : text;
}

function createConversationId(): string {
  return `chat-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function newEmptyConversation(): Conversation {
  const now = new Date();
  return { id: createConversationId(), title: "Nuevo chat", createdAt: now, updatedAt: now, messages: [] };
}

function withWelcome(conversation: Conversation): CopilotMessage[] {
  return [{ ...WELCOME_MESSAGE, createdAt: conversation.createdAt }, ...conversation.messages];
}

/**
 * copilotStore
 * ---------------------------------------------------------------------------
 * Estado del chat del Copiloto (abierto/cerrado, historial, carga, error).
 * Vive fuera de React para que el botón flotante, el panel y la página /ia
 * compartan el mismo estado sin prop drilling, y para que la conversación
 * sobreviva a cambios de página (el copiloto es global, no depende de la
 * ruta actual).
 *
 * Historial de chats: cada conversación se guarda al enviar el primer mensaje
 * (un chat vacío nunca ensucia el historial) y se persiste en localStorage.
 * `messages` siempre es el chat activo, así que el panel flotante y /ia no
 * necesitan saber nada del historial para seguir funcionando.
 */
class CopilotStore extends ObservableStore<CopilotSnapshot> {
  private conversations: Conversation[];
  private active: Conversation;

  constructor() {
    const stored = loadConversations();
    const draft = newEmptyConversation();

    super({
      isOpen: false,
      isLoading: false,
      error: null,
      messages: withWelcome(draft),
      activeConversationId: draft.id,
      conversations: []
    });

    this.conversations = stored;
    this.active = draft;
    // Al abrir la app se empieza en un chat nuevo; el historial queda en la barra lateral.
    this.snapshot = this.buildSnapshot({});
  }

  /** Reconstruye el snapshot desde el estado interno, aplicando los cambios dados. */
  private buildSnapshot(
    patch: Partial<Pick<CopilotSnapshot, "isOpen" | "isLoading" | "error">>
  ): CopilotSnapshot {
    const sorted = [...this.conversations].sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());
    return {
      isOpen: patch.isOpen ?? this.snapshot.isOpen,
      isLoading: patch.isLoading ?? this.snapshot.isLoading,
      error: patch.error !== undefined ? patch.error : this.snapshot.error,
      messages: withWelcome(this.active),
      activeConversationId: this.active.id,
      conversations: sorted.map((c) => ({
        id: c.id,
        title: c.title,
        updatedAt: c.updatedAt,
        messageCount: c.messages.length
      }))
    };
  }

  /** Aplica cambios internos, guarda (si hace falta) y avisa a React. */
  private commit(
    patch: Partial<Pick<CopilotSnapshot, "isOpen" | "isLoading" | "error">> = {},
    persist = false
  ): void {
    if (persist) persistConversations(this.conversations);
    this.publish(this.buildSnapshot(patch));
  }

  public open(): void {
    this.commit({ isOpen: true });
  }

  public close(): void {
    this.commit({ isOpen: false });
  }

  public toggle(): void {
    this.commit({ isOpen: !this.snapshot.isOpen });
  }

  /**
   * Nuevo chat: el chat actual queda guardado en el historial y se abre uno en
   * blanco con el mensaje de bienvenida. Si el chat activo ya está vacío no se
   * crea otro. Conserva isOpen (el panel flotante no se cierra). No se permite
   * mientras hay una respuesta en camino: caería dentro del chat nuevo.
   */
  public reset(): void {
    if (this.snapshot.isLoading) return;
    if (this.active.messages.length === 0) {
      this.commit({ error: null });
      return;
    }
    this.active = newEmptyConversation();
    this.commit({ error: null });
  }

  /** Alias explícito de reset() para el botón "Nuevo chat". */
  public startNewConversation(): void {
    this.reset();
  }

  /** Abre un chat guardado. Se ignora mientras hay una respuesta pendiente. */
  public selectConversation(id: string): void {
    if (this.snapshot.isLoading || id === this.active.id) return;
    const target = this.conversations.find((c) => c.id === id);
    if (!target) return;
    this.active = target;
    this.commit({ error: null });
  }

  /**
   * Borra un chat del historial. Si era el activo se pasa a un chat en blanco.
   * El chat activo no se puede borrar mientras espera respuesta.
   */
  public deleteConversation(id: string): void {
    const exists = this.conversations.some((c) => c.id === id);
    if (!exists) return;
    if (id === this.active.id && this.snapshot.isLoading) return;

    const wasActive = id === this.active.id;
    this.conversations = this.conversations.filter((c) => c.id !== id);
    if (wasActive) this.active = newEmptyConversation();
    this.commit(wasActive ? { error: null } : {}, true);
  }

  /**
   * Borra TODO: historial en memoria y en localStorage. Se usa al cerrar
   * sesión, para que el siguiente usuario del equipo no vea chats ajenos.
   */
  public clearAll(): void {
    this.conversations = [];
    this.active = newEmptyConversation();
    try {
      window.localStorage.removeItem(STORAGE_KEY);
    } catch {
      /* storage no disponible */
    }
    this.commit({ isLoading: false, error: null });
  }

  private appendMessage(message: CopilotMessage): void {
    const isFirstUserMessage = message.role === "user" && this.active.messages.length === 0;

    this.active = {
      ...this.active,
      messages: [...this.active.messages, message],
      updatedAt: new Date(),
      title: isFirstUserMessage ? buildTitle([message]) : this.active.title
    };

    // El chat entra al historial cuando recibe su primer mensaje del usuario.
    if (this.active.messages.some((m) => m.role === "user")) {
      const index = this.conversations.findIndex((c) => c.id === this.active.id);
      if (index === -1) this.conversations = [this.active, ...this.conversations];
      else this.conversations[index] = this.active;
      this.conversations = this.conversations.slice(0, MAX_CONVERSATIONS);
    }
  }

  public addUserMessage(content: string): void {
    this.appendMessage({
      id: `user-${Date.now()}`,
      role: "user",
      content,
      createdAt: new Date()
    });
    this.commit({ error: null }, true);
  }

  public addAssistantMessage(content: string): void {
    this.appendMessage({
      id: `assistant-${Date.now()}`,
      role: "assistant",
      content,
      createdAt: new Date()
    });
    this.commit({ isLoading: false }, true);
  }

  public setLoading(isLoading: boolean): void {
    this.commit({ isLoading });
  }

  public setError(error: string): void {
    this.commit({ error, isLoading: false });
  }

  /** Historial en el formato que espera CopilotService (sin el mensaje de bienvenida). */
  public getHistoryForApi(): CopilotMessage[] {
    return this.active.messages;
  }
}

export const copilotStore = new CopilotStore();