import { useState } from "react";
import { ArrowRight, Building2, Check, ShieldCheck, Store } from "lucide-react";
import {
  BUSINESS_TIERS,
  MARKETING_PLAN_TEXT,
  TIER_DEFINITIONS,
  marketingFeatures,
  priceLabel,
  type BusinessTier,
} from "../pricingCopy";

const PERIODS = ["monthly", "yearly"] as const;

const TIER_ICONS: Record<BusinessTier, typeof Store> = {
  single: Store,
  multi: Building2,
};

const included = [
  "14 días de prueba gratis, sin tarjeta de crédito",
  "Devolución de tu dinero dentro de los primeros 7 días",
  "Sin contratos largos ni permanencia",
  "Tú decides cuándo renovar: no hay cobros automáticos",
];

interface PricingProps {
  /** Nivel que se muestra al cargar. Por defecto, negocio de 1 sede. */
  initialTier?: BusinessTier;
}

export function Pricing({ initialTier = "single" }: PricingProps) {
  const [tier, setTier] = useState<BusinessTier>(initialTier);
  const plans = PERIODS.map((period) => ({
    id: period,
    name: MARKETING_PLAN_TEXT[period].name,
    price: priceLabel(tier, period),
    period: period === "yearly" ? "/ año" : "/ mes",
    cta: "Probar 14 días gratis",
    highlighted: period === "yearly",
    description: MARKETING_PLAN_TEXT[period].description,
  }));
  const features = marketingFeatures(tier);

  return (
    <section
      id="precios"
      aria-labelledby="pricing-title"
      className="relative overflow-hidden bg-transparent py-24 sm:py-28 lg:py-36"
    >
      <div aria-hidden="true" className="pointer-events-none absolute inset-0">
        <div className="absolute left-1/2 top-0 h-96 w-[42rem] -translate-x-1/2 rounded-full bg-cyan-300/[0.045] blur-[130px]" />
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_0%,rgba(56,189,248,0.04),transparent_42%)]" />
      </div>

      <div className="relative mx-auto max-w-[1440px] px-5 sm:px-8 lg:px-10">
        <div className="mx-auto max-w-3xl text-center">
          <div className="inline-flex items-center rounded-full border border-white/[0.07] bg-white/[0.025] px-3.5 py-2 text-[10px] font-semibold uppercase tracking-[0.24em] text-zinc-500">
            Precios claros
          </div>

          <h2
            id="pricing-title"
            className="mt-7 text-balance text-4xl font-semibold tracking-[-0.04em] text-white sm:text-5xl lg:text-6xl"
          >
            Elige el plan de tu negocio.
            <span className="block bg-gradient-to-r from-white via-zinc-200 to-cyan-200 bg-clip-text text-transparent">
              Una sede o muchas.
            </span>
          </h2>

          <p className="mx-auto mt-6 max-w-2xl text-base leading-7 text-zinc-400 sm:text-lg">
            Prueba VIMDY 14 días gratis, sin tarjeta. Si decides pagar y no te
            convence, te devolvemos tu dinero dentro de los primeros 7 días.
          </p>
        </div>

        <div className="mx-auto mt-12 max-w-2xl lg:mt-16">
          <div
            role="radiogroup"
            aria-label="Tipo de negocio"
            className="grid gap-2 rounded-[22px] border border-white/[0.07] bg-white/[0.02] p-1.5 sm:grid-cols-2"
          >
            {BUSINESS_TIERS.map((option) => {
              const Icon = TIER_ICONS[option];
              const selected = option === tier;
              return (
                <button
                  key={option}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  onClick={() => setTier(option)}
                  className={[
                    "flex items-center gap-3 rounded-2xl px-4 py-3 text-left transition-[background-color,color] duration-300",
                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/50",
                    selected
                      ? "bg-white text-black"
                      : "text-zinc-400 hover:bg-white/[0.04] hover:text-white",
                  ].join(" ")}
                >
                  <Icon size={18} aria-hidden="true" />
                  <span>
                    <span className="block text-sm font-semibold leading-tight">
                      {TIER_DEFINITIONS[option].label}
                    </span>
                    <span
                      className={[
                        "block text-xs",
                        selected ? "text-black/60" : "text-zinc-600",
                      ].join(" ")}
                    >
                      {TIER_DEFINITIONS[option].sublabel}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
          <p className="mt-4 text-center text-sm leading-6 text-zinc-400">
            {TIER_DEFINITIONS[tier].tagline}
          </p>
        </div>

        <div className="mx-auto mt-10 grid max-w-5xl gap-4 lg:grid-cols-[1fr_1.08fr]">
          {plans.map((plan) => (
            <article
              key={`${tier}-${plan.id}`}
              className={[
                "relative overflow-hidden rounded-[30px] border p-7 sm:p-8 lg:p-9",
                "transition-[transform,border-color,background-color,box-shadow] duration-500 hover:-translate-y-1",
                plan.highlighted
                  ? "border-cyan-300/20 bg-white/[0.035] shadow-[0_30px_100px_rgba(56,189,248,0.07)]"
                  : "border-white/[0.07] bg-white/[0.018] hover:border-white/[0.12]",
              ].join(" ")}
            >
              {plan.highlighted && (
                <>
                  <div
                    aria-hidden="true"
                    className="absolute -right-16 -top-16 h-44 w-44 rounded-full bg-cyan-300/[0.09] blur-3xl"
                  />

                  <div className="absolute right-6 top-6 rounded-full border border-cyan-200/10 bg-cyan-200/[0.05] px-3 py-1 text-[9px] font-semibold uppercase tracking-[0.18em] text-cyan-200/80">
                    Destacado por ahorro
                  </div>
                </>
              )}

              <div className="relative">
                <span className="text-[10px] font-semibold uppercase tracking-[0.22em] text-zinc-600">
                  {plan.name}
                </span>

                <div className="mt-6 flex items-end gap-2">
                  <span className="text-4xl font-semibold tracking-[-0.04em] text-white sm:text-5xl">
                    {plan.price}
                  </span>
                  <span className="mb-1 text-sm text-zinc-500">
                    {plan.period}
                  </span>
                </div>

                <p className="mt-4 max-w-sm text-sm leading-6 text-zinc-500">
                  {plan.description}
                </p>

                <ul className="mt-6 space-y-2.5">
                  {features.map((feature) => (
                    <li
                      key={feature}
                      className="flex items-start gap-2.5 text-sm text-zinc-400"
                    >
                      <Check
                        size={15}
                        aria-hidden="true"
                        className="mt-0.5 shrink-0 text-cyan-200/80"
                      />
                      {feature}
                    </li>
                  ))}
                </ul>

                {plan.highlighted && (
                  <div className="mt-5 inline-flex items-center rounded-full border border-cyan-300/10 bg-cyan-300/[0.05] px-3 py-1.5 text-xs font-medium text-cyan-200/85">
                    Cobro anual estable
                  </div>
                )}

                <a
                  href="/registro"
                  aria-label={`Probar 14 días gratis con el plan ${plan.name.toLowerCase()} ${TIER_DEFINITIONS[tier].label}`}
                  className={[
                    "group mt-8 inline-flex w-full items-center justify-center gap-2 rounded-2xl px-5 py-3.5 text-sm font-semibold",
                    "transition-[transform,background-color,border-color,color] duration-300",
                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/50 focus-visible:ring-offset-4 focus-visible:ring-offset-[#05070a]",
                    plan.highlighted
                      ? "bg-white text-black hover:-translate-y-0.5 hover:bg-zinc-100"
                      : "border border-white/[0.09] bg-white/[0.035] text-white hover:border-white/[0.16] hover:bg-white/[0.06]",
                  ].join(" ")}
                >
                  {plan.cta}
                  <ArrowRight
                    size={16}
                    aria-hidden="true"
                    className="transition-transform duration-300 group-hover:translate-x-0.5"
                  />
                </a>
              </div>
            </article>
          ))}
        </div>

        <div className="mx-auto mt-8 max-w-5xl overflow-hidden rounded-[28px] border border-white/[0.06] bg-white/[0.015]">
          <div className="grid divide-y divide-white/[0.06] sm:grid-cols-2 sm:divide-x sm:divide-y-0">
            {included.map((item) => (
              <div
                key={item}
                className="flex items-center gap-3 px-6 py-4 sm:px-7"
              >
                <span
                  aria-hidden="true"
                  className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-white/[0.08] bg-white/[0.03] text-cyan-200/80"
                >
                  <Check size={13} />
                </span>
                <span className="text-sm text-zinc-400">{item}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="mx-auto mt-8 flex max-w-5xl items-start gap-3 rounded-[22px] border border-white/[0.06] bg-white/[0.012] px-5 py-4 sm:px-6">
          <ShieldCheck
            size={17}
            className="mt-0.5 shrink-0 text-cyan-200/65"
            aria-hidden="true"
          />
          <p className="text-xs leading-5 text-zinc-500">
            Precios en pesos colombianos (COP). Los pagos se procesan con Wompi.
            Conoce las condiciones de renovación y devolución en los{" "}
            <a
              href="/terminos"
              className="text-zinc-300 underline underline-offset-2 hover:text-white"
            >
              Términos y condiciones
            </a>
            .
          </p>
        </div>
      </div>
    </section>
  );
}