import { useEffect } from "react";
import { Receipt, Vault, Package, ChefHat } from "lucide-react";
import Hero from "../components/Hero";
import { TrustBar } from "../components/TrustBar";
import { Superiority } from "../components/Superiority";
import { ModuleConnections } from "../components/ModuleConnections";
import { BusinessTypes } from "../components/BusinessTypes";
import { CategoriesVideo } from "../components/CategoriesVideo";
import { HowItWorks } from "../components/HowItWorks";
import { Pricing } from "../components/Pricing";
import { FAQ } from "../components/FAQ";
import { FinalCTA } from "../components/FinalCTA";
import { VimdyAssistant } from "../components/VimdyAssistant";

const vimdyPillars = [
  {
    title: "Ventas",
    description:
      "Factura a la velocidad de la luz y conecta al instante cada pedido con la barra y la cocina sin fricción.",
    icon: Receipt,
    badge: "POS Flash",
    accentColor: "text-emerald-400",
  },
  {
    title: "Caja",
    description:
      "Turnos blindados, arqueos ciegos seguros y cero diferencias invisibles en el efectivo al cerrar.",
    icon: Vault,
    badge: "Arqueo Ciego",
    accentColor: "text-amber-400",
  },
  {
    title: "Inventario",
    description:
      "Descuento automático por gramaje e insumos. Controla tu costo real plato por plato de forma exacta.",
    icon: Package,
    badge: "Costo Real",
    accentColor: "text-cyan-400",
  },
  {
    title: "Cocina y mesas",
    description:
      "Pantallas KDS organizadas por tiempos. Se acabaron los papelitos perdidos, los errores y los gritos.",
    icon: ChefHat,
    badge: "KDS Digital",
    accentColor: "text-purple-400",
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

        <Superiority />

        {/* SECCIÓN RENOVADA: CONOCE VIMDY - ALTO IMPACTO */}
        <section
          id="que-es-vimdy"
          aria-labelledby="que-es-vimdy-title"
          className="scroll-mt-24 border-y border-white/[0.06] bg-gradient-to-b from-slate-950 via-slate-900/40 to-slate-950 py-24 relative overflow-hidden"
        >
          {/* Luz ambiental de fondo sutil */}
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[500px] h-[250px] bg-cyan-500/5 blur-[120px] pointer-events-none rounded-full" />

          <div className="mx-auto max-w-7xl px-6 sm:px-8 lg:px-10 relative z-10">
            <div className="max-w-3xl">
              <span className="mb-4 inline-flex items-center gap-2 text-xs font-bold uppercase tracking-[0.25em] text-cyan-300 bg-cyan-500/10 px-4 py-1.5 rounded-full border border-cyan-400/30 shadow-sm">
                ⚡ OPERACIÓN UNIFICADA
              </span>

              <h2
                id="que-es-vimdy-title"
                className="text-balance text-3xl font-black tracking-[-0.035em] text-white sm:text-4xl lg:text-5xl leading-tight"
              >
                Adiós a las aplicaciones sueltas. <span className="text-transparent bg-clip-text bg-gradient-to-r from-cyan-400 to-emerald-400">Tu restaurante operando como un reloj.</span>
              </h2>

              <p className="mt-6 max-w-2xl text-base leading-relaxed text-zinc-300 sm:text-lg">
                VIMDY reúne todas las piezas clave de la operación diaria en una misma experiencia. 
                Aquí las ventas, la caja, el inventario y la cocina trabajan en equipo automáticamente para que ganes dinero, no dolores de cabeza.
              </p>
            </div>

            {/* Tarjetas de pilares con copywriting persuasivo */}
            <div className="mt-14 grid gap-6 md:grid-cols-2 lg:grid-cols-4">
              {vimdyPillars.map((pillar) => {
                const IconComponent = pillar.icon;
                return (
                  <article
                    key={pillar.title}
                    className="group relative rounded-3xl border border-white/[0.08] bg-slate-900/80 p-8 backdrop-blur-md transition-all duration-300 hover:-translate-y-1.5 hover:border-cyan-400/50 hover:bg-slate-900 hover:shadow-2xl hover:shadow-cyan-500/10 flex flex-col justify-between"
                  >
                    {/* Acento superior luminoso en hover */}
                    <div
                      aria-hidden="true"
                      className="absolute top-0 left-8 right-8 h-[2px] bg-gradient-to-r from-transparent via-zinc-700 group-hover:via-cyan-400 transition-all duration-500"
                    />

                    <div className="space-y-6">
                      <div className="flex items-center justify-between">
                        <div className="p-3.5 rounded-2xl bg-slate-800/90 border border-slate-700/60 shadow-inner group-hover:scale-110 transition-transform duration-300">
                          <IconComponent className={`w-6 h-6 ${pillar.accentColor}`} />
                        </div>
                        <span className="text-[10px] font-bold text-cyan-300 bg-cyan-500/10 px-3 py-1 rounded-lg border border-cyan-400/20 uppercase tracking-wider">
                          {pillar.badge}
                        </span>
                      </div>

                      <div className="space-y-2">
                        <h3 className="text-xl font-bold tracking-[-0.02em] text-white group-hover:text-cyan-300 transition-colors">
                          {pillar.title}
                        </h3>

                        <p className="text-sm leading-relaxed text-zinc-400">
                          {pillar.description}
                        </p>
                      </div>
                    </div>
                  </article>
                );
              })}
            </div>

            {/* Banner inferior de alta conversión */}
            <div className="mt-12 rounded-3xl border border-cyan-400/30 bg-gradient-to-r from-cyan-950/40 via-slate-900/80 to-slate-900/80 p-8 sm:p-10 flex flex-col md:flex-row items-center justify-between gap-6 shadow-2xl shadow-cyan-500/5">
              <div className="space-y-1 text-center md:text-left">
                <h4 className="text-lg font-bold text-white">¿Listo para controlar cada peso y automatizar tu servicio?</h4>
                <p className="text-sm text-zinc-300 max-w-2xl">
                  La propuesta de VIMDY no es acumular funciones, sino mantener tu negocio bajo control absoluto desde una sola plataforma.
                </p>
              </div>
              <a
                href="#precios"
                className="shrink-0 bg-gradient-to-r from-cyan-400 to-emerald-400 hover:from-cyan-300 hover:to-emerald-300 text-slate-950 font-black px-8 py-4 rounded-2xl transition-all duration-300 shadow-xl shadow-cyan-400/20 hover:scale-105 text-sm uppercase tracking-wider"
              >
                Probar VIMDY gratis
              </a>
            </div>
          </div>
        </section>

        <section id="operacion" className="scroll-mt-24">
          <ModuleConnections />
        </section>

        <BusinessTypes />
        <CategoriesVideo />
        <HowItWorks />
        <Pricing />
        <FAQ />
        <FinalCTA />
      </div>

      <VimdyAssistant />
    </div>
  );
}