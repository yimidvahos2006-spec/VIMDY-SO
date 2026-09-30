const businessTypes = [
  { emoji: "🍔", name: "Restaurantes" },
  { emoji: "☕", name: "Cafeterías" },
  { emoji: "🍺", name: "Bares" },
  { emoji: "🥐", name: "Panaderías" },
  { emoji: "🌮", name: "Comida rápida" },
  { emoji: "🍕", name: "Pizzerías" },
  { emoji: "🍽️", name: "Otros negocios" }
];

export function BusinessTypes() {
  return (
    <section id="soluciones" className="py-24 bg-[#0B0B0D]/30">
      <div className="max-w-7xl mx-auto px-6">
        <div className="text-center max-w-2xl mx-auto mb-16">
          <h2 className="text-3xl md:text-4xl font-bold mb-4">
            VIMDY se adapta a tu negocio
          </h2>
          <p className="text-zinc-400 text-lg">
            Diseñado para negocios de alimentos y bebidas que necesitan control, sin complicaciones.
          </p>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
          {businessTypes.map((type) => (
            <div
              key={type.name}
              className="bg-[#111114] border border-white/5 rounded-xl p-6 text-center hover:border-white/10 transition-all duration-300 hover:translate-y-[-2px]"
            >
              <span className="text-4xl mb-3 block">{type.emoji}</span>
              <p className="text-sm font-medium text-zinc-300">{type.name}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
