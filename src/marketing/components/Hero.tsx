import { ArrowRight, Play, Sparkles } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { VimdyNetwork } from "./VimdyNetwork";

export function Hero() {
  return (
    <section className="relative pt-24 pb-16 md:pt-32 md:pb-24 overflow-hidden">
      <div className="max-w-7xl mx-auto px-6">
        <div className="grid md:grid-cols-2 gap-12 items-center">
          <div className="relative space-y-8">
            <div className="relative">
              <VimdyNetwork />
              <div className="relative z-10 space-y-8">
                <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-blue-600/10 border border-blue-500/20">
                  <Sparkles size={16} className="text-blue-400" />
                  <span className="text-sm text-blue-300 font-medium">Potenciado por IA</span>
                </div>
                <h1 className="text-4xl md:text-6xl lg:text-7xl font-bold leading-[1.1] tracking-tight">
                  Haz crecer lo que estás{" "}
                  <span className="bg-gradient-to-r from-blue-400 via-blue-500 to-cyan-400 bg-clip-text text-transparent">
                    construyendo
                  </span>
                  .
                </h1>
                <p className="text-lg md:text-xl text-zinc-400 leading-relaxed max-w-lg">
                  Una plataforma inteligente para controlar ventas, caja, inventario y operación desde un solo lugar.
                </p>
                <div className="flex flex-col gap-4">
                  <a
                    href="/registro"
                    className="inline-flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-500 text-white font-semibold px-8 py-4 rounded-xl transition-all hover:gap-3 shadow-lg shadow-blue-600/20"
                  >
                    Prueba VIMDY gratis durante 14 días
                    <ArrowRight size={18} />
                  </a>
                  <p className="text-xs text-zinc-500">
                    Sin tarjeta de crédito · Configuración rápida · Cancela cuando quieras
                  </p>
                </div>
                <p className="text-sm text-zinc-500">
                  Para restaurantes, cafeterías, bares, panaderías y negocios de comida.
                </p>
              </div>
            </div>
          </div>

          <div className="relative hidden md:block">
            <Hero3D>
              <div className="glass-card rounded-2xl p-6 shadow-2xl">
                <div className="flex items-center gap-2 mb-4">
                  <div className="w-3 h-3 rounded-full bg-red-500/80" />
                  <div className="w-3 h-3 rounded-full bg-yellow-500/80" />
                  <div className="w-3 h-3 rounded-full bg-green-500/80" />
                  <span className="ml-2 text-xs text-zinc-500">VIMDY Dashboard</span>
                </div>
                <div className="space-y-3">
                  <div className="grid grid-cols-3 gap-3">
                    <div className="glass-card rounded-lg p-3 border border-white/5">
                      <p className="text-xs text-zinc-500 mb-1">Ventas hoy</p>
                      <p className="text-lg font-bold text-white">$2.450.000</p>
                    </div>
                    <div className="glass-card rounded-lg p-3 border border-white/5">
                      <p className="text-xs text-zinc-500 mb-1">Órdenes</p>
                      <p className="text-lg font-bold text-white">47</p>
                    </div>
                    <div className="glass-card rounded-lg p-3 border border-white/5">
                      <p className="text-xs text-zinc-500 mb-1">Ticket promedio</p>
                      <p className="text-lg font-bold text-white">$52.127</p>
                    </div>
                  </div>
                  <div className="glass-card rounded-lg p-4 border border-white/5">
                    <div className="flex items-center justify-between mb-3">
                      <span className="text-sm text-zinc-400">Productos top</span>
                      <span className="text-xs text-zinc-600">Hoy</span>
                    </div>
                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="text-sm text-white">Hamburguesa Clásica</span>
                        <span className="text-sm text-zinc-400">23 vendidas</span>
                      </div>
                      <div className="w-full bg-white/5 rounded-full h-1.5">
                        <div className="bg-blue-500 h-1.5 rounded-full" style={{ width: "75%" }} />
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </Hero3D>
          </div>
        </div>
      </div>
    </section>
  );
}

function Hero3D({ children }: { children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [transform, setTransform] = useState("");
  const [isHovering, setIsHovering] = useState(false);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;

    function handleMouseMove(event: MouseEvent) {
      const rect = element!.getBoundingClientRect();
      const x = event.clientX - rect.left;
      const y = event.clientY - rect.top;
      const centerX = rect.width / 2;
      const centerY = rect.height / 2;

      const rotateX = ((y - centerY) / centerY) * -8;
      const rotateY = ((x - centerX) / centerX) * 8;

      setTransform(`perspective(1000px) rotateX(${rotateX}deg) rotateY(${rotateY}deg) scale3d(1.02, 1.02, 1.02)`);
    }

    function handleMouseLeave() {
      setTransform("perspective(1000px) rotateX(0deg) rotateY(0deg) scale3d(1, 1, 1)");
      setIsHovering(false);
    }

    function handleMouseEnter() {
      setIsHovering(true);
    }

    element.addEventListener("mousemove", handleMouseMove);
    element.addEventListener("mouseleave", handleMouseLeave);
    element.addEventListener("mouseenter", handleMouseEnter);

    return () => {
      element.removeEventListener("mousemove", handleMouseMove);
      element.removeEventListener("mouseleave", handleMouseLeave);
      element.removeEventListener("mouseenter", handleMouseEnter);
    };
  }, []);

  return (
    <div
      ref={ref}
      className="relative transition-transform duration-300 ease-out hero-3d-container"
      style={{ transform }}
    >
      <div className="hero-3d-card">{children}</div>
      <div
        className={`absolute inset-0 rounded-vimdy-xl pointer-events-none transition-opacity duration-300 hero-3d-glow ${
          isHovering ? "opacity-100" : "opacity-0"
        }`}
        aria-hidden="true"
      />
    </div>
  );
}
