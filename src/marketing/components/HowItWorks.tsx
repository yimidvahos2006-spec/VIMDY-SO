import {
  ArrowRight,
  CircleCheck,
  Rocket,
  Settings2,
  ShoppingBag,
  ShieldCheck,
} from "lucide-react";

const steps = [
  {
    number: "01",
    eyebrow: "Primer paso",
    title: "Crea tu cuenta",
    description:
      "Regístrate y crea la base de tu negocio para comenzar a configurar la operación.",
    icon: Rocket,
  },
  {
    number: "02",
    eyebrow: "Segundo paso",
    title: "Configura tu operación",
    description:
      "Organiza productos y ajusta los elementos necesarios para que VIMDY se adapte a tu forma de trabajar.",
    icon: Settings2,
  },
  {
    number: "03",
    eyebrow: "Tercer paso",
    title: "Empieza a operar",
    description:
      "Comienza a registrar ventas y a trabajar con la información conectada de tu negocio.",
    icon: ShoppingBag,
  },
] as const;

const principles = [
  "Configuración guiada y progresiva",
  "Una misma experiencia de operación",
  "Información conectada entre áreas",
] as const;

export function HowItWorks() {
  return (
    <section
      id="experiencia"
      aria-labelledby="how-it-works-title"
      className="relative overflow-hidden bg-transparent py-24 sm:py-28 lg:py-36"
    >
      <div aria-hidden="true" className="pointer-events-none absolute inset-0">
        <div className="absolute left-1/2 top-0 h-80 w-[42rem] -translate-x-1/2 rounded-full bg-cyan-300/[0.035] blur-[120px]" />
        <div className="absolute bottom-0 right-[-10%] h-96 w-96 rounded-full bg-blue-500/[0.02] blur-[120px]" />
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_10%,rgba(56,189,248,0.045),transparent_34%)]" />
      </div>

      <div className="relative mx-auto max-w-[1440px] px-5 sm:px-8 lg:px-10">
        <div className="mx-auto max-w-3xl text-center">
          <div className="inline-flex items-center gap-2 rounded-full border border-white/[0.07] bg-white/[0.025] px-3.5 py-2 text-[10px] font-semibold uppercase tracking-[0.24em] text-zinc-500">
            Cómo empezar
          </div>

          <h2
            id="how-it-works-title"
            className="mt-7 text-balance text-4xl font-semibold tracking-[-0.04em] text-white sm:text-5xl lg:text-6xl"
          >
            De la configuración
            <span className="block bg-gradient-to-r from-white via-zinc-200 to-cyan-200 bg-clip-text text-transparent">
              a una operación clara.
            </span>
          </h2>

          <p className="mx-auto mt-6 max-w-2xl text-base leading-7 text-zinc-400 sm:text-lg">
            VIMDY está pensado para que puedas comenzar paso a paso y después
            crecer dentro de la misma plataforma.
          </p>
        </div>

        <div className="relative mx-auto mt-14 max-w-6xl lg:mt-20">
          <div
            aria-hidden="true"
            className="absolute left-[16.666%] right-[16.666%] top-[4.4rem] hidden h-px bg-gradient-to-r from-transparent via-white/10 to-transparent md:block"
          />

          <div className="grid gap-4 md:grid-cols-3">
            {steps.map((step, index) => {
              const Icon = step.icon;

              return (
                <article
                  key={step.number}
                  className="group relative rounded-[28px] border border-white/[0.07] bg-white/[0.018] p-6 transition-[transform,border-color,background-color,box-shadow] duration-500 hover:-translate-y-1 hover:border-cyan-300/20 hover:bg-white/[0.03] hover:shadow-[0_24px_70px_rgba(0,0,0,0.28)] sm:p-7"
                >
                  <div className="relative flex items-start justify-between gap-5">
                    <div className="relative">
                      <div
                        aria-hidden="true"
                        className="absolute -inset-2 rounded-2xl bg-cyan-300/[0.04] blur-xl transition-colors duration-500 group-hover:bg-cyan-300/[0.09]"
                      />

                      <div className="relative flex h-14 w-14 items-center justify-center rounded-2xl border border-white/[0.08] bg-white/[0.035] text-zinc-300 transition-[border-color,color,transform] duration-500 group-hover:-translate-y-px group-hover:border-cyan-300/20 group-hover:text-cyan-200">
                        <Icon size={22} strokeWidth={1.7} aria-hidden="true" />
                      </div>
                    </div>

                    <span
                      aria-hidden="true"
                      className="text-5xl font-semibold tracking-[-0.06em] text-white/[0.045]"
                    >
                      {step.number}
                    </span>
                  </div>

                  <div className="mt-8">
                    <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-cyan-300/60">
                      {step.eyebrow}
                    </p>

                    <h3 className="mt-2 text-xl font-semibold tracking-[-0.02em] text-white">
                      {step.title}
                    </h3>

                    <p className="mt-3 text-sm leading-6 text-zinc-500">
                      {step.description}
                    </p>
                  </div>

                  <div className="mt-7 flex items-center gap-2 text-xs font-medium text-zinc-500">
                    <CircleCheck
                      size={14}
                      className="text-cyan-300/55"
                      aria-hidden="true"
                    />
                    <span>Parte del flujo inicial de VIMDY</span>
                  </div>

                  {index < steps.length - 1 && (
                    <div
                      aria-hidden="true"
                      className="absolute -bottom-5 left-1/2 z-10 flex h-10 w-10 -translate-x-1/2 items-center justify-center rounded-full border border-white/[0.07] bg-[#080b0f] text-zinc-600 md:-right-5 md:bottom-auto md:left-auto md:top-1/2 md:-translate-y-1/2 md:translate-x-1/2"
                    >
                      <ArrowRight size={15} />
                    </div>
                  )}
                </article>
              );
            })}
          </div>
        </div>

        <div className="mx-auto mt-8 grid max-w-6xl gap-3 md:grid-cols-3">
          {principles.map((principle) => (
            <div
              key={principle}
              className="flex items-start gap-3 rounded-2xl border border-white/[0.06] bg-white/[0.015] px-5 py-4"
            >
              <CircleCheck
                size={16}
                className="mt-0.5 shrink-0 text-cyan-300/60"
                aria-hidden="true"
              />
              <span className="text-sm leading-6 text-zinc-400">
                {principle}
              </span>
            </div>
          ))}
        </div>

        <div className="mx-auto mt-10 max-w-6xl">
          <div className="rounded-[28px] border border-cyan-300/[0.10] bg-cyan-300/[0.025] px-6 py-6 sm:px-8 sm:py-7">
            <div className="flex flex-col gap-5 md:flex-row md:items-center md:justify-between">
              <div className="flex items-start gap-4">
                <div className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-cyan-300/[0.12] bg-cyan-300/[0.04] text-cyan-200/80">
                  <ShieldCheck size={19} strokeWidth={1.7} aria-hidden="true" />
                </div>

                <div>
                  <p className="text-sm font-semibold text-zinc-200">
                    Empieza con una base clara.
                  </p>
                  <p className="mt-1 max-w-2xl text-sm leading-6 text-zinc-500">
                    A medida que tu operación crece, puedes incorporar las áreas
                    de VIMDY que necesites sin separar la información en varios
                    sistemas.
                  </p>
                </div>
              </div>

              <a
                href="/registro"
                className="group inline-flex shrink-0 items-center justify-center gap-2 rounded-full border border-white/10 bg-white/[0.07] px-5 py-3 text-sm font-semibold text-white transition-[border-color,background-color] duration-300 hover:border-cyan-300/25 hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/50 focus-visible:ring-offset-4 focus-visible:ring-offset-[#05070a]"
              >
                Empezar con VIMDY
                <ArrowRight
                  size={16}
                  className="transition-transform duration-300 group-hover:translate-x-0.5"
                  aria-hidden="true"
                />
              </a>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
