import { useState } from "react";
import {
  ArrowRight,
  Building2,
  Calculator,
  Check,
  ShieldCheck,
  Sparkles,
  Store,
} from "lucide-react";
import {
  BUSINESS_TIERS,
  EDITION_COPY,
  NET_PROFIT_FORMULA,
  TIER_DEFINITIONS,
  editionPriceLabel,
  marketingFeatures,
  priceLabel,
  type BusinessTier,
} from "../pricingCopy";

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
  const [period, setPeriod] = useState<"monthly" | "yearly">("monthly");

  const isYearly = period === "yearly";

  // Precios Operativo
  const operativoPrice = priceLabel(tier, period);
  const operativoPeriodLabel = isYearly ? "/ año" : "/ mes";

  // Precios Total (Contabilidad / Utilidad Neta Real)
  const totalprice = editionPriceLabel("total", tier, period);
  const totalPeriodLabel = isYearly ? "/ año" : "/ mes";

  const featuresOperativo = marketingFeatures(tier);
  const featuresTotal = EDITION_COPY.total.features;

  const totalSingleMonthly = editionPriceLabel("total", "single", "monthly");
  const totalMultiMonthly = editionPriceLabel("total", "multi", "monthly");

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

          <div className="mx-auto mt-8 max-w-2xl rounded-[22px] border border-cyan-300/20 bg-cyan-300/[0.045] px-5 py-4 text-left sm:px-6">
            <p className="text-sm font-semibold text-white">
              Lo único gratis son los 14 días de prueba.
            </p>
            <p className="mt-1 text-sm leading-6 text-zinc-400">
              Después no hay cobros automáticos ni sorpresas en tu tarjeta: tú
              pagas manualmente, solo cuando decides renovar.
            </p>
          </div>
        </div>

        {/* Controles superiores: Sede (1 sede / Multi) y Periodo (Mensual / Anual) */}
        <div className="mx-auto mt-12 max-w-3xl space-y-6 lg:mt-16">
          {/* Selector de Sede */}
          <div>
            <p className="mb-3 text-center text-[10px] font-semibold uppercase tracking-[0.24em] text-zinc-500">
              Estructura de tu negocio
            </p>
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
                        ? "bg-white text-black font-medium"
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
            <p className="mt-3 text-center text-sm leading-6 text-zinc-400">
              {TIER_DEFINITIONS[tier].tagline}
            </p>
          </div>

          {/* Selector de Periodo (Mensual / Anual con Contabilidad) */}
          <div>
            <p className="mb-3 text-center text-[10px] font-semibold uppercase tracking-[0.24em] text-zinc-500">
              Frecuencia de pago
            </p>
            <div
              role="radiogroup"
              aria-label="Frecuencia de pago"
              className="grid gap-2 rounded-[22px] border border-white/[0.07] bg-white/[0.02] p-1.5 sm:grid-cols-2"
            >
              <button
                type="button"
                role="radio"
                aria-checked={!isYearly}
                onClick={() => setPeriod("monthly")}
                className={[
                  "flex items-center justify-center gap-2 rounded-2xl px-4 py-3 text-sm font-semibold transition-[background-color,color] duration-300",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/50",
                  !isYearly
                    ? "bg-white text-black"
                    : "text-zinc-400 hover:bg-white/[0.04] hover:text-white",
                ].join(" ")}
              >
                Pago Mensual
              </button>
              <button
                type="button"
                role="radio"
                aria-checked={isYearly}
                onClick={() => setPeriod("yearly")}
                className={[
                  "flex items-center justify-center gap-2 rounded-2xl px-4 py-3 text-sm font-semibold transition-[background-color,color] duration-300",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/50",
                  isYearly
                    ? "bg-cyan-400 text-slate-950 font-bold"
                    : "text-zinc-400 hover:bg-white/[0.04] hover:text-white",
                ].join(" ")}
              >
                <span>Pago Anual</span>
                <span className={`text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-full ${isYearly ? "bg-slate-950 text-cyan-300" : "bg-cyan-300/10 text-cyan-300 border border-cyan-300/20"}`}>
                  Ahorras 2 meses
                </span>
              </button>
            </div>
          </div>
        </div>

        {/* Tarjetas de Planes Principales (Operativo vs VIMDY Total con Contabilidad) */}
        <div className="mx-auto mt-14 max-w-5xl">
          <p className="mb-6 text-center text-[10px] font-semibold uppercase tracking-[0.24em] text-zinc-500">
            Elige qué tan lejos quieres llegar con tu operación
          </p>

          <div className="grid gap-6 lg:grid-cols-[1fr_1.12fr]">
            {/* Plan Operativo */}
            <article className="relative overflow-hidden rounded-[30px] border border-white/[0.07] bg-white/[0.018] p-7 sm:p-8 flex flex-col justify-between transition-[transform,border-color,background-color,box-shadow] duration-500 hover:-translate-y-1 hover:border-white/[0.14]">
              <div>
                <span className="text-[10px] font-semibold uppercase tracking-[0.22em] text-zinc-500">
                  {EDITION_COPY.operativo.name}
                </span>
                <h3 className="mt-5 text-2xl font-semibold tracking-[-0.03em] text-white">
                  Opera sin fricción
                </h3>
                <p className="mt-3 text-sm leading-6 text-zinc-400">
                  {EDITION_COPY.operativo.tagline}
                </p>

                <div className="mt-6 flex items-end gap-2">
                  <span className="text-4xl font-semibold tracking-[-0.04em] text-white sm:text-5xl">
                    {operativoPrice}
                  </span>
                  <span className="mb-1 text-sm text-zinc-500">{operativoPeriodLabel}</span>
                </div>
                <p className="mt-2 text-xs text-zinc-500">
                  Precio para {TIER_DEFINITIONS[tier].label.toLowerCase()}.
                </p>

                <ul className="mt-8 space-y-3">
                  {featuresOperativo.map((feature) => (
                    <li
                      key={feature}
                      className="flex items-start gap-2.5 text-sm text-zinc-300"
                    >
                      <Check
                        size={15}
                        aria-hidden="true"
                        className="mt-0.5 shrink-0 text-cyan-300/80"
                      />
                      <span>{feature}</span>
                    </li>
                  ))}
                </ul>
              </div>

              <div className="mt-10">
                <a
                  href="/registro"
                  aria-label="Probar 14 días gratis el Plan Operativo"
                  className="group inline-flex w-full items-center justify-center gap-2 rounded-2xl border border-white/[0.09] bg-white/[0.035] px-5 py-3.5 text-sm font-semibold text-white transition-[transform,background-color,border-color] duration-300 hover:border-white/[0.16] hover:bg-white/[0.06] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/50 focus-visible:ring-offset-4 focus-visible:ring-offset-[#05070a]"
                >
                  Probar 14 días gratis
                  <ArrowRight
                    size={16}
                    aria-hidden="true"
                    className="transition-transform duration-300 group-hover:translate-x-0.5"
                  />
                </a>
              </div>
            </article>

            {/* VIMDY Total (Con Contabilidad Literaria / Utilidad Neta Real) */}
            <article className="relative overflow-hidden rounded-[30px] border border-cyan-300/30 bg-gradient-to-b from-slate-900/90 via-slate-900/60 to-slate-950 p-7 shadow-[0_30px_110px_rgba(56,189,248,0.12)] sm:p-8 flex flex-col justify-between backdrop-blur-xl">
              <div
                aria-hidden="true"
                className="absolute -right-16 -top-16 h-52 w-52 rounded-full bg-cyan-300/[0.12] blur-3xl"
              />
              <div className="absolute right-6 top-6 inline-flex items-center gap-1.5 rounded-full border border-cyan-300/30 bg-cyan-500/10 px-3 py-1 text-[10px] font-extrabold uppercase tracking-[0.18em] text-cyan-300 shadow-sm">
                <Sparkles size={12} aria-hidden="true" />
                Más completo · Contabilidad Pro
              </div>

              <div className="relative">
                <span className="text-[10px] font-bold uppercase tracking-[0.22em] text-cyan-300">
                  {EDITION_COPY.total.name}
                </span>
                <h3 className="mt-5 text-2xl font-bold tracking-[-0.03em] text-white">
                  Conoce tu{" "}
                  <span className="bg-gradient-to-r from-cyan-400 to-emerald-400 bg-clip-text text-transparent">
                    Utilidad Neta Real
                  </span>
                </h3>
                <p className="mt-3 text-sm leading-relaxed text-zinc-300">
                  {EDITION_COPY.total.tagline}
                </p>

                <div className="mt-6 flex items-end gap-2">
                  <span className="text-4xl font-black tracking-[-0.04em] text-white sm:text-5xl">
                    {totalprice}
                  </span>
                  <span className="mb-1 text-sm font-semibold text-cyan-300">{totalPeriodLabel}</span>
                </div>
                <p className="mt-2 text-xs text-zinc-400">
                  1 sede: {totalSingleMonthly} COP / mes · Multi-sucursal: {totalMultiMonthly} COP / mes
                </p>

                {/* Fórmula Contable Literaria */}
                <div
                  className="mt-6 flex flex-wrap items-center gap-x-2 gap-y-2 rounded-2xl border border-cyan-400/20 bg-cyan-950/40 px-4 py-3 text-xs font-semibold text-zinc-200"
                  aria-label="Utilidad Neta Real es igual a ventas menos costo de insumos menos gastos fijos"
                >
                  <Calculator
                    size={16}
                    aria-hidden="true"
                    className="shrink-0 text-cyan-300"
                  />
                  <span className="text-cyan-300 font-bold">Utilidad Neta Real</span>
                  <span aria-hidden="true" className="text-zinc-500">=</span>
                  {NET_PROFIT_FORMULA.map((term, index) => (
                    <span key={term} className="inline-flex items-center gap-2">
                      {index > 0 && (
                        <span aria-hidden="true" className="text-zinc-500">−</span>
                      )}
                      <span>{term}</span>
                    </span>
                  ))}
                </div>

                <p className="mt-6 text-[11px] font-bold uppercase tracking-[0.16em] text-cyan-400/90">
                  {EDITION_COPY.total.inherits}
                </p>
                <ul className="mt-3 space-y-3">
                  {featuresTotal.map((feature) => (
                    <li
                      key={feature}
                      className="flex items-start gap-2.5 text-sm text-zinc-200"
                    >
                      <Check
                        size={16}
                        aria-hidden="true"
                        className="mt-0.5 shrink-0 text-cyan-400 font-bold"
                      />
                      <span>{feature}</span>
                    </li>
                  ))}
                </ul>
              </div>

              <div className="mt-10 relative">
                <a
                  href="/registro"
                  aria-label="Probar 14 días gratis VIMDY Total"
                  className="group inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-cyan-400 to-emerald-400 px-5 py-4 text-sm font-black text-slate-950 transition-all duration-300 hover:scale-[1.02] shadow-xl shadow-cyan-400/20 uppercase tracking-wider"
                >
                  Probar 14 días gratis
                  <ArrowRight
                    size={16}
                    aria-hidden="true"
                    className="transition-transform duration-300 group-hover:translate-x-1"
                  />
                </a>

                <p className="mt-3 text-center text-xs text-zinc-400">
                  Precio para {TIER_DEFINITIONS[tier].label.toLowerCase()}, en pesos colombianos (COP).
                </p>
              </div>
            </article>
          </div>
        </div>

        {/* Garantías de confianza */}
        <div className="mx-auto mt-12 max-w-5xl overflow-hidden rounded-[28px] border border-white/[0.06] bg-white/[0.015]">
          <div className="grid divide-y divide-white/[0.06] sm:grid-cols-2 sm:divide-x sm:divide-y-0">
            {included.map((item) => (
              <div
                key={item}
                className="flex items-center gap-3 px-6 py-4 sm:px-7"
              >
                <span
                  aria-hidden="true"
                  className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-cyan-400/30 bg-cyan-500/10 text-cyan-300"
                >
                  <Check size={13} />
                </span>
                <span className="text-sm text-zinc-300 font-medium">{item}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Nota legal y Wompi */}
        <div className="mx-auto mt-8 flex max-w-5xl items-start gap-3 rounded-[22px] border border-white/[0.06] bg-white/[0.012] px-5 py-4 sm:px-6">
          <ShieldCheck
            size={17}
            className="mt-0.5 shrink-0 text-cyan-300"
            aria-hidden="true"
          />
          <p className="text-xs leading-5 text-zinc-400">
            Precios en pesos colombianos (COP). Los pagos se procesan de forma segura con Wompi.
            Conoce las condiciones de renovación y devolución en los{" "}
            <a
              href="/terminos"
              className="text-cyan-300 underline underline-offset-2 hover:text-white"
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