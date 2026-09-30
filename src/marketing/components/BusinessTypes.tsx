import {
  CakeSlice,
  Coffee,
  GlassWater,
  Pizza,
  Sandwich,
  UtensilsCrossed,
} from "lucide-react";

const businessTypes = [
  {
    name: "Restaurantes",
    description:
      "Operación completa para el día a día, conectando ventas, caja, inventario, cocina y mesas.",
    icon: UtensilsCrossed,
  },
  {
    name: "Cafeterías",
    description:
      "Ventas rápidas y una operación ordenada para mantener productos, caja y atención bajo control.",
    icon: Coffee,
  },
  {
    name: "Bares",
    description:
      "Control de ventas y movimiento de caja con la información de la operación en un mismo lugar.",
    icon: GlassWater,
  },
  {
    name: "Panaderías",
    description:
      "Productos, inventario y ventas integrados en una experiencia pensada para la operación diaria.",
    icon: CakeSlice,
  },
  {
    name: "Comida rápida",
    description:
      "Flujos ágiles para atender con rapidez sin perder visibilidad sobre la operación.",
    icon: Sandwich,
  },
  {
    name: "Pizzerías",
    description:
      "Conecta pedidos, producción y operación para mantener el trabajo coordinado.",
    icon: Pizza,
  },
];

export function BusinessTypes() {
  return (
    <section
      id="soluciones"
      aria-labelledby="business-types-title"
      className="relative overflow-hidden bg-[#06080b] py-24 sm:py-28 lg:py-36"
    >
      <div aria-hidden="true" className="pointer-events-none absolute inset-0">
        <div className="absolute left-[15%] top-[20%] h-72 w-72 rounded-full bg-cyan-400/[0.035] blur-[100px]" />
        <div className="absolute bottom-[10%] right-[10%] h-80 w-80 rounded-full bg-blue-500/[0.025] blur-[110px]" />
        <div className="absolute inset-0 opacity-[0.1] [background-image:linear-gradient(rgba(255,255,255,0.04)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.04)_1px,transparent_1px)] [background-size:64px_64px] [mask-image:linear-gradient(to_bottom,transparent,black_20%,black_80%,transparent)]" />
      </div>

      <div className="relative mx-auto max-w-[1440px] px-5 sm:px-8 lg:px-10">
        <div className="mx-auto max-w-3xl text-center">
          <div className="inline-flex items-center rounded-full border border-white/[0.07] bg-white/[0.025] px-3.5 py-2 text-[10px] font-semibold uppercase tracking-[0.24em] text-zinc-500">
            Para negocios de alimentos
          </div>

          <h2
            id="business-types-title"
            className="mt-7 text-balance text-4xl font-semibold tracking-[-0.04em] text-white sm:text-5xl lg:text-6xl"
          >
            El negocio cambia.
            <span className="block bg-gradient-to-r from-white via-zinc-200 to-cyan-200 bg-clip-text text-transparent">
              La operación sigue conectada.
            </span>
          </h2>

          <p className="mx-auto mt-6 max-w-2xl text-base leading-7 text-zinc-400 sm:text-lg">
            VIMDY está pensado para distintas formas de vender, producir y
            atender dentro del mundo de alimentos y bebidas.
          </p>
        </div>

        <div className="mx-auto mt-14 grid max-w-6xl gap-3 sm:grid-cols-2 lg:mt-20 lg:grid-cols-3">
          {businessTypes.map((type, index) => {
            const Icon = type.icon;

            return (
              <article
                key={type.name}
                className="group relative overflow-hidden rounded-[26px] border border-white/[0.07] bg-white/[0.018] p-6 transition-[transform,border-color,background-color,box-shadow] duration-500 hover:-translate-y-1 hover:border-cyan-300/20 hover:bg-white/[0.035] hover:shadow-[0_24px_70px_rgba(0,0,0,0.3)] sm:p-7"
              >
                <div
                  aria-hidden="true"
                  className="absolute -right-10 -top-10 h-32 w-32 rounded-full bg-cyan-300/[0.045] blur-3xl transition-colors duration-500 group-hover:bg-cyan-300/[0.09]"
                />

                <div className="relative flex items-start justify-between gap-5">
                  <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-white/[0.08] bg-white/[0.035] text-zinc-300 transition-[border-color,color,transform] duration-500 group-hover:-translate-y-px group-hover:border-cyan-300/20 group-hover:text-cyan-200">
                    <Icon size={21} strokeWidth={1.7} aria-hidden="true" />
                  </div>

                  <span
                    aria-hidden="true"
                    className="text-[10px] font-semibold tracking-[0.2em] text-zinc-700"
                  >
                    0{index + 1}
                  </span>
                </div>

                <h3 className="relative mt-7 text-lg font-semibold tracking-[-0.02em] text-white">
                  {type.name}
                </h3>

                <p className="relative mt-2 max-w-sm text-sm leading-6 text-zinc-500">
                  {type.description}
                </p>

                <div
                  aria-hidden="true"
                  className="relative mt-7 h-px w-full overflow-hidden bg-white/[0.06]"
                >
                  <span className="absolute inset-y-0 left-0 w-0 bg-cyan-300/60 transition-all duration-700 group-hover:w-full" />
                </div>
              </article>
            );
          })}
        </div>

        <div className="mx-auto mt-8 max-w-6xl rounded-[26px] border border-white/[0.06] bg-white/[0.015] px-6 py-5 sm:px-7">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-sm font-medium text-zinc-200">
                ¿Tu negocio es diferente?
              </p>
              <p className="mt-1 text-xs leading-5 text-zinc-500">
                VIMDY parte de la operación real de cada negocio.
              </p>
            </div>

            <a
              href="#contacto"
              className="shrink-0 text-sm font-semibold text-cyan-200 transition-colors hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/50 focus-visible:ring-offset-4 focus-visible:ring-offset-[#06080b]"
            >
              Hablemos de tu negocio →
            </a>
          </div>
        </div>
      </div>
    </section>
  );
}
