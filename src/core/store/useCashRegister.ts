import { useSyncExternalStore } from "react";
import { cashRegisterStore } from "./cashRegisterStore";

export function useCashRegister() {
  return useSyncExternalStore(
    cashRegisterStore.subscribe,
    cashRegisterStore.getSnapshot,
    cashRegisterStore.getSnapshot
  );
}