import { ArrowRight, Mail, MessageCircle, ShieldCheck } from "lucide-react";
import { VIMDY_CONTACT } from "../../core/config/contact";

const contactOptions = [
  {
    title: "Correo electrónico",
    value: VIMDY_CONTACT.email.support,
    description:
      "Escríbenos para resolver preguntas, solicitar información o conversar sobre VIMDY.",
    href: `mailto:${VIMDY_CONTACT.email.support}`,
    icon: Mail,
    action: "Enviar correo",
  },
  {
    title: "WhatsApp",
    value: VIMDY_CONTACT.whatsapp.number,
    description:
      "Habla directamente con VIMDY a través del canal de WhatsApp actualmente publicado.",
    href: VIMDY_CONTACT.whatsapp.link,
    icon: MessageCircle,
    action: "Abrir WhatsApp",
  },
];

export function ContactPage() {
  return (
    <div className="min-h-screen overflow-x-clip bg-transparent text-white">
      <main>
        <section
          aria-labelledby="contact-page-title"
          className="relative overflow-hidden pb-24 pt-36 sm:pb-28 sm:pt-40 lg:pb-36"
        >
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-0"
          >
            <div className="absolute left-1/2 top-0 h-[34rem] w-[42rem] -translate-x-1/2 rounded-full bg-cyan-300/[0.05] blur-[130px]" />
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_8%,rgba(56,189,248,0.055),transparent_42%)]" />
            <div className="absolute inset-0 opacity-[0.09] [background-image:linear-gradient(rgba(255,255,255,0.04)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.04)_1px,transparent_1px)] [background-size:72px_72px] [mask-image:radial-gradient(circle_at_center,black,transparent_74%)]" />
          </div>

          <div className="relative mx-auto max-w-[1440px] px-5 sm:px-8 lg:px-10">
            <div className="mx-auto max-w-4xl text-center">
              <div className="inline-flex items-center rounded-full border border-white/[0.07] bg-white/[0.025] px-3.5 py-2 text-[10px] font-semibold uppercase tracking-[0.25em] text-zinc-500">
                Contacto oficial
              </div>

              <h1
                id="contact-page-title"
                className="mt-7 text-balance text-5xl font-semibold tracking-[-0.05em] text-white sm:text-6xl lg:text-7xl"
              >
                Hablemos de
                <span className="block bg-gradient-to-r from-white via-zinc-200 to-cyan-200 bg-clip-text text-transparent">
                  tu negocio.
                </span>
              </h1>

              <p className="mx-auto mt-6 max-w-2xl text-base leading-7 text-zinc-400 sm:text-lg">
                ¿Tienes preguntas sobre VIMDY? Utiliza uno de nuestros canales
                oficiales para comunicarte con nosotros.
              </p>
            </div>

            <div className="mx-auto mt-14 grid max-w-5xl gap-4 lg:mt-20 lg:grid-cols-2">
              {contactOptions.map((option) => {
                const Icon = option.icon;
                const external = option.href.startsWith("https://");

                return (
                  <a
                    key={option.title}
                    href={option.href}
                    target={external ? "_blank" : undefined}
                    rel={external ? "noopener noreferrer" : undefined}
                    className="group relative overflow-hidden rounded-[30px] border border-white/[0.07] bg-white/[0.018] p-7 transition-[transform,border-color,background-color,box-shadow] duration-500 hover:-translate-y-1 hover:border-cyan-300/20 hover:bg-white/[0.035] hover:shadow-[0_24px_80px_rgba(0,0,0,0.28)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/50 focus-visible:ring-offset-4 focus-visible:ring-offset-[#05070a] sm:p-8"
                  >
                    <div
                      aria-hidden="true"
                      className="absolute -right-16 -top-16 h-44 w-44 rounded-full bg-cyan-300/[0.06] blur-3xl transition-colors duration-500 group-hover:bg-cyan-300/[0.11]"
                    />

                    <div className="relative flex items-start justify-between gap-5">
                      <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-white/[0.08] bg-white/[0.03] text-cyan-200/80 transition-[transform,border-color,color] duration-300 group-hover:-translate-y-px group-hover:border-cyan-300/20 group-hover:text-cyan-100">
                        <Icon size={21} strokeWidth={1.7} aria-hidden="true" />
                      </div>

                      <ArrowRight
                        size={18}
                        aria-hidden="true"
                        className="mt-2 text-zinc-700 transition-[transform,color] duration-300 group-hover:translate-x-1 group-hover:text-cyan-200/70"
                      />
                    </div>

                    <h2 className="relative mt-7 text-xl font-semibold tracking-[-0.025em] text-white">
                      {option.title}
                    </h2>

                    <p className="relative mt-2 text-sm leading-6 text-zinc-500">
                      {option.description}
                    </p>

                    <div className="relative mt-6 rounded-2xl border border-white/[0.06] bg-black/20 px-4 py-3.5">
                      <p className="break-all text-sm font-medium text-zinc-200 sm:break-normal">
                        {option.value}
                      </p>
                    </div>

                    <div className="relative mt-6 text-xs font-semibold uppercase tracking-[0.18em] text-cyan-200/65">
                      {option.action} →
                    </div>
                  </a>
                );
              })}
            </div>

            <div className="mx-auto mt-8 max-w-5xl rounded-[28px] border border-white/[0.06] bg-white/[0.015] p-6 sm:p-7">
              <div className="flex items-start gap-3">
                <ShieldCheck
                  size={18}
                  className="mt-0.5 shrink-0 text-cyan-200/65"
                  aria-hidden="true"
                />
                <div>
                  <h2 className="text-sm font-semibold text-zinc-200">
                    Información de contacto centralizada
                  </h2>
                  <p className="mt-1 text-sm leading-6 text-zinc-500">
                    La dirección de correo y el número de WhatsApp de esta página
                    provienen de la configuración de contacto de VIMDY, para
                    evitar duplicar datos comerciales directamente en el código.
                  </p>
                </div>
              </div>
            </div>

            <div className="mx-auto mt-8 flex max-w-5xl flex-col gap-4 rounded-[28px] border border-white/[0.06] bg-white/[0.012] p-6 sm:flex-row sm:items-center sm:justify-between sm:px-7">
              <div>
                <p className="text-sm font-medium text-zinc-200">
                  ¿Ya estás listo para conocer VIMDY?
                </p>
                <p className="mt-1 text-xs leading-5 text-zinc-500">
                  Puedes comenzar el proceso de registro desde la plataforma.
                </p>
              </div>

              <a
                href="/registro"
                className="inline-flex shrink-0 items-center justify-center gap-2 rounded-full bg-white px-5 py-3 text-sm font-semibold text-black transition-[transform,background-color] duration-300 hover:-translate-y-px hover:bg-zinc-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/50 focus-visible:ring-offset-4 focus-visible:ring-offset-[#05070a]"
              >
                Empezar con VIMDY
                <ArrowRight size={16} aria-hidden="true" />
              </a>
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}
