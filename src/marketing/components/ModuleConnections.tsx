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
  description: string;
}

const modules: ModuleNode[] = [
  { id: "ventas", label: "Ventas", shortLabel: "Ventas", icon: ShoppingCart, x: 50, y: 16, description: "POS ultrarrápido y control de caja" },
  { id: "caja", label: "Caja", shortLabel: "Caja", icon: CircleDollarSign, x: 20, y: 42, description: "Arqueos ciegos y turnos seguros" },
  { id: "mesas", label: "Mesas", shortLabel: "Mesas", icon: Grid2X2, x: 80, y: 42, description: "Gestión de salón y meseros" },
  { id: "inventario", label: "Inventario", shortLabel: "Inventario", icon: Package, x: 30, y: 72, description: "Control de insumos por gramaje" },
  { id: "cocina", label: "Cocina", shortLabel: "Cocina", icon: ChefHat, x: 70, y: 72, description: "KDS digital en tiempo real" },
  { id: "clientes", label: "Clientes", shortLabel: "Clientes", icon: UsersRound, x: 16, y: 92, description: "Base de datos y fidelización" },
  { id: "reportes", label: "Reportes", shortLabel: "Reportes", icon: BarChart3, x: 50, y: 92, description: "Utilidad Neta Real y analítica" },
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
  ["01", "Una venta", "genera información operativa instantánea en todo el sistema."],
  ["02", "La operación", "se actualiza en inventario, caja y cocina automáticamente."],
  ["03", "Los datos", "quedan listos para que tomes decisiones con cifras reales."],
] as const;

export function ModuleConnections() {
  const [reducedMotion, setReducedMotion] = useState(false);
  const [activeModule, setActiveModule] = useState<string | null>("ventas");

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
      {/* Luz ambiental de fondo ultra vibrante */}
      <div aria-hidden="true" className="pointer-events-none absolute inset-0">
        <div className="absolute left-1/2 top-1/2 h-[680px] w-[680px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-cyan-400/[0.05] blur-[140px] animate-pulse" />
        <div className="absolute -left-32 top-1/3 h-80 w-80 rounded-full bg-blue-500/[0.03] blur-[120px]" />
        <div className="absolute -right-32 bottom-1/3 h-80 w-80 rounded-full bg-emerald-400/[0.03] blur-[120px]" />
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_50%,rgba(56,189,248,0.05),transparent_40%)]" />
      </div>

      <div className="relative mx-auto max-w-[1440px] px-5 sm:px-8 lg:px-10">
        <div className="mx-auto max-w-3xl text-center">
          <div className="inline-flex items-center gap-2 rounded-full border border-cyan-300/20 bg-cyan-300/[0.08] px-4 py-2 text-xs font-bold uppercase tracking-[0.25em] text-cyan-300 shadow-lg shadow-cyan-500/10 backdrop-blur-md">
            <Sparkles size={14} aria-hidden="true" />
            Flujo Operativo Conectado
          </div>

          <h2
            id="module-connections-title"
            className="mt-7 text-balance text-4xl font-black tracking-[-0.04em] text-white sm:text-5xl lg:text-6xl"
          >
            Una venta activa todo
            <span className="block bg-gradient-to-r from-cyan-400 via-teal-300 to-emerald-400 bg-clip-text text-transparent mt-1">
              lo que pasa detrás.
            </span>
          </h2>

          <p className="mx-auto mt-6 max-w-2xl text-base leading-relaxed text-zinc-300 sm:text-lg">
            VIMDY unifica cada proceso crítico para que la operación avance como un solo engranaje perfecto sin fricción.
          </p>
        </div>

        {/* Contenedor del Diagrama Interactivo */}
        <div className="mx-auto mt-14 max-w-6xl lg:mt-20">
          <div className="relative aspect-[1/1.1] min-h-[580px] overflow-hidden rounded-[36px] border border-white/[0.1] bg-slate-950/80 p-5 shadow-[0_30px_120px_rgba(0,0,0,0.6)] backdrop-blur-xl sm:aspect-[1.55/1] sm:min-h-[620px] sm:p-8 lg:min-h-[680px]">
            {/* Brillo central sutil */}
            <div
              aria-hidden="true"
              className="absolute inset-0 bg-[radial-gradient(circle_at_center,rgba(56,189,248,0.08),transparent_50%)] pointer-events-none"
            />

            {/* Anillos concéntricos decorativos estilo HUD */}
            <div
              aria-hidden="true"
              className="pointer-events-none absolute left-1/2 top-1/2 h-[32%] w-[32%] -translate-x-1/2 -translate-y-1/2 rounded-full border border-cyan-300/[0.08] shadow-[0_0_100px_rgba(56,189,248,0.08)] animate-[vimdy-pulse_6s_ease-in-out_infinite]"
            />

            {/* SVG de Conexiones Dinámicas */}
            <svg
              viewBox="0 0 100 100"
              preserveAspectRatio="none"
              className="pointer-events-none absolute inset-0 h-full w-full"
              aria-hidden="true"
            >
              <defs>
                <linearGradient id="vimdyActiveConnection" x1="0" y1="0" x2="1" y2="1">
                  <stop offset="0%" stopColor="rgba(56,189,248,0.9)" />
                  <stop offset="50%" stopColor="rgba(52,211,153,0.9)" />
                  <stop offset="100%" stopColor="rgba(56,189,248,0.3)" />
                </linearGradient>

                <linearGradient id="vimdyNormalConnection" x1="0" y1="0" x2="1" y2="1">
                  <stop offset="0%" stopColor="rgba(255,255,255,0.08)" />
                  <stop offset="100%" stopColor="rgba(255,255,255,0.02)" />
                </linearGradient>

                {!reducedMotion && (
                  <filter id="vimdyGlow" x="-50%" y="-50%" width="200%" height="200%">
                    <feGaussianBlur stdDeviation="1.2" result="blur" />
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

                const isConnectedToActive =
                  activeModule === fromId || activeModule === toId;

                return (
                  <g key={`${fromId}-${toId}`} className="transition-all duration-500">
                    <line
                      x1={from.x}
                      y1={from.y}
                      x2={to.x}
                      y2={to.y}
                      stroke={isConnectedToActive ? "rgba(56,189,248,0.25)" : "rgba(255,255,255,0.04)"}
                      strokeWidth={isConnectedToActive ? "0.45" : "0.3"}
                    />

                    <line
                      x1={from.x}
                      y1={from.y}
                      x2={to.x}
                      y2={to.y}
                      stroke={isConnectedToActive ? "url(#vimdyActiveConnection)" : "url(#vimdyNormalConnection)"}
                      strokeWidth={isConnectedToActive ? "0.35" : "0.2"}
                      strokeDasharray={reducedMotion ? undefined : "1.5 1.5"}
                      className={
                        reducedMotion
                          ? ""
                          : index % 2 === 0
                            ? "animate-[vimdy-flow_4s_linear_infinite]"
                            : "animate-[vimdy-flow-reverse_5s_linear_infinite]"
                      }
                      style={{ animationDelay: `${index * 150}ms` }}
                    />

                    {isConnectedToActive && (
                      <circle
                        cx={from.x}
                        cy={from.y}
                        r="0.9"
                        fill="rgba(56,189,248,0.8)"
                        filter={reducedMotion ? undefined : "url(#vimdyGlow)"}
                      />
                    )}
                  </g>
                );
              })}
            </svg>

            {/* Núcleo Central VIMDY Core */}
            <div className="absolute left-1/2 top-[16%] z-20 -translate-x-1/2 -translate-y-1/2">
              <div className="relative group cursor-pointer" onClick={() => setActiveModule("ventas")}>
                {!reducedMotion && (
                  <>
                    <span
                      aria-hidden="true"
                      className="absolute -inset-6 rounded-full bg-cyan-400/20 blur-2xl animate-pulse"
                    />
                    <span
                      aria-hidden="true"
                      className="absolute -inset-10 rounded-full border border-cyan-400/30 animate-[vimdy-pulse_4s_ease-in-out_infinite]"
                    />
                  </>
                )}

                <div className="relative flex h-24 w-24 flex-col items-center justify-center rounded-[30px] border-2 border-cyan-400/50 bg-slate-950 shadow-[0_0_60px_rgba(56,189,248,0.25)] backdrop-blur-2xl transition-transform duration-300 hover:scale-105 sm:h-28 sm:w-28 sm:rounded-[36px]">
                  <span className="text-[11px] font-extrabold uppercase tracking-[0.25em] text-cyan-300">
                    VIMDY
                  </span>
                  <span className="mt-1 text-[9px] font-semibold uppercase tracking-[0.2em] text-zinc-400 bg-cyan-950/80 px-2 py-0.5 rounded-md border border-cyan-500/30">
                    CORE
                  </span>
                </div>
              </div>
            </div>

            {/* Módulos Interactivos */}
            {modules.slice(1).map((module) => {
              const Icon = module.icon;
              const isActive = activeModule === module.id;

              return (
                <div
                  key={module.id}
                  className="absolute z-20 -translate-x-1/2 -translate-y-1/2"
                  style={{ left: `${module.x}%`, top: `${module.y}%` }}
                >
                  <div
                    className="group flex flex-col items-center cursor-pointer select-none"
                    onClick={() => setActiveModule(module.id)}
                    onMouseEnter={() => setActiveModule(module.id)}
                  >
                    <div className="relative">
                      {/* Aura activa */}
                      <div
                        aria-hidden="true"
                        className={`absolute -inset-3 rounded-2xl transition-all duration-500 blur-xl ${
                          isActive
                            ? "bg-cyan-400/30 scale-125"
                            : "bg-blue-500/10 group-hover:bg-cyan-400/20"
                        }`}
                      />

                      {/* Tarjeta del Icono */}
                      <div
                        className={`relative flex h-16 w-16 items-center justify-center rounded-2xl border backdrop-blur-2xl transition-all duration-300 sm:h-20 sm:w-20 sm:rounded-3xl ${
                          isActive
                            ? "border-cyan-400 bg-slate-900 text-cyan-300 shadow-[0_0_35px_rgba(56,189,248,0.4)] scale-110 -translate-y-1"
                            : "border-white/[0.12] bg-slate-900/90 text-zinc-300 shadow-xl hover:-translate-y-1 hover:border-cyan-400/50 hover:text-cyan-300"
                        }`}
                      >
                        <Icon size={26} strokeWidth={1.8} aria-hidden="true" />
                      </div>
                    </div>

                    {/* Etiqueta */}
                    <div className="mt-3 text-center">
                      <span
                        className={`inline-block rounded-full border px-3 py-1 text-xs font-bold backdrop-blur-md transition-all duration-300 ${
                          isActive
                            ? "border-cyan-400/50 bg-cyan-950/80 text-cyan-200 shadow-md shadow-cyan-500/20"
                            : "border-white/[0.08] bg-slate-900/70 text-zinc-400 group-hover:border-cyan-400/30 group-hover:text-zinc-200"
                        }`}
                      >
                        {module.label}
                      </span>
                    </div>
                  </div>
                </div>
              );
            })}

            {/* Banner inferior de estado interactivo dentro del diagrama */}
            <div className="absolute bottom-5 left-1/2 z-20 w-[calc(100%-40px)] -translate-x-1/2 sm:bottom-7 sm:w-auto">
              <div className="flex items-center justify-center gap-2.5 rounded-full border border-cyan-500/30 bg-slate-900/90 px-5 py-2.5 text-center text-xs font-semibold text-cyan-200 shadow-2xl backdrop-blur-2xl">
                <span
                  aria-hidden="true"
                  className="h-2 w-2 shrink-0 rounded-full bg-cyan-400 animate-ping"
                />
                {activeModule
                  ? `Módulo activo: ${moduleMap.get(activeModule)?.label} — ${moduleMap.get(activeModule)?.description}`
                  : "Cada módulo aporta información al siguiente en tiempo real."}
              </div>
            </div>
          </div>
        </div>

        {/* Pasos del flujo inferior con diseño refinado */}
        <div className="mx-auto mt-10 grid max-w-5xl gap-4 sm:grid-cols-3">
          {flowSteps.map(([number, title, description]) => (
            <div
              key={number}
              className="group relative rounded-3xl border border-white/[0.08] bg-slate-900/50 p-6 backdrop-blur-sm transition-all duration-300 hover:border-cyan-400/40 hover:bg-slate-900 hover:-translate-y-1"
            >
              <div
                aria-hidden="true"
                className="absolute top-0 left-6 right-6 h-[2px] bg-gradient-to-r from-transparent via-cyan-500/40 group-hover:via-cyan-400 transition-all duration-500"
              />
              <span className="text-xs font-black tracking-[0.25em] text-cyan-400">
                PASO {number}
              </span>
              <p className="mt-3 text-base font-bold text-white group-hover:text-cyan-300 transition-colors">{title}</p>
              <p className="mt-2 text-sm leading-relaxed text-zinc-400">{description}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}