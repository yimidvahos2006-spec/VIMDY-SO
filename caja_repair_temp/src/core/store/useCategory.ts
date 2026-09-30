import { useSyncExternalStore } from "react";
import { categoryStore } from "./categoryStore";

export function useCategory() {
  const selected = useSyncExternalStore(categoryStore.subscribe, categoryStore.getSnapshot);

  const select = (categoryId: string) => {
    categoryStore.set(categoryId);
  };

  return {
    selected,
    select
  };
}