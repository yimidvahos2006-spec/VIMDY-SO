import { useEffect, useRef, useState } from "react";
import { ArrowRight } from "lucide-react";

const benefits = [
  {
    title: "Cualquier categoría, sin límites",
    text: "Crea las tuyas en segundos. Sirve para restaurantes, cafeterías, panaderías y tiendas.",
  },
  {
    title: "Ventas, inventario y ganancias en un solo lugar",
    text: "Sabes qué vendes, qué te queda y cuánto ganas de verdad.",
  },
  {
    title: "Sigue vendiendo aunque falle el internet",
    text: "Las ventas se guardan y se sincronizan solas cuando vuelve la conexión.",
  },
] as const;

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
      <div className="mx-auto grid max-w-6xl items-center gap-12 px-6 py-24 sm:px-8 lg:grid-cols-[1fr_0.85fr] lg:gap-16 lg:px-10">
        <div>
          <h2
            id="categorias-title"
            className="text-balance text-3xl font-semibold tracking-[-0.035em] text-white sm:text-4xl lg:text-5xl"
          >
            Tu negocio no es de plantilla. Tu sistema tampoco.
          </h2>

          <p className="mt-6 max-w-xl text-base leading-7 text-zinc-300 sm:text-lg">
            En VIMDY escribes las categorías que usas de verdad. Empanadas,
            tamales, granizados, churros, licores: lo que vendas, así lo
            organizas.
          </p>

          <ul className="mt-8 grid gap-5">
            {benefits.map((benefit) => (
              <li
                key={benefit.title}
                className="max-w-xl border-l-2 border-cyan-300/70 pl-4"
              >
                <p className="text-base font-semibold text-white">
                  {benefit.title}
                </p>
                <p className="mt-1 text-sm leading-6 text-zinc-400">
                  {benefit.text}
                </p>
              </li>
            ))}
          </ul>

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

        <div className="mx-auto aspect-[4/5] w-full max-w-[460px] overflow-hidden rounded-3xl border border-white/[0.08] bg-black shadow-[0_30px_90px_-30px_rgba(37,99,235,0.45)] lg:ml-auto">
          <video
            ref={videoRef}
            className="h-full w-full object-cover"
            src="/videos/vimdy-categorias.mp4"
            autoPlay={!reduceMotion}
            controls={reduceMotion}
            muted
            loop
            playsInline
            preload="metadata"
            aria-label="Cómo se crean categorías propias en VIMDY"
          />
        </div>
      </div>
    </section>
  );
}