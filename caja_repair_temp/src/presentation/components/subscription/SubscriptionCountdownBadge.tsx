import React from "react";
import { Sparkles, Crown, Gem, AlertOctagon } from "lucide-react";

import { useSubscription } from "../../../core/store/useSubscription";

/**
 * SubscriptionCountdownBadge
 * ---------------------------------------------------------------------------
 * VIMDY — FASE 7, PASO 3: "Mostrar siempre los días restantes" en
 * Dashboard, Configuración y Perfil del negocio. Un único componente
 * reutilizable en los tres lugares — así nunca pueden mostrar textos
 * distintos entre sí.
 *
 * Se actualiza solo (useSubscription ya recalcula cada hora); no necesita
 * ningún timer propio.
 */
export function SubscriptionCountdownBadge({ compact = false }: { compact?: boolean }) {
  const { loading, plan, daysRemaining, countdownLabel } = useSubscription();

  if (loading || !plan) return null;

  const styles: Record<string, { icon: React.ReactNode; text: string; bg: string; border: string }> = {
    trial: {
      icon: <Sparkles size={compact ? 14 : 16} />,
      text: "text-vimdy-warning",
      bg: "bg-vimdy-warning-bg",
      border: "border-vimdy-warning/30"
    },
    monthly: {
      icon: <Crown size={compact ? 14 : 16} />,
      text: "text-vimdy-accent-hover",
      bg: "bg-vimdy-accent/10",
      border: "border-vimdy-accent/30"
    },
    yearly: {
      icon: <Gem size={compact ? 14 : 16} />,
      text: "text-vimdy-accent-hover",
      bg: "bg-vimdy-accent/10",
      border: "border-vimdy-accent/30"
    },
    suspended: {
      icon: <AlertOctagon size={compact ? 14 : 16} />,
      text: "text-vimdy-danger",
      bg: "bg-vimdy-danger-bg",
      border: "border-vimdy-danger/30"
    }
  };

  const style = styles[plan];

  const label =
    plan === "trial"
      ? countdownLabel
      : plan === "suspended"
      ? "Plan suspendido"
      : plan === "monthly"
      ? "Plan Mensual activo"
      : "Plan Anual activo";

  const eyebrow =
    plan === "trial" ? "PRUEBA GRATUITA" : plan === "suspended" ? "SUSCRIPCIÓN" : plan === "monthly" ? "PLAN MENSUAL" : "PLAN ANUAL";

  if (compact) {
    return (
      <span
        className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-semibold ${style.bg} ${style.border} ${style.text}`}
      >
        {style.icon}
        {plan === "trial" ? countdownLabel : label}
      </span>
    );
  }

  return (
    <div className={`rounded-xl border px-4 py-2.5 ${style.bg} ${style.border}`}>
      <p className={`text-xs font-bold tracking-wider ${style.text}`}>{eyebrow}</p>
      <p className="flex items-center gap-1.5 text-vimdy-text font-semibold text-sm mt-0.5">
        {style.icon}
        {label}
        {plan === "trial" && daysRemaining <= 7 && (
          <span className="text-vimdy-text-secondary font-normal">· actualiza cuando quieras</span>
        )}
      </p>
    </div>
  );
}