import { ArrowDown, ShieldCheck } from "lucide-react";
import { Pricing as PricingComponent } from "../components/Pricing";

export function PricingPage() {
  return (
    <div className="min-h-screen bg-transparent text-white">
      <section
        aria-labelledby="pricing-page-title"
        className="relative overflow-hidden pt-32 pb-16 sm:pt-36 sm:pb-20 lg:pt-40 lg:pb-24"
      >
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0"
        >
          <div className="absolute left-1/2 top-0 h-[34rem] w-[44rem] -translate-x-1/2 rounded-full bg-cyan-300/[0.045] blur-[130px]" />
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_0%,rgba(56,189,248,0.045),transparent_40%)]" />
          <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-cyan-300/15 to-transparent" />
        </div>

        <div className="relative mx-auto max-w-[1440px] px-5 sm:px-8 lg:px-10">
          <div className="mx-auto max-w-3xl text-center">
            <div className="inline-flex items-center rounded-full border border-white/[0.07] bg-white/[0.025] px-3.5 py-2 text-[10px] font-semibold uppercase tracking-[0.24em] text-zinc-500">
              Planes VIMDY
            </div>

            <h1
              id="pricing-page-title"
              className="mt-7 text-balance text-5xl font-semibold tracking-[-0.045em] text-white sm:text-6xl lg:text-7xl"
            >
              Precios claros para
              <span className="block bg-gradient-to-r from-white via-zinc-200 to-cyan-200 bg-clip-text text-transparent">
                empezar con VIMDY.
              </span>
            </h1>

            <p className="mx-auto mt-6 max-w-2xl text-base leading-7 text-zinc-400 sm:text-lg">
              Consulta los planes publicados actualmente y elige la modalidad
              que mejor se adapte a tu forma de comenzar.
            </p>

            <a
              href="#precios"
              className="group mt-8 inline-flex items-center gap-2 rounded-full border border-white/[0.08] bg-white/[0.025] px-4 py-2.5 text-xs font-semibold text-zinc-300 transition-[border-color,background-color,color,transform] duration-300 hover:-translate-y-px hover:border-cyan-300/20 hover:bg-white/[0.05] hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/45"
            >
              Ver planes
              <ArrowDown
                size={14}
                aria-hidden="true"
                className="transition-transform duration-300 group-hover:translate-y-0.5"
              />
            </a>
          </div>
        </div>
      </section>

      <PricingComponent />

      <section
        aria-label="Información de precios"
        className="relative border-t border-white/[0.06] bg-[#06080b] py-10 sm:py-12"
      >
        <div className="mx-auto flex max-w-5xl items-start gap-3 px-5 sm:px-8">
          <ShieldCheck
            size={17}
            className="mt-0.5 shrink-0 text-cyan-200/60"
            aria-hidden="true"
          />
          <p className="text-xs leading-5 text-zinc-600">
            Verifica que los precios y condiciones comerciales publicados en
            esta página coincidan con la información oficial vigente de VIMDY
            antes de utilizarlos en material publicitario.
          </p>
        </div>
      </section>
    </div>
  );
}
