import { Subscription, SubscriptionStatus, SubscriptionPayment, SubscriptionAuditEntry, SubscriptionAuditDetails } from "../entities/SubscriptionTypes";

/* ===========================================================================
   SubscriptionEngine
   ---------------------------------------------------------------------------
   VIMDY — FASE 7.1. Motor puro de lógica de suscripciones.
   No habla con Supabase directamente: recibe datos y devuelve resultados.
   Las operaciones que tocan BD pasan por SubscriptionService.
   =========================================================================== */

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** Umbrales de aviso, del más lejano al más cercano al vencimiento. */
export const WARNING_THRESHOLDS = [7, 3, 1] as const;
export type WarningThreshold = (typeof WARNING_THRESHOLDS)[number];

export type SubscriptionAuditAction =
  | "TRIAL_STARTED"
  | "TRIAL_EXPIRED"
  | "SUBSCRIPTION_ACTIVATED"
  | "SUBSCRIPTION_RENEWED"
  | "SUBSCRIPTION_EXPIRED"
  | "SUBSCRIPTION_REFUNDED"
  | "SUBSCRIPTION_CANCELLED"
  | "PAYMENT_APPROVED"
  | "PAYMENT_DECLINED"
  | "PAYMENT_REFUNDED"
  | "PAYMENT_PENDING"
  | "PAYMENT_VOIDED";

export class SubscriptionEngine {
  /**
   * Días restantes de trial, redondeados hacia arriba.
   * Nunca negativo: si ya venció, devuelve 0.
   */
  daysRemaining(trialEndsAt: Date | null, now: Date = new Date()): number {
    if (!trialEndsAt) return 0;
    const diffMs = trialEndsAt.getTime() - now.getTime();
    if (diffMs <= 0) return 0;
    return Math.ceil(diffMs / MS_PER_DAY);
  }

  /**
   * ¿Toca mostrar un aviso hoy? Devuelve el umbral exacto (7, 3 o 1)
   * si los días restantes coinciden, o null si no.
   */
  warningThreshold(daysRemaining: number): WarningThreshold | null {
    if (daysRemaining > 7) return null;
    const match = WARNING_THRESHOLDS.find((threshold) => daysRemaining >= threshold);
    return match ?? null;
  }

  /**
   * Estado efectivo (los 4 círculos). Un plan pagado con cobro fallido
   * o vencido (past_due) se considera "suspended".
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
   * ¿Debe bloquearse el registro de nuevas operaciones (ventas)?
   * Solo cuando el estado efectivo es "suspended".
   */
  isBlocked(sub: Subscription, now: Date = new Date()): boolean {
    return this.effectiveStatus(sub, now) === "suspended";
  }

  /** Texto corto para el contador. */
  countdownLabel(daysRemaining: number): string {
    if (daysRemaining <= 0) return "Tu prueba ha finalizado";
    if (daysRemaining === 1) return "Te queda 1 día";
    return `Te quedan ${daysRemaining} días`;
  }

  /**
   * Días de acceso que otorga un plan.
   * mensual = 30 días
   * anual = 14 meses = 420 días (12 pagados + 2 gratis)
   */
  getPlanPeriodDays(plan: "monthly" | "yearly"): number {
    return plan === "yearly" ? 30 * 14 : 30;
  }

  /**
   * Verifica si un negocio puede iniciar trial.
   * Regla: solo un trial por negocio/suscripción.
   */
  canStartTrial(trialUsedAt: Date | null | string | undefined): boolean {
    if (!trialUsedAt) return true;
    const date = trialUsedAt instanceof Date ? trialUsedAt : new Date(trialUsedAt);
    return isNaN(date.getTime());
  }

  /**
   * Verifica si un pago ya fue usado para activar/renovar.
   * Esto previene doble activación/renovación.
   */
  isPaymentAlreadyProcessed(status: SubscriptionPayment["status"]): boolean {
    return status === "approved" || status === "declined";
  }

  /**
   * Verifica si un reembolso es total.
   */
  isTotalRefund(refundAmount: number, originalAmount: number): boolean {
    return refundAmount >= originalAmount;
  }

  /**
   * Calcula la fecha de renovación a partir de una fecha base y un plan.
   */
  calculateRenewalDate(baseDate: Date, plan: "monthly" | "yearly"): Date {
    const periodDays = this.getPlanPeriodDays(plan);
    const result = new Date(baseDate);
    result.setDate(result.getDate() + periodDays);
    return result;
  }

  /**
   * Crea una entrada de auditoría con la estructura estándar.
   */
  createAuditEntry(
    businessId: string,
    action: SubscriptionAuditAction,
    actorType: string,
    actorId: string | null,
    details: SubscriptionAuditDetails,
    now: Date = new Date()
  ): SubscriptionAuditEntry {
    return {
      id: crypto.randomUUID(),
      businessId,
      action,
      actorType,
      actorId,
      details: details as Record<string, unknown>,
      createdAt: now
    };
  }
}

export const subscriptionEngine = new SubscriptionEngine();
