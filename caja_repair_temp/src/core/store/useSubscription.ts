import { useEffect, useSyncExternalStore } from "react";

import { subscriptionStore } from "./subscriptionStore";
import { subscriptionEngine } from "../engines/SubscriptionEngine";
import { SubscriptionStatus } from "../entities/SubscriptionTypes";
import { evaluateSubscriptionNotifications } from "./subscriptionNotifications";
import { vimdyCore } from "../VimdyCore";
import { fetchSubscription } from "../../infrastructure/supabase/subscriptionContext";

const RECHECK_INTERVAL_MS = 60 * 60 * 1000; // 1 hora — suficiente para "cada día"

export interface UseSubscriptionResult {
  loading: boolean;
  plan: SubscriptionStatus | null;
  daysRemaining: number;
  countdownLabel: string;
  warningThreshold: 3 | 2 | 1 | null;
  isTrial: boolean;
  isExpired: boolean;
  isSuspended: boolean;
  trialEndsAt: Date | null;
  renewalDate: Date | null;
  nextChargeAt: Date | null;
  paymentMethod: string | null;
  payments: ReturnType<typeof subscriptionStore.getSnapshot>["payments"];
}

/**
 * useSubscription
 * ---------------------------------------------------------------------------
 * PASO 3: "actualizar automáticamente cada día" — el store solo cambia de
 * referencia cuando algo real cambia (login, pago confirmado), así que un
 * timer propio aquí es lo que recalcula daysRemaining/warningThreshold
 * cada hora sin recargar la página, para que el contador nunca se quede
 * mostrando un número viejo si el usuario deja la pestaña abierta toda
 * la noche.
 */
export function useSubscription(): UseSubscriptionResult {
  const snapshot = useSyncExternalStore(subscriptionStore.subscribe, subscriptionStore.getSnapshot);

  // Fuerza un recheck periódico republicando el mismo objeto de suscripción
  // (nueva referencia) — así useSyncExternalStore dispara un re-render y
  // los cálculos de abajo (daysRemaining, warningThreshold) se refrescan.
  useEffect(() => {
    const interval = setInterval(() => {
      const current = subscriptionStore.getSnapshot().subscription;
      if (current) {
        subscriptionStore.updateSubscription({ ...current });
        evaluateSubscriptionNotifications();
      }
    }, RECHECK_INTERVAL_MS);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    const unsubscribe = vimdyCore.on("subscription", async () => {
      const current = subscriptionStore.getSnapshot().subscription;
      if (current) {
        const refreshed = await fetchSubscription(current.businessId);
        if (refreshed) {
          subscriptionStore.hydrate(refreshed);
          evaluateSubscriptionNotifications();
        }
      }
    });
    return unsubscribe;
  }, []);

  const { subscription, payments, loading } = snapshot;

  if (!subscription) {
    return {
      loading,
      plan: null,
      daysRemaining: 0,
      countdownLabel: "",
      warningThreshold: null,
      isTrial: false,
      isExpired: false,
      isSuspended: false,
      trialEndsAt: null,
      renewalDate: null,
      nextChargeAt: null,
      paymentMethod: null,
      payments: []
    };
  }

  const now = new Date();
  const relevantDate = subscription.plan === "trial" ? subscription.trialEndsAt : subscription.renewalDate;
  const daysRemaining = subscriptionEngine.daysRemaining(relevantDate, now);
  const status = subscriptionEngine.effectiveStatus(subscription, now);

  return {
    loading,
    plan: status,
    daysRemaining,
    countdownLabel: subscriptionEngine.countdownLabel(daysRemaining),
    warningThreshold: status === "suspended" || status === "expired" ? null : subscriptionEngine.warningThreshold(daysRemaining),
    isTrial: status === "trial",
    isExpired: status === "expired",
    isSuspended: status === "suspended",
    trialEndsAt: subscription.trialEndsAt,
    renewalDate: subscription.renewalDate,
    nextChargeAt: subscription.nextChargeAt,
    paymentMethod: subscription.paymentMethod,
    payments
  };
}