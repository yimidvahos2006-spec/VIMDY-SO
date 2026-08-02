import { Subscription, SubscriptionStatus } from "../entities/SubscriptionTypes";

/* ===========================================================================
   SubscriptionEngine
   ---------------------------------------------------------------------------
   VIMDY — FASE 7. Toda la lógica de negocio de la suscripción vive aquí,
   como un motor puro (sin React, sin Supabase) — igual que AuthEngine,
   ShiftEngine, etc. Esto es lo que se reutiliza tanto en el store
   (subscriptionStore) como en el gate de cobro (checkout.ts).

   PASO 2: al crear un negocio, el trial ya arranca en el servidor
   (register-business) con 30 días. Este motor solo LEE esa fecha y
   calcula todo lo demás — nunca decide cuándo empieza un trial.
=========================================================================== */

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** Umbrales de aviso de PASO 4, del más lejano al más cercano al vencimiento. */
export const WARNING_THRESHOLDS = [7, 3, 1] as const;
export type WarningThreshold = (typeof WARNING_THRESHOLDS)[number];

export class SubscriptionEngine {
  /**
   * Días restantes de trial, redondeados hacia arriba (si faltan 6h,
   * sigue contando como "1 día", no como "0" — más elegante para el
   * usuario que ver "0 días" mientras todavía puede usar la app).
   * Nunca negativo: si ya venció, devuelve 0.
   */
  daysRemaining(trialEndsAt: Date | null, now: Date = new Date()): number {
    if (!trialEndsAt) return 0;
    const diffMs = trialEndsAt.getTime() - now.getTime();
    if (diffMs <= 0) return 0;
    return Math.ceil(diffMs / MS_PER_DAY);
  }

  /**
   * PASO 4 — ¿toca mostrar un aviso hoy? Devuelve el umbral exacto (7, 3 o 1)
   * si los días restantes coinciden con uno de los avisos, o null si no.
   * Antes de que falten 7 días, o después de vencido, no hay aviso (el
   * vencido usa la pantalla de PASO 5, no un aviso).
   */
  warningThreshold(daysRemaining: number): WarningThreshold | null {
    if (daysRemaining <= 0) return null;
    const match = WARNING_THRESHOLDS.find((threshold) => daysRemaining <= threshold);
    return match ?? null;
  }

  /**
   * Estado efectivo (los 4 círculos de PASO 1). Un plan pagado con un
   * cobro fallido o vencido (past_due) se considera "suspended" — deja de
   * poder operar igual que un trial vencido, sin que eso borre su `plan`
   * real (que sigue siendo 'monthly'/'yearly' para cuando pague de nuevo).
   */
  effectiveStatus(sub: Subscription, now: Date = new Date()): SubscriptionStatus {
    if (sub.plan === "trial") {
      const remaining = this.daysRemaining(sub.trialEndsAt, now);
      return remaining > 0 ? "trial" : "suspended";
    }

    if (sub.paymentStatus === "declined" || sub.paymentStatus === "past_due") {
      return "suspended";
    }

    return sub.plan;
  }

  /**
   * PASO 5 y PASO 9 — ¿debe bloquearse el registro de NUEVAS operaciones
   * (ventas)? Solo cuando el estado efectivo es "suspended". Consultar
   * información, inventario, clientes, reportes, etc. nunca se bloquea
   * aquí — este motor solo decide sobre el punto de cobro (ver checkout.ts).
   */
  isBlocked(sub: Subscription, now: Date = new Date()): boolean {
    return this.effectiveStatus(sub, now) === "suspended";
  }

  /** Texto corto para el contador de PASO 3, ej. "Te quedan 27 días". */
  countdownLabel(daysRemaining: number): string {
    if (daysRemaining <= 0) return "Tu prueba ha finalizado";
    if (daysRemaining === 1) return "Te queda 1 día";
    return `Te quedan ${daysRemaining} días`;
  }
}

export const subscriptionEngine = new SubscriptionEngine();