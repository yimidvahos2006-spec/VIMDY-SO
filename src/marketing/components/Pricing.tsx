import { Check } from "lucide-react";

const plans = [
  {
    id: "monthly",
    name: "Mensual",
    price: "$79.000",
    period: "/ mes",
    cta: "Comenzar",
    highlighted: false
  },
  {
    id: "yearly",
    name: "Anual",
    price: "$799.000",
    period: "/ año",
    cta: "Comenzar",
    highlighted: true,
    savings: "Ahorras $149.000"
  }
];

export function Pricing() {
  return (
    <section id="precios" className="py-24">
      <div className="max-w-7xl mx-auto px-6">
        <div className="text-center max-w-2xl mx-auto mb-16">
          <h2 className="text-3xl md:text-4xl font-bold mb-4">
            Empieza a trabajar con VIMDY
          </h2>
          <p className="text-zinc-400 text-lg">
            Sin contratos largos. Sin sorpresas.
          </p>
        </div>

        <div className="grid md:grid-cols-2 gap-6 max-w-3xl mx-auto">
          {plans.map((plan) => (
            <div
              key={plan.id}
              className={`glass-card relative rounded-2xl border p-8 ${
                plan.highlighted
                  ? "border-blue-500/30 shadow-2xl shadow-blue-600/5"
                  : "border-white/5"
              }`}
            >
              {plan.highlighted && plan.savings && (
                <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                  <span className="bg-gradient-to-r from-blue-600 to-blue-500 text-white text-xs font-semibold px-3 py-1 rounded-full shadow-lg shadow-blue-600/20">
                    {plan.savings}
                  </span>
                </div>
              )}

              <div className="text-center mb-6">
                <h3 className="text-lg font-semibold text-white mb-2">
                  {plan.name}
                </h3>
                <div className="flex items-baseline justify-center gap-1">
                  <span className="text-4xl font-bold text-white">{plan.price}</span>
                  <span className="text-zinc-500">{plan.period}</span>
                </div>
              </div>

              <a
                href="/registro"
                className={`block w-full text-center font-semibold py-3 rounded-xl transition-all duration-300 ${
                  plan.highlighted
                    ? "bg-blue-600 hover:bg-blue-500 text-white shadow-lg shadow-blue-600/20"
                    : "bg-white/5 hover:bg-white/10 border border-white/10 text-white hover:border-white/20"
                }`}
              >
                {plan.cta} →
              </a>
            </div>
          ))}
        </div>

        <div className="text-center mt-8">
          <a href="/contacto" className="text-sm text-zinc-500 hover:text-white transition-colors">
            ¿Necesitas ayuda para elegir? → VIMDY Assistant
          </a>
        </div>
      </div>
    </section>
  );
}
