import { supabase } from "../supabase/supabaseClient";
import { connectionStore } from "../../core/store/connectionStore";
import { CopilotMessage } from "../../core/types/CopilotTypes";

export class CopilotApiClient {
  public async sendMessage(system: string, history: CopilotMessage[]): Promise<string> {
    if (!connectionStore.isOnline()) {
      return "Sin conexión: el Copiloto necesita internet para responder. Cuando vuelva la conexión, podés preguntarme lo que necesites.";
    }

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