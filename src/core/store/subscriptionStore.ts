import { ObservableStore } from "./ObservableStore";
import { Subscription, SubscriptionPayment } from "../entities/SubscriptionTypes";

export interface SubscriptionSnapshot {
  subscription: Subscription | null;
  payments: SubscriptionPayment[];
  loading: boolean;
}

const EMPTY_SNAPSHOT: SubscriptionSnapshot = {
  subscription: null,
  payments: [],
  loading: true
};

/**
 * subscriptionStore
 * ---------------------------------------------------------------------------
 * VIMDY — FASE 7. Igual que businessStore/companyConfigStore, pero
 * observable (extiende ObservableStore) porque el contador de PASO 3 y el
 * banner de PASO 4 necesitan re-renderizarse solos cuando el día cambia,
 * sin depender de que el usuario navegue o recargue la página.
 *
 * Se hidrata desde Supabase (ver subscriptionContext.ts) al hacer login,
 * registrarse o restaurar sesión — mismo momento que hydrateBusinessConfig
 * en AuthContext.tsx.
 */
class SubscriptionStore extends ObservableStore<SubscriptionSnapshot> {
  constructor() {
    super(EMPTY_SNAPSHOT);
  }

  hydrate(subscription: Subscription, payments: SubscriptionPayment[] = []): void {
    this.publish({ subscription, payments, loading: false });
  }

  /** Actualiza solo el plan/estado (ej. justo después de que Wompi confirme un pago). */
  updateSubscription(patch: Partial<Subscription>): void {
    if (!this.snapshot.subscription) return;
    this.publish({
      ...this.snapshot,
      subscription: { ...this.snapshot.subscription, ...patch }
    });
  }

  setPayments(payments: SubscriptionPayment[]): void {
    this.publish({ ...this.snapshot, payments });
  }

  clear(): void {
    this.publish(EMPTY_SNAPSHOT);
  }
}

export const subscriptionStore = new SubscriptionStore();