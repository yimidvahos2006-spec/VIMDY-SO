import { useSyncExternalStore } from "react";
import { mobileSidebarStore } from "./mobileSidebarStore";

export function useMobileSidebar() {
  const open = useSyncExternalStore(mobileSidebarStore.subscribe, mobileSidebarStore.getSnapshot);

  return {
    open,
    toggle: () => mobileSidebarStore.toggle(),
    close: () => mobileSidebarStore.close(),
    show: () => mobileSidebarStore.open()
  };
}