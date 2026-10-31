import React from "react";
import { Sparkles, Crown, Gem, AlertOctagon, type LucideIcon } from "lucide-react";

import { useSubscription } from "../../../core/store/useSubscription";
import type { SubscriptionStatus } from "../../../core/entities/SubscriptionTypes";
import {
  SUBSCRIPTION_STATUS_PRESENTATION,
  type SubscriptionTone
} from "../../../core/settings/subscriptionCardModel";

const TONE_STYLES: Record<SubscriptionTone, { text: string; bg: string; border: string }> = {
  warning: {
    text: "text-vimdy-warning",
    bg: "bg-vimdy-warning-bg",
    border: "border-vimdy-warning/30"
  },
  accent: {
    text: "text-vimdy-accent-hover",
    bg: "bg-vimdy-accent/10",
    border: "border-vimdy-accent/30"
  },
  danger: {
    text: "text-vimdy-danger",
    bg: "bg-vimdy-danger-bg",
    border: "border-vimdy-danger/30"
  }
};

const STATUS_ICON: Record<SubscriptionStatus, LucideIcon> = {
  trial: Sparkles,
  monthly: Crown,
  yearly: Gem,
  expired: AlertOctagon,
  suspended: AlertOctagon
};

/**
 * SubscriptionCountdownBadge
 * ---------------------------------------------------------------------------
 * VIMDY — FASE 7, PASO 3: "Mostrar siempre los días restantes" en
 * Dashboard, Configuración y Perfil del negocio. Un único componente
 * reutilizable en los tres lugares — así nunca pueden mostrar textos
 * distintos entre sí.
 *
 * Los textos y colores salen de SUBSCRIPTION_STATUS_PRESENTATION, que cubre
 * los 5 estados (incluido "expired": antes faltaba y el contador fallaba al
 * pintarse cuando la prueba gratuita ya había terminado).
 *
 * Se actualiza solo (useSubscription ya recalcula cada hora); no necesita
 * ningún timer propio.
 */
export function SubscriptionCountdownBadge({ compact = false }: { compact?: boolean }) {
  const { loading, plan, daysRemaining, countdownLabel } = useSubscription();

  if (loading || !plan) return null;

  const presentation = SUBSCRIPTION_STATUS_PRESENTATION[plan];
  const style = TONE_STYLES[presentation.tone];
  const Icon = STATUS_ICON[plan];
  const iconSize = compact ? 14 : 16;
  const label = presentation.badgeLabel ?? countdownLabel;

  if (compact) {
    return (
      <span
        className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-semibold ${style.bg} ${style.border} ${style.text}`}
      >
        <Icon size={iconSize} />
        {label}
      </span>
    );
  }

  return (
    <div className={`rounded-xl border px-4 py-2.5 ${style.bg} ${style.border}`}>
      <p className={`text-xs font-bold tracking-wider ${style.text}`}>{presentation.eyebrow}</p>
      <p className="flex items-center gap-1.5 text-vimdy-text font-semibold text-sm mt-0.5">
        <Icon size={iconSize} />
        {label}
        {plan === "trial" && daysRemaining <= 7 && (
          <span className="text-vimdy-text-secondary font-normal">· actualiza cuando quieras</span>
        )}
      </p>
    </div>
  );
}