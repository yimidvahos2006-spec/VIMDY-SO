import { subscriptionStore } from "./subscriptionStore";
import { subscriptionEngine } from "../engines/SubscriptionEngine";
import { notificationStore } from "./notificationStore";

const TRIAL_WARNING_KEYS: Record<number, string> = {
  3: "SUBSCRIPTION_TRIAL_3_DAYS",
  2: "SUBSCRIPTION_TRIAL_2_DAYS",
  1: "SUBSCRIPTION_TRIAL_1_DAY"
};

export function evaluateSubscriptionNotifications(): void {
  const { subscription } = subscriptionStore.getSnapshot();
  if (!subscription) return;

  const now = new Date();
  const daysRemaining = subscriptionEngine.daysRemaining(
    subscription.plan === "trial" ? subscription.trialEndsAt : subscription.renewalDate,
    now
  );
  const status = subscriptionEngine.effectiveStatus(subscription, now);
  const businessId = subscription.businessId;

  if (status === "trial") {
    const threshold = subscriptionEngine.warningThreshold(daysRemaining);
    if (threshold && threshold in TRIAL_WARNING_KEYS) {
      const key = `${TRIAL_WARNING_KEYS[threshold]}:${businessId}`;
      const existing = notificationStore.getAll().find((n) => n.key === key);
      if (!existing) {
        let title = "";
        let message = "";
        if (threshold === 3) {
          title = "Tu prueba de VIMDY termina en 3 días";
          message = "Continúa utilizando VIMDY realizando tu suscripción antes de que finalice el período de prueba.";
        } else if (threshold === 2) {
          title = "Tu prueba de VIMDY termina en 2 días";
          message = "Continúa utilizando VIMDY realizando tu suscripción antes de que finalice el período de prueba.";
        } else if (threshold === 1) {
          title = "Tu prueba de VIMDY termina mañana";
          message = "Elige un plan para continuar utilizando VIMDY.";
        }

        notificationStore.addSubscriptionWarning(title, message, key);
      }
    }

    const expiredKey = `SUBSCRIPTION_EXPIRED:${businessId}`;
    const expiredNotification = notificationStore.getAll().find((n) => n.key === expiredKey);
    if (daysRemaining === 0 && !expiredNotification) {
      notificationStore.addSubscriptionExpired(
        "Tu prueba de VIMDY ha terminado",
        "Para continuar utilizando VIMDY, selecciona un plan.",
        expiredKey
      );
    }
  }

  if (status === "expired" || status === "suspended") {
    const expiredKey = `SUBSCRIPTION_EXPIRED:${businessId}`;
    const expiredNotification = notificationStore.getAll().find((n) => n.key === expiredKey);
    if (!expiredNotification) {
      notificationStore.addSubscriptionExpired(
        "Tu prueba de VIMDY ha terminado",
        "Para continuar utilizando VIMDY, selecciona un plan.",
        expiredKey
      );
    }
  }
}
