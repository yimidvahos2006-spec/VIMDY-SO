import { ObservableStore } from "./ObservableStore";
import { CopilotMessage } from "../types/CopilotTypes";

export interface CopilotSnapshot {
  readonly isOpen: boolean;
  readonly isLoading: boolean;
  readonly error: string | null;
  readonly messages: CopilotMessage[];
}

const WELCOME_MESSAGE: CopilotMessage = {
  id: "welcome",
  role: "assistant",
  content:
    "Hola, soy el Copiloto VIMDY 👋 Pregúntame lo que quieras sobre tu negocio: ventas, inventario, productos, cocina o alertas. Por ejemplo: \"¿Cuánto vendí hoy?\" o \"¿Qué debo comprar?\".",
  createdAt: new Date()
};

/**
 * copilotStore
 * ---------------------------------------------------------------------------
 * Estado del chat del Copiloto (abierto/cerrado, historial, carga, error).
 * Vive fuera de React para que el botón flotante y el panel compartan el
 * mismo estado sin prop drilling, y para que la conversación sobreviva a
 * cambios de página (el copiloto es global, no depende de la ruta actual).
 */
class CopilotStore extends ObservableStore<CopilotSnapshot> {
  constructor() {
    super({
      isOpen: false,
      isLoading: false,
      error: null,
      messages: [WELCOME_MESSAGE]
    });
  }

  public open(): void {
    this.publish({ ...this.snapshot, isOpen: true });
  }

  public close(): void {
    this.publish({ ...this.snapshot, isOpen: false });
  }

  public toggle(): void {
    this.publish({ ...this.snapshot, isOpen: !this.snapshot.isOpen });
  }

  public addUserMessage(content: string): void {
    const message: CopilotMessage = {
      id: `user-${Date.now()}`,
      role: "user",
      content,
      createdAt: new Date()
    };
    this.publish({
      ...this.snapshot,
      messages: [...this.snapshot.messages, message],
      error: null
    });
  }

  public addAssistantMessage(content: string): void {
    const message: CopilotMessage = {
      id: `assistant-${Date.now()}`,
      role: "assistant",
      content,
      createdAt: new Date()
    };
    this.publish({
      ...this.snapshot,
      messages: [...this.snapshot.messages, message],
      isLoading: false
    });
  }

  public setLoading(isLoading: boolean): void {
    this.publish({ ...this.snapshot, isLoading });
  }

  public setError(error: string): void {
    this.publish({ ...this.snapshot, error, isLoading: false });
  }

  /** Historial en el formato que espera CopilotService (sin el mensaje de bienvenida). */
  public getHistoryForApi(): CopilotMessage[] {
    return this.snapshot.messages.filter((message) => message.id !== "welcome");
  }
}

export const copilotStore = new CopilotStore();