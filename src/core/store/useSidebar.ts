import { useSyncExternalStore } from "react";
import { sidebarStore } from "./sidebarStore";

export function useSidebar() {
  const expanded = useSyncExternalStore(sidebarStore.subscribe, sidebarStore.getSnapshot);

  return {
    expanded,
    toggle: () => sidebarStore.toggle(),
    set: (value: boolean) => sidebarStore.set(value)
  };
}