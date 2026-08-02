import { useEffect, useSyncExternalStore } from "react";

import { subscriptionStore } from "./subscriptionStore";
import { subscriptionEngine } from "../engines/SubscriptionEngine";
import { SubscriptionStatus } from "../entities/SubscriptionTypes";

const RECHECK_INTERVAL_MS = 60 * 60 * 1000; // 1 hora — suficiente para "cada día"

export interface UseSubscriptionResult {
  loading: boolean;
  plan: SubscriptionStatus | null;
  daysRemaining: number;
  countdownLabel: string;
  warningThreshold: 7 | 3 | 1 | null;
  isTrial: boolean;
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
      if (current) subscriptionStore.updateSubscription({ ...current });
    }, RECHECK_INTERVAL_MS);
    return () => clearInterval(interval);
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
      isSuspended: false,
      trialEndsAt: null,
      renewalDate: null,
      nextChargeAt: null,
      paymentMethod: null,
      payments: []
    };
  }

  const daysRemaining = subscriptionEngine.daysRemaining(subscription.trialEndsAt);
  const status = subscriptionEngine.effectiveStatus(subscription);

  return {
    loading,
    plan: status,
    daysRemaining,
    countdownLabel: subscriptionEngine.countdownLabel(daysRemaining),
    warningThreshold: status === "trial" ? subscriptionEngine.warningThreshold(daysRemaining) : null,
    isTrial: status === "trial",
    isSuspended: status === "suspended",
    trialEndsAt: subscription.trialEndsAt,
    renewalDate: subscription.renewalDate,
    nextChargeAt: subscription.nextChargeAt,
    paymentMethod: subscription.paymentMethod,
    payments
  };
}