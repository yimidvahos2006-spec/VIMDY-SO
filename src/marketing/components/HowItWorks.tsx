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
    eyebrow: "Paso 1 · Sin tarjeta",
    title: "Crea tu cuenta en segundos",
    description:
      "Regístrate de forma inmediata y define los datos base de tu restaurante u operación de alimentos sin ataduras.",
    icon: Rocket,
    badge: "14 Días Gratis",
  },
  {
    number: "02",
    eyebrow: "Paso 2 · Personalizado",
    title: "Configura tu operación y QR",
    description:
      "Organiza tus productos, insumos por gramaje y registra tus cuentas (Nequi, Daviplata) para activar el Radar Antifraude.",
    icon: Settings2,
    badge: "Antifraude Activo",
  },
  {
    number: "03",
    eyebrow: "Paso 3 · En marcha",
    title: "Empieza a facturar sin fricción",
    description:
      "Comienza a registrar ventas en POS, conecta la cocina en tiempo real y controla cada peso ganado desde el primer turno.",
    icon: ShoppingBag,
    badge: "100% Conectado",
  },
] as const;

const principles = [
  "Configuración guiada y progresiva paso a paso",
  "Una misma experiencia unificada de operación",
  "Información conectada y enlazada entre áreas",
] as const;

export function HowItWorks() {
  return (
    <section
      id="experiencia"
      aria-labelledby="how-it-works-title"
      className="relative overflow-hidden bg-transparent py-24 sm:py-28 lg:py-36"
    >
      {/* Luz ambiental de fondo */}
      <div aria-hidden="true" className="pointer-events-none absolute inset-0">
        <div className="absolute left-1/2 top-0 h-80 w-[42rem] -translate-x-1/2 rounded-full bg-cyan-400/[0.04] blur-[140px]" />
        <div className="absolute bottom-0 right-[-10%] h-96 w-96 rounded-full bg-blue-500/[0.025] blur-[120px]" />
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_10%,rgba(56,189,248,0.045),transparent_34%)]" />
      </div>

      <div className="relative mx-auto max-w-[1440px] px-5 sm:px-8 lg:px-10">
        
        {/* Encabezado */}
        <div className="mx-auto max-w-3xl text-center">
          <div className="inline-flex items-center gap-2 rounded-full border border-cyan-300/20 bg-cyan-300/[0.08] px-4 py-2 text-xs font-bold uppercase tracking-[0.25em] text-cyan-300 shadow-lg shadow-cyan-500/10 backdrop-blur-md">
            Cómo empezar
          </div>

          <h2
            id="how-it-works-title"
            className="mt-7 text-balance text-4xl font-black tracking-[-0.04em] text-white sm:text-5xl lg:text-6xl"
          >
            De la configuración
            <span className="block bg-gradient-to-r from-cyan-400 via-teal-300 to-emerald-400 bg-clip-text text-transparent mt-1">
              a una operación clara.
            </span>
          </h2>

          <p className="mx-auto mt-6 max-w-2xl text-base leading-relaxed text-zinc-300 sm:text-lg">
            VIMDY está diseñado para que puedas comenzar paso a paso sin enredos y después crecer dentro de la misma plataforma.
          </p>
        </div>

        {/* Tarjetas de Pasos */}
        <div className="relative mx-auto mt-14 max-w-6xl lg:mt-20">
          <div
            aria-hidden="true"
            className="absolute left-[16.666%] right-[16.666%] top-[4.4rem] hidden h-px bg-gradient-to-r from-transparent via-cyan-500/30 to-transparent md:block"
          />

          <div className="grid gap-6 md:grid-cols-3">
            {steps.map((step, index) => {
              const Icon = step.icon;

              return (
                <article
                  key={step.number}
                  className="group relative rounded-[32px] border border-white/[0.08] bg-slate-900/80 p-6 sm:p-8 backdrop-blur-xl transition-all duration-300 hover:-translate-y-1.5 hover:border-cyan-400/50 hover:bg-slate-900 hover:shadow-2xl hover:shadow-cyan-500/10 flex flex-col justify-between"
                >
                  {/* Acento superior luminoso en hover */}
                  <div
                    aria-hidden="true"
                    className="absolute top-0 left-8 right-8 h-[2px] bg-gradient-to-r from-transparent via-cyan-400/50 group-hover:via-cyan-400 transition-all duration-500"
                  />

                  <div>
                    <div className="flex items-start justify-between gap-5">
                      <div className="relative">
                        <div
                          aria-hidden="true"
                          className="absolute -inset-2 rounded-2xl bg-cyan-400/[0.06] blur-xl transition-colors duration-500 group-hover:bg-cyan-400/[0.15]"
                        />

                        <div className="relative flex h-14 w-14 items-center justify-center rounded-2xl border border-slate-700/60 bg-slate-800/90 text-cyan-400 shadow-inner group-hover:scale-110 transition-transform duration-300">
                          <Icon size={24} strokeWidth={1.8} aria-hidden="true" />
                        </div>
                      </div>

                      <div className="flex flex-col items-end gap-1">
                        <span
                          aria-hidden="true"
                          className="text-4xl font-black tracking-tight text-white/10 group-hover:text-cyan-400/30 transition-colors"
                        >
                          {step.number}
                        </span>
                        <span className="text-[10px] font-bold text-cyan-300 bg-cyan-950/80 px-2.5 py-1 rounded-md border border-cyan-500/30 uppercase tracking-widest">
                          {step.badge}
                        </span>
                      </div>
                    </div>

                    <div className="mt-8 space-y-2">
                      <p className="text-[10px] font-extrabold uppercase tracking-[0.2em] text-cyan-400">
                        {step.eyebrow}
                      </p>

                      <h3 className="text-xl font-bold tracking-tight text-white group-hover:text-cyan-300 transition-colors">
                        {step.title}
                      </h3>

                      <p className="text-sm leading-relaxed text-zinc-400">
                        {step.description}
                      </p>
                    </div>
                  </div>

                  <div className="mt-8 pt-4 border-t border-slate-800 flex items-center gap-2 text-xs font-semibold text-zinc-300">
                    <CircleCheck
                      size={15}
                      className="text-cyan-400 shrink-0"
                      aria-hidden="true"
                    />
                    <span>Parte del flujo inicial VIMDY</span>
                  </div>

                  {/* Flecha conectora entre pasos en desktop */}
                  {index < steps.length - 1 && (
                    <div
                      aria-hidden="true"
                      className="absolute -bottom-5 left-1/2 z-10 flex h-10 w-10 -translate-x-1/2 items-center justify-center rounded-full border border-cyan-500/30 bg-slate-950 text-cyan-400 shadow-lg md:-right-5 md:bottom-auto md:left-auto md:top-1/2 md:-translate-y-1/2 md:translate-x-1/2 hidden md:flex"
                    >
                      <ArrowRight size={16} />
                    </div>
                  )}
                </article>
              );
            })}
          </div>
        </div>

        {/* Principios de Adopción */}
        <div className="mx-auto mt-8 grid max-w-6xl gap-3 md:grid-cols-3">
          {principles.map((principle) => (
            <div
              key={principle}
              className="flex items-center gap-3 rounded-2xl border border-white/[0.08] bg-slate-900/60 px-5 py-4 backdrop-blur-md shadow-sm"
            >
              <CircleCheck
                size={17}
                className="shrink-0 text-cyan-400"
                aria-hidden="true"
              />
              <span className="text-sm font-medium text-zinc-300">
                {principle}
              </span>
            </div>
          ))}
        </div>

        {/* Banner Inferior de Cierre */}
        <div className="mx-auto mt-10 max-w-6xl">
          <div className="rounded-[32px] border border-cyan-400/30 bg-gradient-to-r from-cyan-950/40 via-slate-900/80 to-slate-900/80 px-6 py-6 sm:px-8 sm:py-8 shadow-2xl backdrop-blur-xl">
            <div className="flex flex-col gap-6 md:flex-row md:items-center md:justify-between">
              <div className="flex items-start gap-4">
                <div className="mt-0.5 flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border border-cyan-400/30 bg-cyan-500/10 text-cyan-400 shadow-inner">
                  <ShieldCheck size={22} strokeWidth={2} aria-hidden="true" />
                </div>

                <div className="space-y-1">
                  <h4 className="text-base font-bold text-white">
                    Empieza con una base clara y sin ataduras.
                  </h4>
                  <p className="text-sm leading-relaxed text-zinc-300 max-w-2xl">
                    A medida que tu operación crece, incorpora las áreas de VIMDY que necesites sin separar la información en varios sistemas.
                  </p>
                </div>
              </div>

              <a
                href="#precios"
                className="group inline-flex shrink-0 items-center justify-center gap-3 rounded-2xl bg-gradient-to-r from-cyan-400 to-emerald-400 hover:from-cyan-300 hover:to-emerald-300 text-slate-950 font-black px-7 py-4 text-sm transition-all duration-300 shadow-xl shadow-cyan-400/20 hover:scale-105 uppercase tracking-wider"
              >
                Empezar con VIMDY
                <ArrowRight
                  size={16}
                  className="transition-transform duration-300 group-hover:translate-x-1"
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