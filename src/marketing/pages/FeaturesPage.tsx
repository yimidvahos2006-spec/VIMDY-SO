import {
  BarChart3,
  ChefHat,
  CircleDollarSign,
  Grid2X2,
  Package,
  ShoppingCart,
  UsersRound,
} from "lucide-react";
import { ModuleConnections } from "../components/ModuleConnections";

const features = [
  {
    title: "Ventas",
    description:
      "Registra las operaciones de venta y conecta la información con los procesos que ocurren a continuación.",
    icon: ShoppingCart,
  },
  {
    title: "Caja",
    description:
      "Mantén el control de la operación de caja y de los movimientos que forman parte del día a día.",
    icon: CircleDollarSign,
  },
  {
    title: "Inventario",
    description:
      "Gestiona productos y movimientos relacionados con las existencias para mantener la operación visible.",
    icon: Package,
  },
  {
    title: "Cocina",
    description:
      "Conecta los pedidos con el flujo de preparación para que cocina reciba la información que necesita.",
    icon: ChefHat,
  },
  {
    title: "Mesas",
    description:
      "Organiza la atención en mesa y mantiene el pedido asociado al flujo operativo del negocio.",
    icon: Grid2X2,
  },
  {
    title: "Clientes",
    description:
      "Centraliza la información de clientes disponible dentro de la operación de VIMDY.",
    icon: UsersRound,
  },
  {
    title: "Reportes",
    description:
      "Convierte la información operativa en una vista más clara para revisar lo que está sucediendo.",
    icon: BarChart3,
  },
] as const;

export function FeaturesPage() {
  return (
    <div className="min-h-screen overflow-x-clip bg-transparent text-white">
      <main>
        <section
          aria-labelledby="features-page-title"
          className="relative overflow-hidden px-5 pb-20 pt-32 sm:px-8 sm:pt-36 lg:px-10 lg:pb-28 lg:pt-44"
        >
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-0"
          >
            <div className="absolute left-1/2 top-0 h-[30rem] w-[44rem] -translate-x-1/2 rounded-full bg-cyan-300/[0.045] blur-[130px]" />
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_0%,rgba(56,189,248,0.055),transparent_45%)]" />
            <div className="absolute inset-0 opacity-[0.09] [background-image:linear-gradient(rgba(255,255,255,0.04)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.04)_1px,transparent_1px)] [background-size:72px_72px] [mask-image:linear-gradient(to_bottom,black,transparent_86%)]" />
          </div>

          <div className="relative mx-auto max-w-[1440px]">
            <div className="mx-auto max-w-4xl text-center">
              <p className="text-[10px] font-semibold uppercase tracking-[0.28em] text-cyan-300/70">
                VIMDY · Funciones
              </p>

              <h1
                id="features-page-title"
                className="mt-6 text-balance text-5xl font-semibold tracking-[-0.055em] text-white sm:text-6xl lg:text-8xl"
              >
                Las herramientas que forman
                <span className="block bg-gradient-to-r from-white via-zinc-200 to-cyan-200 bg-clip-text text-transparent">
                  una operación conectada.
                </span>
              </h1>

              <p className="mx-auto mt-7 max-w-2xl text-base leading-7 text-zinc-400 sm:text-lg">
                Explora las principales áreas que VIMDY conecta dentro de la
                operación diaria de un negocio.
              </p>
            </div>

            <div className="mx-auto mt-14 grid max-w-6xl gap-3 sm:grid-cols-2 lg:mt-20 lg:grid-cols-4">
              {features.map((feature, index) => {
                const Icon = feature.icon;

                return (
                  <article
                    key={feature.title}
                    className="group relative overflow-hidden rounded-[26px] border border-white/[0.07] bg-white/[0.018] p-6 transition-[transform,border-color,background-color,box-shadow] duration-500 hover:-translate-y-1 hover:border-cyan-300/20 hover:bg-white/[0.035] hover:shadow-[0_24px_70px_rgba(0,0,0,0.28)]"
                  >
                    <div
                      aria-hidden="true"
                      className="absolute -right-10 -top-10 h-28 w-28 rounded-full bg-cyan-300/[0.045] blur-3xl transition-colors duration-500 group-hover:bg-cyan-300/[0.09]"
                    />

                    <div className="relative flex items-start justify-between gap-4">
                      <div className="flex h-11 w-11 items-center justify-center rounded-2xl border border-white/[0.08] bg-white/[0.035] text-zinc-300 transition-[border-color,color,transform] duration-500 group-hover:-translate-y-px group-hover:border-cyan-300/20 group-hover:text-cyan-200">
                        <Icon size={20} strokeWidth={1.7} aria-hidden="true" />
                      </div>

                      <span
                        aria-hidden="true"
                        className="text-[10px] font-semibold tracking-[0.2em] text-zinc-700"
                      >
                        0{index + 1}
                      </span>
                    </div>

                    <h2 className="relative mt-7 text-lg font-semibold tracking-[-0.02em] text-white">
                      {feature.title}
                    </h2>

                    <p className="relative mt-3 text-sm leading-6 text-zinc-500">
                      {feature.description}
                    </p>
                  </article>
                );
              })}
            </div>
          </div>
        </section>

        <section
          aria-labelledby="features-network-title"
          className="relative overflow-hidden border-y border-white/[0.06] bg-white/[0.012]"
        >
          <div className="mx-auto max-w-[1440px] px-5 sm:px-8 lg:px-10">
            <div className="mx-auto max-w-3xl py-16 text-center sm:py-20">
              <p className="text-[10px] font-semibold uppercase tracking-[0.26em] text-zinc-600">
                Cómo se relacionan
              </p>

              <h2
                id="features-network-title"
                className="mt-4 text-3xl font-semibold tracking-[-0.035em] text-white sm:text-4xl"
              >
                VIMDY no trata cada módulo como una isla.
              </h2>

              <p className="mx-auto mt-5 max-w-2xl text-sm leading-7 text-zinc-500 sm:text-base">
                Una de las ideas centrales del sistema es que la información
                pueda seguir el recorrido de la operación en lugar de quedar
                repartida entre herramientas independientes.
              </p>
            </div>

            <ModuleConnections />
          </div>
        </section>
      </main>
    </div>
  );
}
