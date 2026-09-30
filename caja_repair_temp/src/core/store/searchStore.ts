import { ObservableStore } from "./ObservableStore";

class SearchStore extends ObservableStore<string> {
  constructor() {
    super("");
  }

  get() {
    return this.snapshot;
  }

  set(text: string) {
    this.publish(text);
  }

  clear() {
    this.publish("");
  }
}

export const searchStore = new SearchStore();