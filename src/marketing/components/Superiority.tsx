import { ChefHat, Calculator, WifiOff, type LucideIcon } from "lucide-react";
import { NET_PROFIT_FORMULA } from "../pricingCopy";

interface Advantage {
  id: string;
  icon: LucideIcon;
  kicker: string;
  title: string;
  body: string;
  proof: readonly string[];
  badge?: string;
}

const advantages: readonly Advantage[] = [
  {
    id: "offline",
    icon: WifiOff,
    kicker: "Velocidad Offline-First",
    title: "Se cae el internet. Tu caja sigue vendiendo.",
    body: "VIMDY guarda cada venta en el propio equipo y la sincroniza sola cuando vuelve la conexión. Un sábado lleno no se detiene por el internet del local.",
    proof: [
      "Ventas guardadas en el equipo",
      "Sincronización automática al reconectar",
      "Cobros pendientes marcados como pendientes, nunca como pagados",
    ],
  },
  {
    id: "utilidad",
    icon: Calculator,
    kicker: "Utilidad Neta Real Automática",
    title: "Dinero limpio y claro, sin enredos contables.",
    body: "VIMDY descuenta de tus ventas el costo de los insumos y tus gastos fijos, nómina de empleados incluida. Sabes cuánto te queda de verdad, sin abrir un Excel.",
    proof: [
      "Ventas − costo de insumos − gastos fijos",
      "Nómina registrada como gasto fijo",
      "Cifras de gestión calculadas con los datos que registras",
    ],
    badge: "VIMDY Total",
  },
  {
    id: "kds",
    icon: ChefHat,
    kicker: "Cocina Cero Gritos (KDS Inteligente)",
    title: "Comandas digitales que nadie tiene que gritar.",
    body: "Cada pedido llega a la pantalla de cocina ordenado por tiempo de espera. Se acabaron los papelitos perdidos, los platos olvidados y los errores de comanda.",
    proof: [
      "Comandas ordenadas por tiempo",
      "Cocina conectada a cada venta en tiempo real",
      "Cada plato visible hasta que sale",
    ],
  },
];

export function Superiority() {
  return (
    <section
      id="superioridad"
      aria-labelledby="superioridad-title"
      className="relative scroll-mt-24 overflow-hidden border-y border-white/[0.06] bg-[#05070a] py-24 sm:py-28 lg:py-36"
    >
      <div aria-hidden="true" className="pointer-events-none absolute inset-0">
        <div className="absolute left-1/2 top-0 h-80 w-[46rem] -translate-x-1/2 rounded-full bg-cyan-300/[0.05] blur-[130px]" />
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_0%,rgba(56,189,248,0.05),transparent_45%)]" />
      </div>

      <div className="relative mx-auto max-w-[1440px] px-5 sm:px-8 lg:px-10">
        <div className="mx-auto max-w-3xl text-center">
          <p className="text-[10px] font-semibold uppercase tracking-[0.28em] text-cyan-300/75">
            Por qué VIMDY es imparable
          </p>

          <h2
            id="superioridad-title"
            className="mt-6 text-balance text-4xl font-semibold tracking-[-0.04em] text-white sm:text-5xl lg:text-6xl"
          >
            Lo que un Excel y un POS de cajón
            <span className="block bg-gradient-to-r from-white via-zinc-200 to-cyan-200 bg-clip-text text-transparent">
              nunca te van a dar.
            </span>
          </h2>

          <p className="mx-auto mt-6 max-w-2xl text-base leading-7 text-zinc-400 sm:text-lg">
            Tres ventajas que se notan desde el primer turno: vendes aunque falle
            el internet, sabes cuánto ganas de verdad y tu cocina trabaja en
            silencio.
          </p>
        </div>

        <div className="mt-16 grid gap-4 lg:grid-cols-3">
          {advantages.map((item) => {
            const Icon = item.icon;
            return (
              <article
                key={item.id}
                className="group relative flex flex-col overflow-hidden rounded-[30px] border border-white/[0.08] bg-white/[0.02] p-7 transition-[transform,border-color,background-color] duration-500 hover:-translate-y-1 hover:border-cyan-300/25 hover:bg-white/[0.035] sm:p-8"
              >
                <div
                  aria-hidden="true"
                  className="absolute -right-14 -top-14 h-40 w-40 rounded-full bg-cyan-300/[0.07] blur-3xl transition-opacity duration-500 group-hover:opacity-100"
                />

                <div className="relative flex items-center justify-between">
                  <span className="flex h-12 w-12 items-center justify-center rounded-2xl border border-cyan-300/15 bg-cyan-300/[0.06] text-cyan-200">
                    <Icon size={22} aria-hidden="true" />
                  </span>
                  {item.badge && (
                    <span className="rounded-full border border-cyan-200/15 bg-cyan-200/[0.06] px-3 py-1 text-[9px] font-semibold uppercase tracking-[0.18em] text-cyan-200/90">
                      {item.badge}
                    </span>
                  )}
                </div>

                <p className="relative mt-7 text-[11px] font-semibold uppercase tracking-[0.2em] text-cyan-300/75">
                  {item.kicker}
                </p>
                <h3 className="relative mt-3 text-balance text-2xl font-semibold leading-tight tracking-[-0.03em] text-white">
                  {item.title}
                </h3>
                <p className="relative mt-4 text-sm leading-7 text-zinc-400">{item.body}</p>

                {item.id === "utilidad" && (
                  <div
                    className="relative mt-5 flex flex-wrap items-center gap-x-2 gap-y-1 rounded-2xl border border-cyan-300/10 bg-black/30 px-4 py-3 text-xs font-medium text-zinc-300"
                    aria-label="Utilidad Neta Real es igual a ventas menos costo de insumos menos gastos fijos"
                  >
                    <span className="text-cyan-200">Utilidad Neta Real</span>
                    <span aria-hidden="true" className="text-zinc-600">=</span>
                    {NET_PROFIT_FORMULA.map((term, index) => (
                      <span key={term} className="inline-flex items-center gap-2">
                        {index > 0 && (
                          <span aria-hidden="true" className="text-zinc-600">−</span>
                        )}
                        {term}
                      </span>
                    ))}
                  </div>
                )}

                <ul className="relative mt-6 space-y-2 border-t border-white/[0.06] pt-5">
                  {item.proof.map((line) => (
                    <li key={line} className="flex items-start gap-2.5 text-xs leading-5 text-zinc-500">
                      <span
                        aria-hidden="true"
                        className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-cyan-300/70"
                      />
                      {line}
                    </li>
                  ))}
                </ul>
              </article>
            );
          })}
        </div>
      </div>
    </section>
  );
}