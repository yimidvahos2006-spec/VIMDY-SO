import { Subscription, SubscriptionStatus, SubscriptionPayment, SubscriptionAuditEntry, SubscriptionAuditDetails } from "../entities/SubscriptionTypes";

/* ===========================================================================
   SubscriptionEngine
   ---------------------------------------------------------------------------
   VIMDY — FASE 7.1. Motor puro de lógica de suscripciones.
   No habla con Supabase directamente: recibe datos y devuelve resultados.
   Las operaciones que tocan BD pasan por SubscriptionService.
   =========================================================================== */

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** Umbrales de aviso: 3 días, 2 días, 1 día. */
export const WARNING_THRESHOLDS = [3, 2, 1] as const;
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
   * Días restantes de trial, usando días calendario exactos en UTC.
   * Nunca negativo: si ya venció, devuelve 0.
   */
  daysRemaining(trialEndsAt: Date | null, now: Date = new Date()): number {
    if (!trialEndsAt) return 0;
    const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
    const end = Date.UTC(trialEndsAt.getUTCFullYear(), trialEndsAt.getUTCMonth(), trialEndsAt.getUTCDate());
    const diffDays = Math.round((end - today) / MS_PER_DAY);
    return Math.max(0, diffDays);
  }

  /**
   * ¿Toca mostrar un aviso hoy? Devuelve el umbral exacto (3, 2 o 1)
   * si los días restantes coinciden, o null si no.
   */
  warningThreshold(daysRemaining: number): WarningThreshold | null {
    if (daysRemaining > 3) return null;
    const match = WARNING_THRESHOLDS.find((threshold) => daysRemaining >= threshold);
    return match ?? null;
  }

  /**
   * Estado efectivo (los 5 círculos).
   * - trial -> expired cuando se vence el trial
   * - monthly/yearly -> suspended cuando el pago falla
   */
  effectiveStatus(sub: Subscription, now: Date = new Date()): SubscriptionStatus {
    if (sub.plan === "trial") {
      const remaining = this.daysRemaining(sub.trialEndsAt, now);
      return remaining > 0 ? "trial" : "expired";
    }

    if (sub.paymentStatus === "declined" || sub.paymentStatus === "past_due") {
      return "suspended";
    }

    return sub.plan;
  }

  /**
   * ¿Debe bloquearse el registro de nuevas operaciones (ventas)?
   * Cuando el estado efectivo es "expired" o "suspended".
   */
  isBlocked(sub: Subscription, now: Date = new Date()): boolean {
    const status = this.effectiveStatus(sub, now);
    return status === "expired" || status === "suspended";
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
