import { ArrowRight, Sparkles } from "lucide-react";

const ctaHighlights = [
  "Una sola plataforma para la operación",
  "Procesos conectados en un mismo sistema",
  "Información centralizada para trabajar con más control",
] as const;

export function FinalCTA() {
  return (
    <section
      id="contacto"
      aria-labelledby="final-cta-title"
      className="relative isolate overflow-hidden bg-transparent py-28 sm:py-32 lg:py-40"
    >
      <div aria-hidden="true" className="pointer-events-none absolute inset-0">
        <div className="absolute left-1/2 top-1/2 h-[34rem] w-[34rem] -translate-x-1/2 -translate-y-1/2 rounded-full bg-cyan-300/[0.06] blur-[130px]" />
        <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-cyan-300/20 to-transparent" />
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_48%,rgba(56,189,248,0.055),transparent_42%)]" />
        <div className="absolute inset-0 opacity-[0.1] [background-image:linear-gradient(rgba(255,255,255,0.04)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.04)_1px,transparent_1px)] [background-size:72px_72px] [mask-image:radial-gradient(circle_at_center,black,transparent_72%)]" />
      </div>

      <div className="relative mx-auto max-w-[1440px] px-5 sm:px-8 lg:px-10">
        <div className="mx-auto max-w-4xl text-center">
          <div className="inline-flex items-center gap-2 rounded-full border border-cyan-300/10 bg-cyan-300/[0.05] px-3.5 py-2 text-[10px] font-semibold uppercase tracking-[0.25em] text-cyan-200/75">
            <Sparkles size={13} aria-hidden="true" />
            El siguiente paso
          </div>

          <h2
            id="final-cta-title"
            className="mt-8 text-balance text-5xl font-semibold leading-[0.98] tracking-[-0.055em] text-white sm:text-6xl lg:text-8xl"
          >
            Tu negocio merece
            <span className="block bg-gradient-to-r from-white via-zinc-200 to-cyan-200 bg-clip-text text-transparent">
              tener el control.
            </span>
          </h2>

          <p className="mx-auto mt-7 max-w-2xl text-base leading-7 text-zinc-400 sm:text-lg">
            Empieza con VIMDY y lleva la operación de tu negocio a un solo
            lugar, con procesos conectados y una experiencia pensada para el
            trabajo diario.
          </p>

          <div className="mx-auto mt-8 grid max-w-3xl gap-2 text-left sm:grid-cols-3">
            {ctaHighlights.map((highlight) => (
              <div
                key={highlight}
                className="flex items-start gap-2.5 rounded-2xl border border-white/[0.06] bg-white/[0.018] px-4 py-3.5"
              >
                <span
                  aria-hidden="true"
                  className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-cyan-300/15 bg-cyan-300/[0.05] text-cyan-200/80"
                >
                  <span className="h-1.5 w-1.5 rounded-full bg-cyan-200/80" />
                </span>
                <span className="text-xs leading-5 text-zinc-500">
                  {highlight}
                </span>
              </div>
            ))}
          </div>

          <a
            href="/registro"
            className="group mt-10 inline-flex items-center justify-center gap-3 rounded-full bg-white px-7 py-4 text-sm font-semibold text-black shadow-[0_20px_60px_rgba(255,255,255,0.08)] transition-[transform,background-color,box-shadow] duration-300 hover:-translate-y-1 hover:bg-zinc-100 hover:shadow-[0_24px_70px_rgba(255,255,255,0.12)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/60 focus-visible:ring-offset-4 focus-visible:ring-offset-[#05070a] sm:px-8 sm:py-4.5 sm:text-base"
          >
            Probar VIMDY
            <ArrowRight
              size={18}
              className="transition-transform duration-300 group-hover:translate-x-1"
              aria-hidden="true"
            />
          </a>

          <p className="mt-5 text-xs font-medium tracking-wide text-zinc-600">
            $59.900 COP / mes
          </p>
        </div>

        <div className="mx-auto mt-16 max-w-5xl border-t border-white/[0.06] pt-8 sm:mt-20 sm:pt-10">
          <p className="text-center text-[10px] font-semibold uppercase tracking-[0.28em] text-zinc-700">
            VIMDY · Tecnología para la operación de negocios de alimentos y bebidas
          </p>
        </div>
      </div>
    </section>
  );
}
