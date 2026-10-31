import type { SubscriptionStatus } from "../entities/SubscriptionTypes";

/**
 * subscriptionCardModel
 * ---------------------------------------------------------------------------
 * Lógica PURA de la tarjeta "Suscripción" de Configuración (y del contador
 * que la acompaña). Vive fuera del componente para que se pueda probar sin
 * pantalla y para que el contador y la tarjeta nunca muestren textos
 * distintos entre sí.
 *
 * Los 5 estados efectivos que calcula SubscriptionEngine (trial, monthly,
 * yearly, expired, suspended) tienen aquí SIEMPRE un texto y un color. Antes
 * "expired" no estaba en la lista y el contador fallaba al pintarse cuando
 * la prueba gratuita ya había terminado.
 */

export type SubscriptionTone = "warning" | "accent" | "danger";

export interface SubscriptionStatusPresentation {
  /** Texto del plan con su círculo de color, para la tarjeta. */
  readonly planLabel: string;
  /** Texto pequeño en mayúsculas sobre el contador grande. */
  readonly eyebrow: string;
  /**
   * Texto del contador compacto. `null` significa "usa la cuenta regresiva
   * del motor" (ej. "Te quedan 5 días"), que solo aplica a la prueba gratis.
   */
  readonly badgeLabel: string | null;
  readonly tone: SubscriptionTone;
}

export const SUBSCRIPTION_STATUS_PRESENTATION: Record<
  SubscriptionStatus,
  SubscriptionStatusPresentation
> = {
  trial: {
    planLabel: "🟢 Prueba Gratuita",
    eyebrow: "PRUEBA GRATUITA",
    badgeLabel: null,
    tone: "warning"
  },
  monthly: {
    planLabel: "🔵 Plan Mensual",
    eyebrow: "PLAN MENSUAL",
    badgeLabel: "Plan Mensual activo",
    tone: "accent"
  },
  yearly: {
    planLabel: "🟣 Plan Anual",
    eyebrow: "PLAN ANUAL",
    badgeLabel: "Plan Anual activo",
    tone: "accent"
  },
  expired: {
    planLabel: "🟠 Prueba finalizada",
    eyebrow: "PRUEBA FINALIZADA",
    badgeLabel: "Prueba finalizada",
    tone: "danger"
  },
  suspended: {
    planLabel: "🔴 Suspendido",
    eyebrow: "SUSCRIPCIÓN",
    badgeLabel: "Plan suspendido",
    tone: "danger"
  }
};

export interface SubscriptionCardInput {
  /** Estado efectivo (ya calculado por useSubscription). null = sin suscripción cargada. */
  readonly status: SubscriptionStatus | null;
  readonly daysRemaining: number;
  readonly trialEndsAt: Date | null;
  readonly renewalDate: Date | null;
  readonly nextChargeAt: Date | null;
}

export interface SubscriptionCardModel {
  readonly planLabel: string;
  readonly tone: SubscriptionTone | null;
  /** Título de la fecha: "Vence", "Venció" o "Próxima renovación". */
  readonly expirationLabel: string;
  readonly expirationDate: Date | null;
  /** "14 días", "1 día", "0 días", "Pago pendiente" o "—". */
  readonly daysLabel: string;
  /** Aviso para el dueño cuando el acceso está bloqueado. null si todo está bien. */
  readonly notice: string | null;
}

function isUsableDate(value: Date | null): value is Date {
  return value instanceof Date && !Number.isNaN(value.getTime());
}

function formatDaysLabel(daysRemaining: number, hasDate: boolean): string {
  if (!hasDate || !Number.isFinite(daysRemaining)) return "—";
  const days = Math.max(0, Math.trunc(daysRemaining));
  return days === 1 ? "1 día" : `${days} días`;
}

export function buildSubscriptionCardModel(input: SubscriptionCardInput): SubscriptionCardModel {
  const { status } = input;

  if (status === null) {
    return {
      planLabel: "—",
      tone: null,
      expirationLabel: "Vence",
      expirationDate: null,
      daysLabel: "—",
      notice: null
    };
  }

  const presentation = SUBSCRIPTION_STATUS_PRESENTATION[status];
  const paidDate = input.renewalDate ?? input.nextChargeAt;

  switch (status) {
    case "trial": {
      const date = isUsableDate(input.trialEndsAt) ? input.trialEndsAt : null;
      return {
        planLabel: presentation.planLabel,
        tone: presentation.tone,
        expirationLabel: "Vence",
        expirationDate: date,
        daysLabel: formatDaysLabel(input.daysRemaining, date !== null),
        notice: null
      };
    }

    case "monthly":
    case "yearly": {
      const date = isUsableDate(paidDate) ? paidDate : null;
      return {
        planLabel: presentation.planLabel,
        tone: presentation.tone,
        expirationLabel: "Próxima renovación",
        expirationDate: date,
        daysLabel: formatDaysLabel(input.daysRemaining, date !== null),
        notice: null
      };
    }

    case "expired": {
      const date = isUsableDate(input.trialEndsAt) ? input.trialEndsAt : null;
      return {
        planLabel: presentation.planLabel,
        tone: presentation.tone,
        expirationLabel: "Venció",
        expirationDate: date,
        daysLabel: "0 días",
        notice: "Tu prueba gratuita terminó. Activa un plan para seguir vendiendo."
      };
    }

    case "suspended": {
      const candidate = paidDate ?? input.trialEndsAt;
      const date = isUsableDate(candidate) ? candidate : null;
      return {
        planLabel: presentation.planLabel,
        tone: presentation.tone,
        expirationLabel: "Venció",
        expirationDate: date,
        daysLabel: "Pago pendiente",
        notice: "No se pudo cobrar tu último pago. Actualiza tu plan para reactivar el acceso."
      };
    }
  }
}

/**
 * Fecha larga ("13 de noviembre de 2026") en la zona horaria del negocio.
 * Si la zona horaria es inválida cae a la del dispositivo en vez de romper
 * la pantalla.
 */
export function formatSubscriptionDate(
  date: Date | null,
  timeZone?: string,
  locale: string = "es-CO"
): string {
  if (!isUsableDate(date)) return "—";
  const options: Intl.DateTimeFormatOptions = { day: "numeric", month: "long", year: "numeric" };
  try {
    return new Intl.DateTimeFormat(locale, { ...options, timeZone }).format(date);
  } catch {
    return new Intl.DateTimeFormat(locale, options).format(date);
  }
}