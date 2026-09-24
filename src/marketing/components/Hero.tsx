import { ArrowRight, ChevronDown, Sparkles } from "lucide-react";
import { Link } from "react-router-dom";
import { VimdyLogo } from "../../presentation/components/ui/VimdyLogo";

const operatingAreas = [
  "Ventas",
  "Caja",
  "Inventario",
  "Cocina",
  "Mesas",
  "Datos",
] as const;

export default function Hero() {
  return (
    <section
      id="hero"
      aria-labelledby="hero-title"
      className="relative isolate min-h-[92vh] overflow-hidden bg-transparent text-white"
    >
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute left-1/2 top-[-22rem] h-[42rem] w-[42rem] -translate-x-1/2 rounded-full bg-cyan-500/[0.10] blur-[120px]" />
        <div className="absolute right-[-14rem] top-[18%] h-[34rem] w-[34rem] rounded-full bg-blue-600/[0.08] blur-[120px]" />
        <div className="absolute bottom-[-20rem] left-[-10rem] h-[34rem] w-[34rem] rounded-full bg-indigo-600/[0.07] blur-[120px]" />

        <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,transparent_0%,rgba(5,5,7,0.15)_45%,rgba(5,5,7,0.97)_100%)]" />

      </div>

      <div className="relative mx-auto flex min-h-[92vh] max-w-7xl flex-col justify-center px-6 pb-20 pt-28 sm:px-8 lg:px-12">
        <div className="mx-auto w-full max-w-6xl">
          <div className="mb-9 flex items-center justify-center">
            <div className="inline-flex items-center gap-3 rounded-full border border-white/[0.10] bg-white/[0.035] px-4 py-2 backdrop-blur-xl">
              <VimdyLogo size={28} />
              <span aria-hidden="true" className="h-1 w-1 rounded-full bg-cyan-400" />
              <span className="text-[11px] font-medium uppercase tracking-[0.28em] text-white/45">
                Tecnología para negocios
              </span>
            </div>
          </div>

          <div className="mx-auto max-w-5xl text-center">
            <p className="mb-6 text-xs font-semibold uppercase tracking-[0.32em] text-cyan-300/75">
              Todo el negocio. En un solo sistema.
            </p>

            <h1
              id="hero-title"
              className="text-balance text-5xl font-semibold leading-[0.95] tracking-[-0.055em] text-white sm:text-7xl lg:text-[6.5rem]"
            >
              La tecnología
              <br />
              <span className="bg-gradient-to-r from-white via-white to-cyan-300 bg-clip-text text-transparent">
                detrás de tu operación.
              </span>
            </h1>

            <p className="mx-auto mt-8 max-w-2xl text-base leading-7 text-white/60 sm:text-lg">
              VIMDY conecta ventas, caja, inventario, cocina, mesas y datos en
              una sola experiencia para gestionar la operación diaria con mayor
              claridad y control.
            </p>

            <div className="mt-10 flex flex-col items-center justify-center gap-3 sm:flex-row">
              <Link
                to="/registro"
                className="group inline-flex min-h-12 items-center justify-center gap-2 rounded-full bg-white px-7 text-sm font-semibold text-black transition-all duration-300 hover:scale-[1.02] hover:bg-cyan-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300 focus-visible:ring-offset-2 focus-visible:ring-offset-[#050507] sm:min-h-[52px]"
              >
                Crear mi negocio
                <ArrowRight
                  size={16}
                  aria-hidden="true"
                  className="transition-transform duration-300 group-hover:translate-x-1"
                />
              </Link>

              <a
                href="#experiencia"
                className="group inline-flex min-h-12 items-center justify-center gap-2 rounded-full border border-white/[0.12] bg-white/[0.035] px-7 text-sm font-medium text-white/75 backdrop-blur-xl transition-all duration-300 hover:border-white/20 hover:bg-white/[0.07] hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300 focus-visible:ring-offset-2 focus-visible:ring-offset-[#050507] sm:min-h-[52px]"
              >
                Conocer VIMDY
                <ChevronDown
                  size={15}
                  aria-hidden="true"
                  className="transition-transform duration-300 group-hover:translate-y-0.5"
                />
              </a>
            </div>

            <div className="mx-auto mt-10 flex max-w-3xl flex-wrap items-center justify-center gap-x-5 gap-y-2 text-[11px] uppercase tracking-[0.18em] text-white/30">
              <span>Ventas conectadas</span>
              <span aria-hidden="true" className="hidden h-1 w-1 rounded-full bg-cyan-300/35 sm:block" />
              <span>Control operativo</span>
              <span aria-hidden="true" className="hidden h-1 w-1 rounded-full bg-cyan-300/35 sm:block" />
              <span>Información centralizada</span>
            </div>
          </div>

          <div className="relative mx-auto mt-20 max-w-5xl sm:mt-24">
            <div
              aria-hidden="true"
              className="absolute left-[8%] right-[8%] top-1/2 hidden h-px bg-gradient-to-r from-transparent via-cyan-300/25 to-transparent lg:block"
            />

            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
              {operatingAreas.map((label, index) => (
                <div
                  key={label}
                  className="group relative rounded-2xl border border-white/[0.08] bg-white/[0.025] p-4 backdrop-blur-xl transition-all duration-500 hover:-translate-y-1 hover:border-cyan-300/20 hover:bg-white/[0.05]"
                >
                  <div className="mb-5 flex items-center justify-between">
                    <span className="text-[10px] font-medium tracking-[0.2em] text-white/25">
                      {String(index + 1).padStart(2, "0")}
                    </span>
                    <Sparkles
                      size={12}
                      aria-hidden="true"
                      className="text-cyan-300/30 transition-colors duration-300 group-hover:text-cyan-300/80"
                    />
                  </div>

                  <p className="text-sm font-medium text-white/75">{label}</p>

                  <div
                    aria-hidden="true"
                    className="mt-3 h-px w-0 bg-cyan-300/60 transition-all duration-500 group-hover:w-full"
                  />
                </div>
              ))}
            </div>
          </div>

          <div className="mx-auto mt-12 flex max-w-3xl items-center justify-center gap-3 text-center">
            <span aria-hidden="true" className="h-px w-8 bg-white/10" />
            <p className="text-[11px] uppercase tracking-[0.25em] text-white/25">
              Una operación. Una visión. Un sistema.
            </p>
            <span aria-hidden="true" className="h-px w-8 bg-white/10" />
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
