import { useEffect } from "react";
import Hero from "../components/Hero";
import { TrustBar } from "../components/TrustBar";
import { ModuleConnections } from "../components/ModuleConnections";
import { BusinessTypes } from "../components/BusinessTypes";
import { HowItWorks } from "../components/HowItWorks";
import { Pricing } from "../components/Pricing";
import { FAQ } from "../components/FAQ";
import { FinalCTA } from "../components/FinalCTA";
import { VimdyAssistant } from "../components/VimdyAssistant";

const vimdyPillars = [
  {
    title: "Ventas",
    description:
      "Registra las operaciones de venta y mantiene el flujo conectado con los procesos que ocurren después.",
  },
  {
    title: "Caja",
    description:
      "Controla apertura, cierre, arqueo y movimientos de caja dentro de la operación diaria.",
  },
  {
    title: "Inventario",
    description:
      "Ayuda a mantener el control de productos y de los movimientos que afectan sus existencias.",
  },
  {
    title: "Cocina y mesas",
    description:
      "Conecta pedidos, mesas, meseros y cocina para que el trabajo siga un mismo flujo operativo.",
  },
];

export function LandingPage() {
  useEffect(() => {
    const hash = window.location.hash;
    if (!hash) return;

    const target = document.getElementById(hash.slice(1));
    if (!target) return;

    const frame = window.requestAnimationFrame(() => {
      target.scrollIntoView({ behavior: "smooth", block: "start" });
    });

    return () => window.cancelAnimationFrame(frame);
  }, []);

  return (
    <div className="relative min-h-screen overflow-x-clip bg-transparent text-white">
      <div
        aria-hidden="true"
        className="pointer-events-none fixed inset-0 z-0 bg-[radial-gradient(circle_at_50%_0%,rgba(56,189,248,0.025),transparent_35%)]"
      />

      <div className="relative z-10">
        <section id="inicio" className="scroll-mt-24">
          <Hero />
        </section>

        <TrustBar />

        <section
          id="que-es-vimdy"
          aria-labelledby="que-es-vimdy-title"
          className="scroll-mt-24 border-y border-white/[0.06] bg-white/[0.015]"
        >
          <div className="mx-auto max-w-6xl px-6 py-24 sm:px-8 lg:px-10">
            <div className="max-w-3xl">
              <p className="mb-4 text-sm font-semibold uppercase tracking-[0.22em] text-cyan-300/80">
                Conoce VIMDY
              </p>

              <h2
                id="que-es-vimdy-title"
                className="text-balance text-3xl font-semibold tracking-[-0.035em] text-white sm:text-4xl lg:text-5xl"
              >
                Un solo lugar para entender y operar tu negocio.
              </h2>

              <p className="mt-6 max-w-2xl text-base leading-7 text-zinc-300 sm:text-lg">
                VIMDY reúne diferentes partes de la operación diaria en una
                misma experiencia. La idea es que ventas, caja, inventario,
                cocina y mesas puedan trabajar conectados, en lugar de obligar
                al negocio a manejar cada proceso como una herramienta aislada.
              </p>
            </div>

            <div className="mt-14 grid gap-4 md:grid-cols-2 lg:grid-cols-4">
              {vimdyPillars.map((pillar) => (
                <article
                  key={pillar.title}
                  className="group rounded-3xl border border-white/[0.08] bg-black/20 p-6 backdrop-blur-sm transition-colors duration-300 hover:border-cyan-300/20 hover:bg-white/[0.035]"
                >
                  <div
                    aria-hidden="true"
                    className="mb-6 h-1 w-10 rounded-full bg-cyan-300/70 transition-all duration-300 group-hover:w-14"
                  />

                  <h3 className="text-lg font-semibold tracking-[-0.02em] text-white">
                    {pillar.title}
                  </h3>

                  <p className="mt-3 text-sm leading-6 text-zinc-400">
                    {pillar.description}
                  </p>
                </article>
              ))}
            </div>

            <div className="mt-8 rounded-3xl border border-cyan-300/[0.12] bg-cyan-300/[0.025] p-6 sm:p-8">
              <p className="max-w-4xl text-sm leading-7 text-zinc-300 sm:text-base">
                La propuesta de VIMDY no se basa solamente en tener muchas
                funciones. Se trata de que las piezas importantes de la
                operación compartan un mismo sistema y puedan mantenerse bajo
                control desde una sola plataforma.
              </p>
            </div>
          </div>
        </section>

        <section id="operacion" className="scroll-mt-24">
          <ModuleConnections />
        </section>

        <BusinessTypes />
        <HowItWorks />
        <Pricing />
        <FAQ />
        <FinalCTA />
      </div>

      <VimdyAssistant />
    </div>
  );
}
