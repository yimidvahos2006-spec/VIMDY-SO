import { ObservableStore } from "./ObservableStore";

/**
 * Antes, PosCategories.tsx guardaba "selected" en un useState local que
 * nunca salía del componente: hacer clic en una categoría no filtraba nada
 * en PosProducts. Este store comparte esa selección entre ambos, igual que
 * searchStore comparte el texto de búsqueda.
 */
class CategoryStore extends ObservableStore<string> {
  constructor() {
    super("Todos");
  }

  get() {
    return this.snapshot;
  }

  set(categoryId: string) {
    this.publish(categoryId);
  }
}

export const categoryStore = new CategoryStore();