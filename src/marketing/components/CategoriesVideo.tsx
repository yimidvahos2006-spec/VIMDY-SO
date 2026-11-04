import { useState } from "react";
import { ArrowRight, Sparkles, Mic, Bot, TrendingUp, PackageCheck } from "lucide-react";

const aiQueries = [
  {
    id: "ventas",
    label: "¿Cuánto vendió la caja hoy?",
    icon: TrendingUp,
    response: "Ventas totales al momento: $2.450.000 COP (84 órdenes). Caja principal cuadrada sin diferencias. ¡Excelente ritmo de servicio!",
    badge: "Caja en Vivo"
  },
  {
    id: "inventario",
    label: "¿Qué insumos están bajos?",
    icon: PackageCheck,
    response: "Alerta de inventario: El queso mozzarella está al 12% (aprox. 1.5 kg). Se recomienda programar reposición con proveedor antes de la cena.",
    badge: "Stock Inteligente"
  },
  {
    id: "utilidad",
    label: "¿Cuál es la Utilidad Real?",
    icon: Bot,
    response: "Utilidad Neta Real estimada de la semana: $4.120.000 COP (descontando costo de insumos, arriendo y nómina registrada). Margen saludable.",
    badge: "Contabilidad Gerencial"
  }
];

export function CategoriesVideo() {
  const [activeQuery, setActiveQuery] = useState(aiQueries[0]);

  return (
    <section
      id="categorias"
      aria-labelledby="categorias-title"
      className="scroll-mt-24 border-y border-white/[0.06] bg-gradient-to-b from-slate-950 via-slate-900/40 to-slate-950 py-24 relative overflow-hidden"
    >
      {/* Luz ambiental de fondo */}
      <div aria-hidden="true" className="pointer-events-none absolute inset-0">
        <div className="absolute left-1/2 top-1/2 h-[400px] w-[400px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-cyan-500/[0.05] blur-[130px]" />
      </div>

      <div className="mx-auto grid max-w-7xl items-center gap-12 px-6 sm:px-8 lg:grid-cols-[0.9fr_1.1fr] lg:gap-14 lg:px-10 relative z-10">
        <div>
          <div className="inline-flex items-center gap-2 rounded-full border border-cyan-300/20 bg-cyan-300/[0.08] px-3.5 py-1.5 text-xs font-bold uppercase tracking-[0.25em] text-cyan-300 shadow-lg shadow-cyan-500/10 mb-6">
            <Sparkles size={14} /> VIMDY IA Manager
          </div>

          <h2
            id="categorias-title"
            className="text-balance text-3xl font-black tracking-[-0.035em] text-white sm:text-4xl lg:text-5xl leading-tight"
          >
            Tu restaurante no necesita otro sistema lento. <span className="text-transparent bg-clip-text bg-gradient-to-r from-cyan-400 to-emerald-400">Necesita un gerente que hable, mande y cuide cada peso.</span> 🚀
          </h2>

          <p className="mt-6 max-w-xl text-base leading-relaxed text-zinc-300 sm:text-lg">
            Olvídate de abrir Excel a medianoche, adivinar por qué no cuadra la caja o perderte buscando menús en pantallas aburridas. Con <span className="font-bold text-white">VIMDY IA</span> tienes un asistente operativo con el que hablas de frente, que vigila tu bodega y te dice la verdad de tu negocio en milisegundos.
          </p>

          <a
            href="#precios"
            className="group mt-10 inline-flex items-center justify-center gap-3 rounded-2xl bg-gradient-to-r from-cyan-400 to-emerald-400 px-8 py-4 text-sm font-black text-slate-950 transition-all duration-300 hover:scale-105 shadow-xl shadow-cyan-400/20 uppercase tracking-wider"
          >
            Probar 14 días gratis
            <ArrowRight
              size={18}
              aria-hidden="true"
              className="transition-transform duration-300 group-hover:translate-x-1"
            />
          </a>
        </div>

        {/* Simulador Interactivo de IA en Vivo */}
        <div className="relative mx-auto w-full max-w-[640px] lg:ml-auto">
          <div
            aria-hidden="true"
            className="pointer-events-none absolute -inset-4 rounded-[2rem] bg-gradient-to-r from-cyan-500/10 to-blue-500/10 blur-2xl"
          />
          <div className="relative rounded-[28px] border border-cyan-500/30 bg-slate-950/90 p-6 sm:p-8 backdrop-blur-2xl shadow-[0_30px_90px_-20px_rgba(56,189,248,0.25)]">
            
            {/* Cabecera del simulador */}
            <div className="flex items-center justify-between pb-6 border-b border-slate-800">
              <div className="flex items-center gap-3">
                <div className="h-10 w-10 rounded-2xl bg-cyan-500/10 border border-cyan-400/30 flex items-center justify-center text-cyan-400 shadow-inner">
                  <Bot size={22} />
                </div>
                <div>
                  <h4 className="text-sm font-bold text-white flex items-center gap-2">
                    VIMDY IA <span className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse" />
                  </h4>
                  <p className="text-[11px] text-zinc-400">Asistente Operativo y Gerencial</p>
                </div>
              </div>
              <span className="text-[10px] font-bold text-cyan-300 bg-cyan-950/80 px-3 py-1 rounded-full border border-cyan-500/30 uppercase tracking-widest flex items-center gap-1.5">
                <Mic size={12} className="animate-pulse text-cyan-400" /> Voz activa
              </span>
            </div>

            {/* Preguntas de ejemplo interactivas */}
            <div className="mt-6 space-y-3">
              <p className="text-xs font-semibold text-zinc-400 uppercase tracking-wider">Prueba preguntarle a la IA:</p>
              <div className="grid gap-2">
                {aiQueries.map((q) => {
                  const Icon = q.icon;
                  const isSelected = activeQuery.id === q.id;
                  return (
                    <button
                      key={q.id}
                      onClick={() => setActiveQuery(q)}
                      className={`w-full text-left px-4 py-3 rounded-2xl border transition-all duration-300 flex items-center justify-between group ${
                        isSelected
                          ? "border-cyan-400 bg-cyan-950/30 text-white shadow-lg shadow-cyan-500/10"
                          : "border-white/[0.06] bg-slate-900/60 text-zinc-300 hover:border-cyan-500/30 hover:bg-slate-900"
                      }`}
                    >
                      <div className="flex items-center gap-3">
                        <Icon size={16} className={isSelected ? "text-cyan-400" : "text-zinc-500 group-hover:text-cyan-300"} />
                        <span className="text-xs font-medium">{q.label}</span>
                      </div>
                      <span className={`text-[10px] font-bold px-2 py-0.5 rounded-md ${
                        isSelected ? "bg-cyan-500/20 text-cyan-300 border border-cyan-500/30" : "bg-slate-800 text-zinc-500"
                      }`}>
                        {q.badge}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Caja de respuesta simulada */}
            <div className="mt-6 rounded-2xl border border-cyan-500/20 bg-slate-900/80 p-4 sm:p-5 relative overflow-hidden">
              <div className="absolute top-0 left-0 right-0 h-[2px] bg-gradient-to-r from-cyan-400 via-emerald-400 to-transparent" />
              <div className="flex items-start gap-3">
                <div className="mt-0.5 p-2 rounded-xl bg-cyan-500/10 text-cyan-400 shrink-0">
                  <Sparkles size={16} />
                </div>
                <div className="space-y-1">
                  <span className="text-[10px] font-bold tracking-widest text-cyan-300 uppercase">Respuesta de VIMDY IA</span>
                  <p className="text-xs sm:text-sm text-zinc-200 leading-relaxed">
                    "{activeQuery.response}"
                  </p>
                </div>
              </div>
            </div>

          </div>
        </div>

      </div>
    </section>
  );
}