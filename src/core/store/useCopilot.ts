import { useSyncExternalStore } from "react";
import { copilotStore } from "./copilotStore";

/**
 * useCopilot
 * ---------------------------------------------------------------------------
 * Este archivo faltaba por completo — CopilotPanel.tsx y CopilotButton.tsx
 * ya lo importaban, pero nunca se había creado, así que el Copiloto no
 * podía ni compilar. Sigue el mismo patrón que useSidebar.ts / useCart.ts:
 * expone el snapshot de copilotStore como estado de React reactivo.
 *
 * `messages` es el chat activo; `conversations` es el historial para la
 * barra lateral de /ia.
 */
export function useCopilot() {
  const snapshot = useSyncExternalStore(copilotStore.subscribe, copilotStore.getSnapshot);

  return {
    isOpen: snapshot.isOpen,
    isLoading: snapshot.isLoading,
    error: snapshot.error,
    messages: snapshot.messages,
    conversations: snapshot.conversations,
    activeConversationId: snapshot.activeConversationId,
    open: () => copilotStore.open(),
    close: () => copilotStore.close(),
    toggle: () => copilotStore.toggle(),
    startNewConversation: () => copilotStore.startNewConversation(),
    selectConversation: (id: string) => copilotStore.selectConversation(id),
    deleteConversation: (id: string) => copilotStore.deleteConversation(id)
  };
}