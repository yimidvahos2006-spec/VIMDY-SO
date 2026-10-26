import { useSyncExternalStore } from "react";

import { confirmStore } from "../../../core/store/confirmStore";
import { ConfirmModal } from "./ConfirmModal";

/**
 * ConfirmHost
 * ---------------------------------------------------------------------------
 * Se monta UNA vez, en main.tsx, junto a <ToastContainer />. Dibuja el cuadro
 * de confirmación que se pide con `confirmDialog(...)` desde cualquier parte
 * de la app (componentes, engines, servicios).
 */
export function ConfirmHost() {
  const request = useSyncExternalStore(confirmStore.subscribe, confirmStore.getSnapshot);
  if (!request) return null;

  return (
    <ConfirmModal
      key={request.id}
      title={request.title}
      message={request.message}
      confirmLabel={request.confirmLabel}
      cancelLabel={request.cancelLabel}
      danger={request.danger}
      onConfirm={() => confirmStore.answer(true)}
      onCancel={() => confirmStore.answer(false)}
    />
  );
}