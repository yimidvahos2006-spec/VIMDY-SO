import { useId, useState } from "react";
import { ChevronDown, HelpCircle } from "lucide-react";

const faqs = [
  {
    question: "¿Qué es VIMDY?",
    answer:
      "VIMDY es una plataforma todo en uno para negocios de alimentos y bebidas. Integra ventas, caja, inventario, cocina, reportes y control de equipo en una sola herramienta.",
  },
  {
    question: "¿Para qué negocios sirve?",
    answer:
      "Restaurantes, cafeterías, bares, panaderías, pizzerías, food trucks y cualquier negocio de alimentos y bebidas que necesite controlar su operación.",
  },
  {
    question: "¿Necesito meseros?",
    answer:
      "No. VIMDY funciona tanto con meseros como sin ellos. Tú decides cómo opera tu negocio; nosotros nos adaptamos.",
  },
  {
    question: "¿Necesito cocina?",
    answer:
      "No. Si tu negocio no requiere preparación en cocina, puedes desactivar ese módulo y usar solo las funciones que necesitas.",
  },
  {
    question: "¿Puedo controlar inventario?",
    answer:
      "Sí. VIMDY incluye control de inventario con alertas de stock bajo, recetas para productos elaborados y trazabilidad completa.",
  },
  {
    question: "¿Cuánto cuesta?",
    answer:
      "Plan mensual: $59.900 COP/mes. Plan anual: $718.800 COP/año, sin descuento implícito.",
  },
  {
    question: "¿Qué métodos de pago acepta?",
    answer: "En Colombia: Wompi. Internacional: PayPal.",
  },
  {
    question: "¿Puedo cancelar?",
    answer:
      "Sí. Puedes cancelar tu suscripción en cualquier momento desde Configuración.",
  },
  {
    question: "¿Cómo puedo recibir soporte?",
    answer:
      "Puedes contactarnos por WhatsApp o correo electrónico. También tienes acceso a documentación y tutoriales dentro de la plataforma.",
  },
];

export function FAQ() {
  const [openIndex, setOpenIndex] = useState<number | null>(null);
  const sectionId = useId().replace(/:/g, "");

  return (
    <section
      id="faq"
      aria-labelledby={`${sectionId}-title`}
      className="relative overflow-hidden bg-[#06080b] py-24 sm:py-28 lg:py-36"
    >
      <div aria-hidden="true" className="pointer-events-none absolute inset-0">
        <div className="absolute left-1/2 top-0 h-80 w-[44rem] -translate-x-1/2 rounded-full bg-cyan-300/[0.035] blur-[120px]" />
        <div className="absolute bottom-0 right-[8%] h-72 w-72 rounded-full bg-blue-500/[0.02] blur-[110px]" />
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_0%,rgba(56,189,248,0.035),transparent_40%)]" />
        <div className="absolute inset-0 opacity-[0.08] [background-image:linear-gradient(rgba(255,255,255,0.04)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.04)_1px,transparent_1px)] [background-size:64px_64px] [mask-image:linear-gradient(to_bottom,transparent,black_18%,black_82%,transparent)]" />
      </div>

      <div className="relative mx-auto max-w-[1440px] px-5 sm:px-8 lg:px-10">
        <div className="mx-auto max-w-3xl text-center">
          <div className="inline-flex items-center gap-2 rounded-full border border-white/[0.07] bg-white/[0.025] px-3.5 py-2 text-[10px] font-semibold uppercase tracking-[0.24em] text-zinc-500">
            <HelpCircle size={13} aria-hidden="true" />
            Preguntas frecuentes
          </div>

          <h2
            id={`${sectionId}-title`}
            className="mt-7 text-balance text-4xl font-semibold tracking-[-0.04em] text-white sm:text-5xl lg:text-6xl"
          >
            Lo importante,
            <span className="block bg-gradient-to-r from-white via-zinc-200 to-cyan-200 bg-clip-text text-transparent">
              antes de empezar.
            </span>
          </h2>

          <p className="mx-auto mt-6 max-w-2xl text-base leading-7 text-zinc-400 sm:text-lg">
            Respuestas directas a las preguntas que más importan al momento de
            poner en marcha tu operación.
          </p>
        </div>

        <div className="mx-auto mt-14 max-w-4xl lg:mt-20">
          <div className="space-y-3">
            {faqs.map((faq, index) => {
              const isOpen = openIndex === index;
              const answerId = `${sectionId}-answer-${index}`;
              const buttonId = `${sectionId}-button-${index}`;

              return (
                <div
                  key={faq.question}
                  className={[
                    "overflow-hidden rounded-[22px] border",
                    "transition-[border-color,background-color,box-shadow] duration-300",
                    isOpen
                      ? "border-cyan-300/15 bg-white/[0.035] shadow-[0_20px_60px_rgba(0,0,0,0.18)]"
                      : "border-white/[0.07] bg-white/[0.018] hover:border-white/[0.11] hover:bg-white/[0.025]",
                  ].join(" ")}
                >
                  <button
                    id={buttonId}
                    type="button"
                    aria-expanded={isOpen}
                    aria-controls={answerId}
                    onClick={() => setOpenIndex(isOpen ? null : index)}
                    className="flex w-full items-center justify-between gap-5 px-5 py-5 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-cyan-300/45 sm:px-6 sm:py-6"
                  >
                    <span className="text-sm font-semibold leading-6 text-zinc-100 sm:text-[15px]">
                      {faq.question}
                    </span>

                    <span
                      aria-hidden="true"
                      className={[
                        "flex h-9 w-9 shrink-0 items-center justify-center rounded-full border",
                        "transition-[border-color,background-color,color,transform] duration-300",
                        isOpen
                          ? "border-cyan-300/20 bg-cyan-300/[0.07] text-cyan-200"
                          : "border-white/[0.08] bg-white/[0.03] text-zinc-500",
                      ].join(" ")}
                    >
                      <ChevronDown
                        size={17}
                        className={`transition-transform duration-300 ${
                          isOpen ? "rotate-180" : ""
                        }`}
                      />
                    </span>
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
                      <div className="border-t border-white/[0.06] px-5 pb-6 pt-4 sm:px-6 sm:pb-7">
                        <p className="max-w-3xl text-sm leading-7 text-zinc-500">
                          {faq.answer}
                        </p>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          <div className="mt-8 rounded-[24px] border border-white/[0.06] bg-white/[0.015] px-6 py-5 text-center sm:px-8">
            <p className="text-sm text-zinc-500">
              ¿Todavía tienes una pregunta?{" "}
              <a
                href="#contacto"
                className="font-semibold text-zinc-300 transition-colors hover:text-cyan-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/50 focus-visible:ring-offset-4 focus-visible:ring-offset-[#06080b]"
              >
                Hablemos.
              </a>
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}