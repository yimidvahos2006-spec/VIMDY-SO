const capabilities = [
  "Ventas",
  "Caja",
  "Inventario",
  "Cocina",
  "Mesas",
  "Clientes",
  "Reportes",
  "IA",
] as const;

export function TrustBar() {
  return (
    <section
      aria-labelledby="vimdy-capabilities-title"
      className="relative overflow-hidden border-y border-white/[0.06] bg-[#06080b]"
    >
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_50%_0%,rgba(56,189,248,0.08),transparent_40%)]"
      />

      <div className="relative mx-auto max-w-[1440px] px-5 sm:px-8 lg:px-10">
        <div className="flex flex-col gap-6 py-7 md:flex-row md:items-center md:justify-between md:py-8">
          <div className="max-w-sm shrink-0">
            <p className="text-[10px] font-semibold uppercase tracking-[0.28em] text-cyan-300/70">
              Una sola operación
            </p>

            <h2
              id="vimdy-capabilities-title"
              className="mt-1 text-sm font-semibold tracking-[-0.015em] text-zinc-200"
            >
              Todo conectado. Todo visible.
            </h2>

            <p className="mt-1.5 text-xs leading-5 text-zinc-500">
              Algunas de las áreas que forman parte de la experiencia VIMDY.
            </p>
          </div>

          <div className="relative min-w-0 flex-1 md:ml-10">
            <div
              aria-hidden="true"
              className="pointer-events-none absolute inset-y-0 left-0 z-10 w-10 bg-gradient-to-r from-[#06080b] to-transparent"
            />
            <div
              aria-hidden="true"
              className="pointer-events-none absolute inset-y-0 right-0 z-10 w-10 bg-gradient-to-l from-[#06080b] to-transparent"
            />

            <div
              role="list"
              aria-label="Áreas de VIMDY"
              className="flex gap-2 overflow-x-auto pb-1 pr-8 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
            >
              {capabilities.map((capability) => (
                <div
                  key={capability}
                  role="listitem"
                  className="group flex min-h-10 shrink-0 items-center gap-2 rounded-full border border-white/[0.07] bg-white/[0.025] px-3.5 py-2 transition-[border-color,background-color,transform] duration-300 hover:-translate-y-px hover:border-cyan-300/20 hover:bg-white/[0.05]"
                >
                  <span
                    aria-hidden="true"
                    className="h-1.5 w-1.5 rounded-full bg-cyan-300/70 shadow-[0_0_12px_rgba(103,232,249,0.35)] transition-[background-color,box-shadow] duration-300 group-hover:bg-cyan-200 group-hover:shadow-[0_0_16px_rgba(103,232,249,0.65)]"
                  />

                  <span className="text-xs font-medium text-zinc-400 transition-colors duration-300 group-hover:text-zinc-100">
                    {capability}
                  </span>
                </div>
              ))}
            </div>

            <p className="mt-2 text-[10px] font-medium uppercase tracking-[0.18em] text-zinc-600 md:hidden">
              Desliza para explorar
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}
