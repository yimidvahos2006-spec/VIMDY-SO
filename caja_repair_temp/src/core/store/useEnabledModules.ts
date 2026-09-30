import { useSyncExternalStore } from "react";
import { enabledModulesStore } from "./enabledModulesStore";

export function useEnabledModules() {
  return useSyncExternalStore(enabledModulesStore.subscribe, enabledModulesStore.getSnapshot);
}