import { useEffect, useMemo, useState } from "react";
import {
  BarChart3,
  ChefHat,
  CircleDollarSign,
  Grid2X2,
  Package,
  ShoppingCart,
  Sparkles,
  UsersRound,
} from "lucide-react";

interface ModuleNode {
  id: string;
  label: string;
  shortLabel: string;
  icon: typeof ShoppingCart;
  x: number;
  y: number;
}

const modules: ModuleNode[] = [
  { id: "ventas", label: "Ventas", shortLabel: "Ventas", icon: ShoppingCart, x: 50, y: 17 },
  { id: "caja", label: "Caja", shortLabel: "Caja", icon: CircleDollarSign, x: 20, y: 43 },
  { id: "mesas", label: "Mesas", shortLabel: "Mesas", icon: Grid2X2, x: 80, y: 43 },
  { id: "inventario", label: "Inventario", shortLabel: "Inventario", icon: Package, x: 31, y: 73 },
  { id: "cocina", label: "Cocina", shortLabel: "Cocina", icon: ChefHat, x: 69, y: 73 },
  { id: "clientes", label: "Clientes", shortLabel: "Clientes", icon: UsersRound, x: 17, y: 94 },
  { id: "reportes", label: "Reportes", shortLabel: "Reportes", icon: BarChart3, x: 50, y: 94 },
];

const connections: Array<[string, string]> = [
  ["ventas", "caja"],
  ["ventas", "mesas"],
  ["ventas", "cocina"],
  ["caja", "inventario"],
  ["mesas", "cocina"],
  ["inventario", "cocina"],
  ["inventario", "reportes"],
  ["clientes", "reportes"],
  ["cocina", "reportes"],
];

const flowSteps = [
  ["01", "Una venta", "genera información operativa."],
  ["02", "La operación", "se actualiza donde corresponde."],
  ["03", "Los datos", "quedan disponibles para decidir."],
] as const;

export function ModuleConnections() {
  const [reducedMotion, setReducedMotion] = useState(false);

  useEffect(() => {
    const mediaQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReducedMotion(mediaQuery.matches);

    update();
    mediaQuery.addEventListener("change", update);

    return () => mediaQuery.removeEventListener("change", update);
  }, []);

  const moduleMap = useMemo(
    () => new Map(modules.map((module) => [module.id, module])),
    [],
  );

  return (
    <section
      id="como-funciona"
      aria-labelledby="module-connections-title"
      className="relative isolate overflow-hidden bg-transparent py-24 sm:py-28 lg:py-36"
    >
      <div aria-hidden="true" className="pointer-events-none absolute inset-0">
        <div className="absolute left-1/2 top-1/2 h-[620px] w-[620px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-cyan-400/[0.035] blur-[120px]" />
        <div className="absolute -left-24 top-1/3 h-72 w-72 rounded-full bg-blue-500/[0.018] blur-[110px]" />
        <div className="absolute -right-24 bottom-1/3 h-72 w-72 rounded-full bg-cyan-300/[0.018] blur-[110px]" />
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_50%,rgba(56,189,248,0.04),transparent_34%)]" />
        <div className="absolute inset-0 opacity-[0.12] [background-image:linear-gradient(rgba(255,255,255,0.035)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.035)_1px,transparent_1px)] [background-size:64px_64px] [mask-image:radial-gradient(circle_at_center,black,transparent_74%)]" />
      </div>

      <div className="relative mx-auto max-w-[1440px] px-5 sm:px-8 lg:px-10">
        <div className="mx-auto max-w-3xl text-center">
          <div className="inline-flex items-center gap-2 rounded-full border border-cyan-300/10 bg-cyan-300/[0.05] px-3.5 py-2 text-[10px] font-semibold uppercase tracking-[0.25em] text-cyan-200/75">
            <Sparkles size={13} aria-hidden="true" />
            Una operación conectada
          </div>

          <h2
            id="module-connections-title"
            className="mt-7 text-balance text-4xl font-semibold tracking-[-0.04em] text-white sm:text-5xl lg:text-6xl"
          >
            Una venta activa todo
            <span className="block bg-gradient-to-r from-white via-zinc-200 to-cyan-200 bg-clip-text text-transparent">
              lo que pasa detrás.
            </span>
          </h2>

          <p className="mx-auto mt-6 max-w-2xl text-base leading-7 text-zinc-400 sm:text-lg">
            VIMDY conecta procesos que normalmente están separados para que la
            operación pueda avanzar como un mismo sistema.
          </p>
        </div>

        <div className="mx-auto mt-14 max-w-6xl lg:mt-20">
          <div className="relative aspect-[1/1.05] min-h-[560px] overflow-hidden rounded-[32px] border border-white/[0.07] bg-white/[0.018] p-4 shadow-[0_30px_100px_rgba(0,0,0,0.35)] sm:aspect-[1.55/1] sm:min-h-[580px] sm:p-8 lg:min-h-[640px]">
            <div
              aria-hidden="true"
              className="absolute inset-0 bg-[radial-gradient(circle_at_center,rgba(56,189,248,0.07),transparent_40%)]"
            />

            <div
              aria-hidden="true"
              className="pointer-events-none absolute left-1/2 top-1/2 h-[24%] w-[24%] -translate-x-1/2 -translate-y-1/2 rounded-full border border-cyan-300/[0.06] shadow-[0_0_80px_rgba(56,189,248,0.05)]"
            />

            <svg
              viewBox="0 0 100 100"
              preserveAspectRatio="none"
              className="pointer-events-none absolute inset-0 h-full w-full"
              aria-hidden="true"
            >
              <defs>
                <linearGradient id="vimdyConnection" x1="0" y1="0" x2="1" y2="1">
                  <stop offset="0%" stopColor="rgba(125,211,252,0.04)" />
                  <stop offset="50%" stopColor="rgba(56,189,248,0.42)" />
                  <stop offset="100%" stopColor="rgba(59,130,246,0.08)" />
                </linearGradient>

                {!reducedMotion && (
                  <filter id="vimdyGlow" x="-50%" y="-50%" width="200%" height="200%">
                    <feGaussianBlur stdDeviation="0.9" result="blur" />
                    <feMerge>
                      <feMergeNode in="blur" />
                      <feMergeNode in="SourceGraphic" />
                    </feMerge>
                  </filter>
                )}
              </defs>

              {connections.map(([fromId, toId], index) => {
                const from = moduleMap.get(fromId);
                const to = moduleMap.get(toId);

                if (!from || !to) return null;

                return (
                  <g key={`${fromId}-${toId}`}>
                    <line
                      x1={from.x}
                      y1={from.y}
                      x2={to.x}
                      y2={to.y}
                      stroke="rgba(255,255,255,0.055)"
                      strokeWidth="0.35"
                    />

                    <line
                      x1={from.x}
                      y1={from.y}
                      x2={to.x}
                      y2={to.y}
                      stroke="url(#vimdyConnection)"
                      strokeWidth="0.22"
                      strokeDasharray={reducedMotion ? undefined : "1.4 1.6"}
                      className={
                        reducedMotion
                          ? ""
                          : index % 2 === 0
                            ? "animate-[vimdy-flow_5s_linear_infinite]"
                            : "animate-[vimdy-flow-reverse_6s_linear_infinite]"
                      }
                      style={{ animationDelay: `${index * 180}ms` }}
                    />

                    <circle
                      cx={from.x}
                      cy={from.y}
                      r="0.75"
                      fill="rgba(125,211,252,0.42)"
                      filter={reducedMotion ? undefined : "url(#vimdyGlow)"}
                    />
                    <circle
                      cx={to.x}
                      cy={to.y}
                      r="0.55"
                      fill="rgba(96,165,250,0.3)"
                    />
                  </g>
                );
              })}

              {!reducedMotion && (
                <>
                  <circle
                    cx="50"
                    cy="17"
                    r="4"
                    fill="none"
                    stroke="rgba(103,232,249,0.25)"
                    strokeWidth="0.25"
                    className="animate-[vimdy-pulse_3.4s_ease-in-out_infinite]"
                  />
                  <circle
                    cx="50"
                    cy="17"
                    r="6.4"
                    fill="none"
                    stroke="rgba(103,232,249,0.07)"
                    strokeWidth="0.18"
                    className="animate-[vimdy-pulse_4.8s_ease-in-out_infinite]"
                  />
                </>
              )}
            </svg>

            <div className="absolute left-1/2 top-[17%] z-10 -translate-x-1/2 -translate-y-1/2">
              <div className="relative">
                {!reducedMotion && (
                  <>
                    <span
                      aria-hidden="true"
                      className="absolute -inset-4 rounded-full bg-cyan-300/10 blur-xl animate-pulse"
                    />
                    <span
                      aria-hidden="true"
                      className="absolute -inset-7 rounded-full border border-cyan-300/[0.06] animate-[vimdy-pulse_4.5s_ease-in-out_infinite]"
                    />
                  </>
                )}

                <div className="relative flex h-20 w-20 items-center justify-center rounded-[26px] border border-cyan-200/20 bg-[#091016]/95 shadow-[0_0_55px_rgba(56,189,248,0.14)] backdrop-blur-xl sm:h-24 sm:w-24">
                  <div className="text-center">
                    <span className="block text-[10px] font-semibold uppercase tracking-[0.2em] text-cyan-200/70">
                      VIMDY
                    </span>
                    <span className="mt-1 block text-[8px] uppercase tracking-[0.18em] text-zinc-500">
                      Core
                    </span>
                  </div>
                </div>
              </div>
            </div>

            {modules.slice(1).map((module) => {
              const Icon = module.icon;

              return (
                <div
                  key={module.id}
                  className="absolute z-10 -translate-x-1/2 -translate-y-1/2"
                  style={{ left: `${module.x}%`, top: `${module.y}%` }}
                >
                  <div className="group flex flex-col items-center">
                    <div className="relative">
                      <div
                        aria-hidden="true"
                        className="absolute -inset-2 rounded-full bg-blue-400/[0.06] blur-lg transition-all duration-500 group-hover:bg-cyan-300/[0.13]"
                      />

                      <div className="relative flex h-14 w-14 items-center justify-center rounded-2xl border border-white/[0.09] bg-[#080c11]/95 text-zinc-300 shadow-[0_18px_45px_rgba(0,0,0,0.3)] backdrop-blur-xl transition-all duration-500 group-hover:-translate-y-1 group-hover:border-cyan-300/25 group-hover:text-cyan-200 sm:h-16 sm:w-16 sm:rounded-[20px]">
                        <Icon size={21} strokeWidth={1.7} aria-hidden="true" />
                      </div>
                    </div>

                    <span className="mt-3 rounded-full border border-white/[0.06] bg-black/20 px-2.5 py-1 text-[10px] font-medium text-zinc-500 backdrop-blur-md transition-colors duration-300 group-hover:text-zinc-300 sm:text-[11px]">
                      {module.label}
                    </span>
                  </div>
                </div>
              );
            })}

            <div className="absolute bottom-5 left-1/2 z-10 w-[calc(100%-40px)] -translate-x-1/2 sm:bottom-7 sm:w-auto">
              <div className="flex items-center justify-center gap-2 rounded-full border border-white/[0.07] bg-[#070a0e]/80 px-4 py-2 text-center text-[10px] font-medium text-zinc-500 shadow-xl backdrop-blur-xl sm:text-[11px]">
                <span
                  aria-hidden="true"
                  className="h-1.5 w-1.5 shrink-0 rounded-full bg-cyan-300/80 shadow-[0_0_12px_rgba(103,232,249,0.35)]"
                />
                Cada módulo aporta información al siguiente.
              </div>
            </div>
          </div>
        </div>

        <div className="mx-auto mt-8 grid max-w-5xl gap-3 sm:grid-cols-3">
          {flowSteps.map(([number, title, description]) => (
            <div
              key={number}
              className="rounded-2xl border border-white/[0.06] bg-white/[0.02] p-5 transition-colors duration-300 hover:border-cyan-300/10 hover:bg-white/[0.03]"
            >
              <span className="text-[10px] font-semibold tracking-[0.2em] text-cyan-300/60">
                {number}
              </span>
              <p className="mt-3 text-sm font-semibold text-zinc-200">{title}</p>
              <p className="mt-1 text-xs leading-5 text-zinc-500">{description}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
