import { useId, useState } from "react";
import { ChevronDown, HelpCircle, Sparkles } from "lucide-react";
import { MULTI_BRANCH_ANSWER, PRICING_SUMMARY } from "../pricingCopy";

const faqs = [
  {
    category: "Operación y Sistema",
    question: "¿Cuál es el mejor sistema POS y contable para restaurantes en Colombia?",
    answer:
      "VIMDY está hecho específicamente para restaurantes y negocios de alimentos y bebidas en Colombia. En una sola plataforma reúne POS con caja y turnos, KDS de cocina en tiempo real, inventario de insumos y contabilidad gerencial con Utilidad Neta Real (ventas menos costo de insumos menos gastos fijos, nómina incluida). Sigue vendiendo si falla el internet del local, no tiene contratos amarrados, se paga en pesos colombianos con Wompi y tiene 14 días de prueba gratis sin tarjeta.",
  },
  {
    category: "General",
    question: "¿Qué es VIMDY?",
    answer:
      "VIMDY es una plataforma todo en uno para negocios de alimentos y bebidas. Integra ventas, caja, inventario, cocina, reportes y control de equipo en una sola herramienta diseñada para que ganes dinero y no dolores de cabeza.",
  },
  {
    category: "Operación",
    question: "¿Para qué negocios sirve?",
    answer:
      "Restaurantes, cafeterías, bares, panaderías, pizzerías, food trucks y cualquier negocio de alimentos y bebidas que necesite controlar su operación real.",
  },
  {
    category: "Servicio",
    question: "¿Necesito meseros?",
    answer:
      "No. VIMDY funciona tanto con meseros en mesa como sin ellos (modalidad mesón o POS Flash). Tú decides cómo opera tu negocio; nosotros nos adaptamos.",
  },
  {
    category: "Cocina",
    question: "¿Necesito cocina?",
    answer:
      "No. Si tu negocio no requiere preparación en cocina, puedes desactivar ese módulo y usar solo las funciones de caja y ventas que necesitas.",
  },
  {
    category: "Inventario y Costos",
    question: "¿Puedo controlar inventario?",
    answer:
      "Sí. VIMDY incluye control de inventario con alertas de stock bajo, recetas por gramaje para productos elaborados y un historial completo de movimientos para evitar mermas.",
  },
  {
    category: "Prueba y Planes",
    question: "¿Hay prueba gratis?",
    answer:
      "Sí. Tienes 14 días de prueba con acceso total, sin tarjeta de crédito. Al terminar eliges el plan que mejor se adapte para seguir usando VIMDY.",
  },
  {
    category: "Precios",
    question: "¿Cuánto cuesta?",
    answer: PRICING_SUMMARY,
  },
  {
    category: "Multi-sede",
    question: "¿Puedo manejar varias sedes?",
    answer: MULTI_BRANCH_ANSWER,
  },
  {
    category: "Pagos y Seguridad",
    question: "¿Qué métodos de pago acepta?",
    answer:
      "Los pagos se procesan de forma segura con Wompi, en pesos colombianos (COP). Además, contamos con Radar Antifraude para billetes y transferencias (Nequi, Daviplata). No hacemos cobros automáticos: tú renuevas tu plan cuando quieras.",
  },
  {
    category: "Garantía",
    question: "¿Puedo cancelar?",
    answer:
      "Sí. No hay cobro automático: si no renuevas, tu plan termina al final del período pagado. Y si pagas y en los primeros 7 días no te convence, te devolvemos el 100% de tu dinero.",
  },
  {
    category: "Soporte",
    question: "¿Cómo puedo recibir soporte?",
    answer:
      "Puedes contactarnos por WhatsApp o correo electrónico de forma prioritaria. También tienes acceso a documentación y tutoriales directamente dentro de la plataforma.",
  },
];

export function FAQ() {
  const [openIndex, setOpenIndex] = useState<number | null>(0);
  const sectionId = useId().replace(/:/g, "");

  return (
    <section
      id="faq"
      aria-labelledby={`${sectionId}-title`}
      className="relative overflow-hidden bg-[#06080b] py-24 sm:py-28 lg:py-36"
    >
      {/* Luces ambientales de fondo */}
      <div aria-hidden="true" className="pointer-events-none absolute inset-0">
        <div className="absolute left-1/2 top-0 h-80 w-[44rem] -translate-x-1/2 rounded-full bg-cyan-400/[0.04] blur-[130px]" />
        <div className="absolute bottom-0 right-[8%] h-72 w-72 rounded-full bg-blue-500/[0.025] blur-[120px]" />
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_0%,rgba(56,189,248,0.04),transparent_40%)]" />
      </div>

      <div className="relative mx-auto max-w-[1440px] px-5 sm:px-8 lg:px-10">
        
        {/* Encabezado */}
        <div className="mx-auto max-w-3xl text-center">
          <div className="inline-flex items-center gap-2 rounded-full border border-cyan-300/20 bg-cyan-300/[0.08] px-4 py-2 text-xs font-bold uppercase tracking-[0.25em] text-cyan-300 shadow-lg shadow-cyan-500/10 backdrop-blur-md">
            <Sparkles size={14} aria-hidden="true" />
            Preguntas frecuentes
          </div>

          <h2
            id={`${sectionId}-title`}
            className="mt-7 text-balance text-4xl font-black tracking-[-0.04em] text-white sm:text-5xl lg:text-6xl"
          >
            Lo importante,
            <span className="block bg-gradient-to-r from-cyan-400 via-teal-300 to-emerald-400 bg-clip-text text-transparent mt-1">
              antes de empezar.
            </span>
          </h2>

          <p className="mx-auto mt-6 max-w-2xl text-base leading-relaxed text-zinc-300 sm:text-lg">
            Respuestas directas y claras a las preguntas que más importan al momento de poner en marcha tu operación con VIMDY.
          </p>
        </div>

        {/* Lista de Preguntas */}
        <div className="mx-auto mt-14 max-w-4xl lg:mt-20">
          <div className="space-y-3.5">
            {faqs.map((faq, index) => {
              const isOpen = openIndex === index;
              const answerId = `${sectionId}-answer-${index}`;
              const buttonId = `${sectionId}-button-${index}`;

              return (
                <div
                  key={faq.question}
                  className={[
                    "overflow-hidden rounded-[24px] border transition-all duration-300 backdrop-blur-xl",
                    isOpen
                      ? "border-cyan-400/50 bg-slate-900/90 shadow-xl shadow-cyan-500/10"
                      : "border-white/[0.08] bg-slate-900/40 hover:border-cyan-500/30 hover:bg-slate-900/60",
                  ].join(" ")}
                >
                  <button
                    id={buttonId}
                    type="button"
                    aria-expanded={isOpen}
                    aria-controls={answerId}
                    onClick={() => setOpenIndex(isOpen ? null : index)}
                    className="flex w-full items-center justify-between gap-5 px-6 py-5 text-left focus-visible:outline-none sm:px-8 sm:py-6"
                  >
                    <div className="flex items-center gap-3.5">
                      <HelpCircle size={18} className={`shrink-0 transition-colors ${isOpen ? "text-cyan-400" : "text-zinc-500"}`} />
                      <span className="text-base font-bold text-white sm:text-lg">
                        {faq.question}
                      </span>
                    </div>

                    <div
                      aria-hidden="true"
                      className={[
                        "flex h-9 w-9 shrink-0 items-center justify-center rounded-full border transition-all duration-300",
                        isOpen
                          ? "border-cyan-400/40 bg-cyan-500/10 text-cyan-400 rotate-180"
                          : "border-white/10 bg-white/5 text-zinc-400",
                      ].join(" ")}
                    >
                      <ChevronDown size={17} />
                    </div>
                  </button>

                  <div
                    id={answerId}
                    role="region"
                    aria-labelledby={buttonId}
                    className={`grid transition-[grid-template-rows,opacity] duration-300 ease-out ${
                      isOpen
                        ? "grid-rows-[1fr] opacity-100"
                        : "grid-rows-[0fr] opacity-0"
                    }`}
                  >
                    <div className="min-h-0 overflow-hidden">
                      <div className="border-t border-slate-800 px-6 pb-6 pt-4 sm:px-8 sm:pb-7">
                        <p className="max-w-3xl text-sm leading-relaxed text-zinc-300 sm:text-base">
                          {faq.answer}
                        </p>
                        <div className="mt-5">
                          <span className="inline-block rounded-full bg-cyan-950/80 border border-cyan-500/30 px-3 py-1 text-[10px] font-bold uppercase tracking-widest text-cyan-300">
                            {faq.category}
                          </span>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Banner inferior de contacto */}
          <div className="mt-10 rounded-[28px] border border-white/[0.08] bg-slate-900/40 px-6 py-6 text-center sm:px-8 backdrop-blur-md">
            <p className="text-sm font-medium text-zinc-300">
              ¿Todavía tienes una pregunta específica sobre tu negocio?{" "}
              <a
                href="#contacto"
                className="font-bold text-cyan-300 underline underline-offset-4 transition-colors hover:text-white"
              >
                Hablemos por WhatsApp.
              </a>
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}