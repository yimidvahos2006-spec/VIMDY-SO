import { useEffect, useRef, useState } from "react";
import { ArrowRight } from "lucide-react";

export function CategoriesVideo() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [reduceMotion, setReduceMotion] = useState(false);

  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduceMotion(query.matches);
    if (query.matches) videoRef.current?.pause();
  }, []);

  return (
    <section
      id="categorias"
      aria-labelledby="categorias-title"
      className="scroll-mt-24 border-y border-white/[0.06] bg-white/[0.015]"
    >
      <div className="mx-auto grid max-w-6xl items-center gap-12 px-6 py-24 sm:px-8 lg:grid-cols-[0.9fr_1.1fr] lg:gap-14 lg:px-10">
        <div>
          <h2
            id="categorias-title"
            className="text-balance text-3xl font-semibold tracking-[-0.035em] text-white sm:text-4xl lg:text-5xl"
          >
            El software de restaurantes tradicional ha muerto. 🚀
          </h2>

          <p className="mt-6 max-w-xl text-base leading-7 text-zinc-300 sm:text-lg sm:leading-8">
            Dale la bienvenida a{" "}
            <span className="font-semibold text-white">VIMDY IA</span>.
            Olvídate de buscar reportes manuales, hacer cálculos a ciegas o
            perderte entre menús complejos. Imagina tener un gerente virtual
            con el que puedes hablar, que entiende el pulso exacto de tu caja
            y tu bodega en milisegundos, y que además tiene personalidad
            propia. El futuro de la gastronomía ya está aquí.
          </p>

          <a
            href="/registro"
            className="group mt-10 inline-flex items-center justify-center gap-3 rounded-full bg-white px-7 py-4 text-sm font-semibold text-black transition-[transform,background-color] duration-300 hover:-translate-y-1 hover:bg-zinc-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/60 focus-visible:ring-offset-4 focus-visible:ring-offset-[#05070a]"
          >
            Probar 14 días gratis
            <ArrowRight
              size={18}
              aria-hidden="true"
              className="transition-transform duration-300 group-hover:translate-x-1"
            />
          </a>
        </div>

        <div className="relative mx-auto w-full max-w-[640px] lg:ml-auto">
          <div
            aria-hidden="true"
            className="pointer-events-none absolute -inset-6 rounded-[2rem] bg-[radial-gradient(ellipse_at_center,rgba(37,99,235,0.35),rgba(34,211,238,0.10)_50%,transparent_72%)] blur-2xl"
          />
          <div className="relative aspect-video w-full overflow-hidden rounded-3xl border border-white/[0.1] bg-black shadow-[0_30px_90px_-30px_rgba(37,99,235,0.55)]">
            <video
              ref={videoRef}
              className="h-full w-full object-cover"
              src="/videos/vimdy-ia.mp4?v=2"
              poster="/videos/vimdy-ia-poster.jpg?v=2"
              autoPlay={!reduceMotion}
              controls={reduceMotion}
              muted
              loop
              playsInline
              preload="metadata"
              aria-label="VIMDY IA: tu gerente virtual responde sobre tus ventas y tu inventario"
            />
          </div>
        </div>
      </div>
    </section>
  );
}