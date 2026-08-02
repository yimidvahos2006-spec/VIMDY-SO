import { supabase } from "../supabase/supabaseClient";
import { CopilotMessage } from "../../core/types/CopilotTypes";

/**
 * CopilotApiClient
 * ---------------------------------------------------------------------------
 * Único punto del frontend que sabe cómo llegar a Claude: llama a la Edge
 * Function `copilot-chat` (nunca directo a api.anthropic.com desde el
 * navegador, para no exponer la API key). Mismo patrón que
 * authBusinessContext.ts usa con `register-business`.
 */
export class CopilotApiClient {
  public async sendMessage(system: string, history: CopilotMessage[]): Promise<string> {
    const messages = history.map((message) => ({
      role: message.role,
      content: message.content
    }));

    const { data, error } = await supabase.functions.invoke("copilot-chat", {
      body: { system, messages }
    });

    if (error) {
      throw new Error(`COPILOT_UNAVAILABLE: ${error.message}`);
    }

    if (!data?.reply) {
      throw new Error("COPILOT_EMPTY_REPLY: el servidor no devolvió una respuesta.");
    }

    return data.reply as string;
  }
}