const steps = [
  { number: "01", title: "Crea tu cuenta", description: "Regístrate en segundos y crea tu negocio." },
  { number: "02", title: "Configura tu operación", description: "Agrega productos, personaliza tu caja e inventario." },
  { number: "03", title: "Empieza a vender", description: "Registra ventas, controla caja y ve crecer tu negocio." }
];

export function HowItWorks() {
  return (
    <section id="como-funciona" className="py-24">
      <div className="max-w-7xl mx-auto px-6">
        <div className="text-center max-w-2xl mx-auto mb-16">
          <h2 className="text-3xl md:text-4xl font-bold mb-4">
            Cómo funciona
          </h2>
          <p className="text-zinc-400 text-lg">
            En tres pasos estás operando con VIMDY.
          </p>
        </div>

        <div className="grid md:grid-cols-3 gap-8 max-w-4xl mx-auto">
          {steps.map((step, i) => (
            <div key={step.number} className="relative">
              <div className="text-center">
                <span className="text-6xl font-bold text-blue-600/20 mb-4 block">
                  {step.number}
                </span>
                <h3 className="text-lg font-semibold text-white mb-2">
                  {step.title}
                </h3>
                <p className="text-sm text-zinc-400 leading-relaxed">
                  {step.description}
                </p>
              </div>
              {i < steps.length - 1 && (
                <div className="hidden md:block absolute top-1/2 -right-4 transform -translate-y-1/2">
                  <div className="w-8 h-px bg-gradient-to-r from-blue-600/50 to-transparent" />
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
