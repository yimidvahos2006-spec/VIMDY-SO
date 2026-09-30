import { ArrowRight } from "lucide-react";

export function FinalCTA() {
  return (
    <section className="py-24">
      <div className="max-w-4xl mx-auto px-6 text-center">
        <h2 className="text-3xl md:text-5xl font-bold mb-6 leading-tight">
          Tu negocio merece tener el control.
        </h2>
        <p className="text-xl text-zinc-400 mb-10">
          Empieza a construir con VIMDY.
        </p>
        <a
          href="/registro"
          className="inline-flex items-center gap-2 bg-blue-600 hover:bg-blue-500 text-white font-semibold px-10 py-4 rounded-xl transition-all hover:gap-3 text-lg"
        >
          Probar VIMDY
          <ArrowRight size={20} />
        </a>
        <p className="text-zinc-500 text-sm mt-6">
          $79.000 COP / mes
        </p>
      </div>
    </section>
  );
}
