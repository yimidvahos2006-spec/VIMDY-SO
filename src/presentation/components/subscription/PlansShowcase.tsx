import React, { useState } from "react";
import { Check, Loader2, ShieldCheck, Sparkles } from "lucide-react";

import {
  DEFAULT_BUSINESS_TIER,
  SUBSCRIPTION_PLANS_BY_TIER,
  PlanDefinition,
  getPlanPrice,
  getPlanCurrency,
  type BusinessTier
} from "../../../core/entities/SubscriptionTypes";
import { formatMoney } from "../../../core/utils/formatMoney";
import { companyConfigStore } from "../../../core/store/companyConfigStore";

interface PlansShowcaseProps {
  onSelectPlan: (plan: PlanDefinition) => Promise<void> | void;
  currentPlan?: string | null;
  countryCode?: string;
  /** Nivel de negocio cuyos planes se muestran. Por defecto, negocio de 1 sede. */
  tier?: BusinessTier;
}

export function PlansShowcase({
  onSelectPlan,
  currentPlan,
  countryCode,
  tier = DEFAULT_BUSINESS_TIER
}: PlansShowcaseProps) {
  const effectiveCountry = countryCode ?? companyConfigStore.get().country ?? "CO";
  const [loadingPlan, setLoadingPlan] = useState<string | null>(null);
  const plans = SUBSCRIPTION_PLANS_BY_TIER[tier];

  async function handleSelect(plan: PlanDefinition) {
    setLoadingPlan(`${plan.tier}:${plan.id}`);
    try {
      await onSelectPlan(plan);
    } finally {
      setLoadingPlan(null);
    }
  }

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
      {plans.map((plan) => {
        const planKey = `${plan.tier}:${plan.id}`;
        const isCurrent = currentPlan === plan.id;
        const isYearly = plan.id === "yearly";
        const displayPrice = getPlanPrice(plan.id, effectiveCountry, plan.tier);
        const displayCurrency = getPlanCurrency(plan.id, effectiveCountry);

        return (
          <div
            key={planKey}
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
              {formatMoney(displayPrice, displayCurrency)}
              <span className="text-vimdy-text-secondary text-sm font-normal"> {displayCurrency}</span>
              <span className="text-vimdy-text-secondary text-sm font-normal">
                {isYearly ? " / año" : " / mes"}
              </span>
            </p>

            {plan.savingsLabel && (
              <p className="mt-2 inline-flex w-fit items-center gap-1.5 rounded-full bg-vimdy-success/10 px-2.5 py-1 text-xs font-semibold text-vimdy-success">
                <Sparkles size={13} aria-hidden="true" />
                {plan.savingsLabel}
              </p>
            )}

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
              {loadingPlan === planKey ? (
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