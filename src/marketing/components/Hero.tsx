import { ArrowRight, ChevronDown, Sparkles } from "lucide-react";
import { Link } from "react-router-dom";
import { VimdyLogo } from "../../presentation/components/ui/VimdyLogo";
import { VimdyFluidBackground } from "../animations/VimdyFluidBackground";

const operatingAreas = [
  { label: "POS ultrarrápido", detail: "Caja con turnos" },
  { label: "KDS en tiempo real", detail: "Cocina sin gritos" },
  { label: "Inventario de insumos", detail: "Costo por plato" },
  { label: "Utilidad Neta Real", detail: "Contabilidad gerencial" },
] as const;

const promisePoints = [
  "14 días gratis, sin tarjeta",
  "Sin contratos amarrados",
  "Pagas tú, cuando decides renovar",
] as const;

export default function Hero() {
  return (
    <section
      id="hero"
      aria-labelledby="hero-title"
      className="relative isolate min-h-[92vh] overflow-hidden bg-transparent text-white"
    >
      <VimdyFluidBackground />

      {/* Oscurece un poco el centro para que el texto se lea sobre la mancha azul. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_center,rgba(5,7,10,0.55)_0%,rgba(5,7,10,0.25)_55%,rgba(5,7,10,0.65)_100%)]"
      />

      <div className="relative mx-auto flex min-h-[92vh] max-w-7xl flex-col justify-center px-6 pb-20 pt-28 sm:px-8 lg:px-12">
        <div className="mx-auto w-full max-w-6xl">
          <div className="mb-9 flex items-center justify-center">
            <div className="inline-flex items-center gap-3 rounded-full border border-white/[0.10] bg-white/[0.035] px-4 py-2 backdrop-blur-xl">
              <VimdyLogo size={28} />
              <span aria-hidden="true" className="h-1 w-1 rounded-full bg-cyan-400" />
              <span className="text-[11px] font-medium uppercase tracking-[0.28em] text-white/55">
                POS · KDS · Inventario · Contabilidad
              </span>
            </div>
          </div>

          <div className="mx-auto max-w-5xl text-center">
            <h1
              id="hero-title"
              className="text-balance text-4xl font-semibold leading-[1.02] tracking-[-0.045em] text-white sm:text-6xl lg:text-7xl"
            >
              El Sistema Operativo definitivo para restaurantes que vinieron a{" "}
              <span className="bg-gradient-to-r from-white via-cyan-100 to-cyan-300 bg-clip-text text-transparent">
                ganar dinero, no a perderlo en Excel.
              </span>
            </h1>

            <p className="mx-auto mt-8 max-w-3xl text-base leading-7 text-white/70 sm:text-lg sm:leading-8">
              VIMDY unifica POS ultrarrápido, KDS de cocina en tiempo real,
              inventario de insumos y contabilidad gerencial (Utilidad Neta
              Real) en una sola interfaz que vuela. Sin contratos amarrados.
              Sin fricción.
            </p>

            <div className="mt-10 flex flex-col items-center justify-center gap-3 sm:flex-row">
              <Link
                to="/registro"
                className="group inline-flex min-h-14 items-center justify-center gap-2 rounded-full bg-white px-8 text-base font-semibold text-black shadow-[0_20px_70px_rgba(103,232,249,0.22)] transition-all duration-300 hover:scale-[1.02] hover:bg-cyan-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300 focus-visible:ring-offset-2 focus-visible:ring-offset-[#050507]"
              >
                Probar 14 días gratis sin tarjeta
                <ArrowRight
                  size={18}
                  aria-hidden="true"
                  className="transition-transform duration-300 group-hover:translate-x-1"
                />
              </Link>

              <a
                href="#superioridad"
                className="group inline-flex min-h-14 items-center justify-center gap-2 rounded-full border border-white/[0.14] bg-white/[0.04] px-7 text-sm font-medium text-white/80 backdrop-blur-xl transition-all duration-300 hover:border-white/25 hover:bg-white/[0.08] hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300 focus-visible:ring-offset-2 focus-visible:ring-offset-[#050507]"
              >
                Ver por qué VIMDY es imparable
                <ChevronDown
                  size={15}
                  aria-hidden="true"
                  className="transition-transform duration-300 group-hover:translate-y-0.5"
                />
              </a>
            </div>

            <ul className="mx-auto mt-9 flex max-w-3xl flex-wrap items-center justify-center gap-x-6 gap-y-2 text-xs text-white/55">
              {promisePoints.map((point) => (
                <li key={point} className="inline-flex items-center gap-2">
                  <span aria-hidden="true" className="h-1 w-1 rounded-full bg-cyan-300/70" />
                  {point}
                </li>
              ))}
            </ul>
          </div>

          <div className="relative mx-auto mt-20 max-w-4xl sm:mt-24">
            <div
              aria-hidden="true"
              className="absolute left-[8%] right-[8%] top-1/2 hidden h-px bg-gradient-to-r from-transparent via-cyan-300/25 to-transparent lg:block"
            />

            <ul className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              {operatingAreas.map((area, index) => (
                <li
                  key={area.label}
                  className="group relative rounded-2xl border border-white/[0.08] bg-white/[0.03] p-4 backdrop-blur-xl transition-all duration-500 hover:-translate-y-1 hover:border-cyan-300/25 hover:bg-white/[0.055]"
                >
                  <div className="mb-5 flex items-center justify-between">
                    <span className="text-[10px] font-medium tracking-[0.2em] text-white/30">
                      {String(index + 1).padStart(2, "0")}
                    </span>
                    <Sparkles
                      size={12}
                      aria-hidden="true"
                      className="text-cyan-300/35 transition-colors duration-300 group-hover:text-cyan-300/80"
                    />
                  </div>

                  <p className="text-sm font-semibold text-white/85">{area.label}</p>
                  <p className="mt-1 text-xs text-white/40">{area.detail}</p>

                  <div
                    aria-hidden="true"
                    className="mt-3 h-px w-0 bg-cyan-300/60 transition-all duration-500 group-hover:w-full"
                  />
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>

      <div
        aria-hidden="true"
        className="pointer-events-none absolute bottom-0 left-0 right-0 h-40 bg-gradient-to-t from-[#050507] to-transparent"
      />
    </section>
  );
}