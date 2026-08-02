import React, { useState } from "react";
import { Check, Loader2, ShieldCheck } from "lucide-react";

import { SUBSCRIPTION_PLANS, PlanDefinition } from "../../../core/entities/SubscriptionTypes";
import { formatMoney } from "../../../core/utils/formatMoney";

/**
 * PlansShowcase
 * ---------------------------------------------------------------------------
 * VIMDY — FASE 7, PASO 6: muestra Plan Mensual ($79.000 COP) y Plan Anual
 * ($790.000 COP, ahorra dos meses), cada uno con sus funciones incluidas,
 * soporte, actualizaciones y acceso completo.
 *
 * PASO 7 — Wompi: el botón de cada tarjeta ya está listo para conectarse
 * al checkout de Wompi (recibe onSelectPlan). Mientras Wompi esté en
 * revisión, onSelectPlan puede simplemente mostrar un aviso — el día que
 * se apruebe, solo hay que reemplazar esa función por la apertura real
 * del checkout, sin tocar nada de este componente.
 */
export function PlansShowcase({
  onSelectPlan,
  currentPlan
}: {
  onSelectPlan: (plan: PlanDefinition) => Promise<void> | void;
  currentPlan?: string | null;
}) {
  const [loadingPlan, setLoadingPlan] = useState<string | null>(null);

  async function handleSelect(plan: PlanDefinition) {
    setLoadingPlan(plan.id);
    try {
      await onSelectPlan(plan);
    } finally {
      setLoadingPlan(null);
    }
  }

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
      {SUBSCRIPTION_PLANS.map((plan) => {
        const isCurrent = currentPlan === plan.id;
        const isYearly = plan.id === "yearly";

        return (
          <div
            key={plan.id}
            className={`relative rounded-2xl border p-5 flex flex-col ${
              isYearly
                ? "border-vimdy-accent/40 bg-gradient-to-b from-vimdy-accent/10 to-vimdy-surface"
                : "border-vimdy-border bg-vimdy-surface"
            }`}
          >
            {plan.highlight && (
              <span className="absolute -top-3 left-5 rounded-full bg-vimdy-accent text-white text-xs font-bold px-3 py-1">
                {plan.highlight}
              </span>
            )}

            <h3 className="text-vimdy-text font-bold text-lg mt-1">{plan.name}</h3>
            <p className="text-vimdy-text-secondary text-xs">{plan.billingLabel}</p>

            <p className="text-vimdy-text text-3xl font-extrabold mt-3">
              {formatMoney(plan.price, plan.currency)}
              <span className="text-vimdy-text-secondary text-sm font-normal"> {plan.currency}</span>
            </p>

            <ul className="mt-4 space-y-2 flex-1">
              {plan.features.map((feature) => (
                <li key={feature} className="flex items-start gap-2 text-vimdy-text-secondary text-sm">
                  <Check size={15} className="text-vimdy-success mt-0.5 flex-shrink-0" />
                  {feature}
                </li>
              ))}
            </ul>

            <button
              onClick={() => handleSelect(plan)}
              disabled={isCurrent || loadingPlan !== null}
              className={`mt-5 w-full h-11 rounded-xl font-semibold text-sm flex items-center justify-center gap-2 transition ${
                isCurrent
                  ? "bg-vimdy-surface-active text-vimdy-text-tertiary cursor-default"
                  : isYearly
                  ? "bg-vimdy-accent hover:bg-vimdy-accent-hover text-white"
                  : "border border-vimdy-accent text-vimdy-accent hover:bg-vimdy-accent/10"
              } disabled:opacity-70`}
            >
              {loadingPlan === plan.id ? (
                <Loader2 size={16} className="animate-spin" />
              ) : isCurrent ? (
                <>
                  <ShieldCheck size={16} /> Plan actual
                </>
              ) : (
                "Elegir este plan"
              )}
            </button>
          </div>
        );
      })}
    </div>
  );
}