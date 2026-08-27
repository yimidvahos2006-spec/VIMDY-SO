import { logError } from "../infrastructure/logging/opsLogger";

export type EventType =
  | "sale"
  | "inventory"
  | "customer"
  | "kitchen"
  | "dashboard"
  | "payment"
  | "receipt"
  | "notification"
  | "audit"
  | "login"
  | "logout"
  | "sync"
  | "table"
  | "waiter"
  | "order"
  | "shift"
  | "user"
  | "session"
  | "access"
  | "ai"
  | "subscription";

export interface VimdyEvent {

  id: number;

  event: EventType;

  payload?: any;

  date: Date;

}

type Listener = (payload?: any) => void;

class VimdyCore {

  private listeners: Map<EventType, Set<Listener>> = new Map();

  private history: VimdyEvent[] = [];

  on(event: EventType, listener: Listener): () => void {

    if (!this.listeners.has(event)) {

      this.listeners.set(event, new Set());

    }

    this.listeners.get(event)!.add(listener);

    return () => this.off(event, listener);

  }

  off(event: EventType, listener: Listener) {

    this.listeners.get(event)?.delete(listener);

  }

  once(event: EventType, listener: Listener) {

    const wrapper: Listener = payload => {

      listener(payload);

      this.off(event, wrapper);

    };

    this.on(event, wrapper);

  }

  emit(event: EventType, payload?: any) {

    this.history.unshift({

      id: Date.now(),

      event,

      payload,

      date: new Date()

    });

    if (this.history.length > 1000) {

      this.history.pop();

    }

    const listeners = this.listeners.get(event);

    if (!listeners) return;

    listeners.forEach(listener => {

      try {

        listener(payload);

      } catch (error) {

        logError(error, { category: "unknown", context: { event } });

      }

    });

  }

  clearHistory() {

    this.history = [];

  }

  getHistory() {

    return [...this.history];

  }

  getLastEvent() {

    return this.history[0];

  }

  listenerCount(event: EventType) {

    return this.listeners.get(event)?.size ?? 0;

  }

  removeAllListeners(event?: EventType) {

    if (event) {

      this.listeners.delete(event);

      return;

    }

    this.listeners.clear();

  }

}

export const vimdyCore = new VimdyCore();