import { supabase, getCurrentBusinessId } from "../supabase/supabaseClient";
import { connectionStore } from "../../core/store/connectionStore";
import { CopilotMessage } from "../../core/types/CopilotTypes";

export class CopilotApiClient {
  public async sendMessage(system: string, history: CopilotMessage[]): Promise<string> {
    if (!connectionStore.isOnline()) {
      return "Sin conexión: el Copiloto necesita internet para responder. Cuando vuelva la conexión, puedes preguntarme lo que necesites.";
    }

    const messages = history.map((message) => ({
      role: message.role,
      content: message.content
    }));

    const businessId = getCurrentBusinessId();
    if (!businessId) {
      throw new Error("COPILOT_UNAVAILABLE: no hay un negocio activo en esta sesión.");
    }

    const { data, error } = await supabase.functions.invoke("copilot-chat", {
      body: { system, messages, businessId }
    });

    if (error) {
      // supabase-js oculta el motivo real en error.context (la Response). Lo leemos
      // para mostrar "SUBSCRIPTION_EXPIRED", "ANTHROPIC_API_ERROR", etc. en vez de
      // un genérico "non-2xx".
      let detail = error.message;
      try {
        const response = (error as { context?: Response }).context;
        if (response && typeof response.json === "function") {
          const body = await response.json();
          detail = [body?.error, body?.detail].filter(Boolean).join(" — ") || detail;
        }
      } catch {
        // si el cuerpo no es JSON dejamos el mensaje original
      }
      throw new Error(`COPILOT_UNAVAILABLE: ${detail}`);
    }

    if (!data?.reply) {
      throw new Error("COPILOT_EMPTY_REPLY: el servidor no devolvió una respuesta.");
    }

    return data.reply as string;
  }
}