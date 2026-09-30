import { useSyncExternalStore } from "react";
import { copilotStore } from "./copilotStore";

/**
 * useCopilot
 * ---------------------------------------------------------------------------
 * Este archivo faltaba por completo — CopilotPanel.tsx y CopilotButton.tsx
 * ya lo importaban, pero nunca se había creado, así que el Copiloto no
 * podía ni compilar. Sigue el mismo patrón que useSidebar.ts / useCart.ts:
 * expone el snapshot de copilotStore como estado de React reactivo.
 */
export function useCopilot() {
  const snapshot = useSyncExternalStore(copilotStore.subscribe, copilotStore.getSnapshot);

  return {
    isOpen: snapshot.isOpen,
    isLoading: snapshot.isLoading,
    error: snapshot.error,
    messages: snapshot.messages,
    open: () => copilotStore.open(),
    close: () => copilotStore.close(),
    toggle: () => copilotStore.toggle()
  };
}