const stats = [
  { value: "Ventas", label: "Registra cada venta" },
  { value: "Caja", label: "Controla tu dinero" },
  { value: "Inventario", label: "Gestiona productos" }
];

export function TrustBar() {
  return (
    <section className="border-y border-white/5 bg-[#0B0B0D]/50">
      <div className="max-w-7xl mx-auto px-6 py-12">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-8 md:gap-4">
          {stats.map((stat, i) => (
            <div
              key={stat.value}
              className={`flex items-center justify-center gap-4 ${
                i < stats.length - 1 ? "md:border-r md:border-white/5" : ""
              }`}
            >
              <div className="text-center">
                <p className="text-2xl md:text-3xl font-bold text-white mb-1">
                  {stat.value}
                </p>
                <p className="text-sm text-zinc-500">{stat.label}</p>
              </div>
            </div>
          ))}
        </div>
        <p className="text-center text-zinc-600 text-sm mt-8">
          Todo conectado.
        </p>
      </div>
    </section>
  );
}
