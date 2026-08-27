import { useState } from "react";
import { ChevronDown } from "lucide-react";

const faqs = [
  {
    question: "¿Qué es VIMDY?",
    answer: "VIMDY es una plataforma todo en uno para negocios de alimentos y bebidas. Integra ventas, caja, inventario, cocina, reportes y control de equipo en una sola herramienta."
  },
  {
    question: "¿Para qué negocios sirve?",
    answer: "Restaurantes, cafeterías, bares, panaderías, pizzerías, food trucks y cualquier negocio de alimentos y bebidas que necesite controlar su operación."
  },
  {
    question: "¿Necesito meseros?",
    answer: "No. VIMDY funciona tanto con meseros como sin ellos. Tú decides cómo opera tu negocio; nosotros nos adaptamos."
  },
  {
    question: "¿Necesito cocina?",
    answer: "No. Si tu negocio no requiere preparación en cocina, puedes desactivar ese módulo y usar solo las funciones que necesitas."
  },
  {
    question: "¿Puedo controlar inventario?",
    answer: "Sí. VIMDY incluye control de inventario con alertas de stock bajo, recetas para productos elaborados y trazabilidad completa."
  },
  {
    question: "¿Puedo trabajar sin internet?",
    answer: "Sí. VIMDY funciona offline y sincroniza automáticamente cuando recuperas la conexión."
  },
  {
    question: "¿Cuánto cuesta?",
    answer: "Plan mensual: $79.000 COP/mes. Plan anual: $799.000 COP/año (ahorras $149.000)."
  },
  {
    question: "¿Qué métodos de pago acepta?",
    answer: "En Colombia: Wompi. Internacional: PayPal."
  },
  {
    question: "¿Puedo cancelar?",
    answer: "Sí. Puedes cancelar tu suscripción en cualquier momento desde Configuración."
  },
  {
    question: "¿Cómo puedo recibir soporte?",
    answer: "Puedes contactarnos por WhatsApp o correo electrónico. También tienes acceso a documentación y tutoriales dentro de la plataforma."
  }
];

export function FAQ() {
  const [openIndex, setOpenIndex] = useState<number | null>(null);

  return (
    <section id="faq" className="py-24 bg-[#0B0B0D]/30">
      <div className="max-w-3xl mx-auto px-6">
        <div className="text-center mb-16">
          <h2 className="text-3xl md:text-4xl font-bold mb-4">
            Preguntas frecuentes
          </h2>
        </div>

        <div className="space-y-3">
          {faqs.map((faq, i) => (
            <div
              key={i}
              className="bg-[#111114] border border-white/5 rounded-xl overflow-hidden"
            >
              <button
                onClick={() => setOpenIndex(openIndex === i ? null : i)}
                className="w-full flex items-center justify-between p-5 text-left"
              >
                <span className="text-sm font-medium text-white pr-4">
                  {faq.question}
                </span>
                <ChevronDown
                  size={18}
                  className={`text-zinc-500 transition-transform duration-200 flex-shrink-0 ${
                    openIndex === i ? "rotate-180" : ""
                  }`}
                />
              </button>
              {openIndex === i && (
                <div className="px-5 pb-5">
                  <p className="text-sm text-zinc-400 leading-relaxed">
                    {faq.answer}
                  </p>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
