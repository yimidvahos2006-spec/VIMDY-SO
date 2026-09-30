const sections = [
  {
    title: "Cuenta",
    body: "Eres responsable de mantener la confidencialidad de tu cuenta y contraseña. Debes notificarnos inmediatamente cualquier uso no autorizado.",
  },
  {
    title: "Suscripción y pagos",
    body: "VIMDY se ofrece bajo suscripción mensual o anual. Los pagos se procesan de forma segura a través de nuestros proveedores de pago. Las suscripciones se renuevan automáticamente.",
  },
  {
    title: "Cancelación",
    body: "Puedes cancelar tu suscripción en cualquier momento desde Configuración. El acceso continuará hasta el final del período pagado.",
  },
  {
    title: "Uso permitido",
    body: "Debes usar VIMDY solo para fines legales y de acuerdo con estos términos. No está permitido usar la plataforma para actividades fraudulentas o ilegales.",
  },
  {
    title: "Disponibilidad",
    body: "Esforzamos por mantener VIMDY disponible, pero no garantizamos un tiempo de actividad del 100%. Realizaremos mantenimiento programado cuando sea necesario.",
  },
  {
    title: "Propiedad intelectual",
    body: "VIMDY y su contenido son propiedad de VIMDY. No puedes copiar, modificar o distribuir el software sin autorización.",
  },
  {
    title: "Soporte",
    body: "Ofrecemos soporte por email y WhatsApp durante horarios laborales. El soporte no incluye personalización o desarrollo a medida.",
  },
  {
    title: "Suspensión y terminación",
    body: "Podemos suspender o terminar tu cuenta si violas estos términos, sin previo aviso.",
  },
  {
    title: "Contacto",
    body: "Para consultas sobre estos términos, contáctanos en hola@vimdy.co.",
  },
] as const;

export function TermsPage() {
  return (
    <div className="min-h-screen bg-transparent text-white">
      <section className="relative overflow-hidden pt-32 pb-20 sm:pt-36 sm:pb-24 lg:pt-40 lg:pb-28">
        <div aria-hidden="true" className="pointer-events-none absolute inset-0">
          <div className="absolute left-1/2 top-0 h-[26rem] w-[38rem] -translate-x-1/2 rounded-full bg-cyan-300/[0.045] blur-[120px]" />
          <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-cyan-300/15 to-transparent" />
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_8%,rgba(56,189,248,0.045),transparent_40%)]" />
        </div>

        <div className="relative mx-auto max-w-4xl px-5 sm:px-8 lg:px-10">
          <header className="max-w-3xl">
            <p className="text-[10px] font-semibold uppercase tracking-[0.28em] text-cyan-300/70">
              VIMDY
            </p>

            <h1 className="mt-5 text-balance text-4xl font-semibold tracking-[-0.045em] text-white sm:text-5xl lg:text-6xl">
              Términos y Condiciones
            </h1>

            <p className="mt-6 max-w-2xl text-base leading-7 text-zinc-400 sm:text-lg">
              Al usar VIMDY, aceptas estos términos y condiciones. Por favor,
              léelos cuidadosamente.
            </p>
          </header>

          <div className="mt-12 border-t border-white/[0.07] pt-10 sm:mt-14 sm:pt-12">
            <div className="space-y-3">
              {sections.map((section, index) => (
                <section
                  key={section.title}
                  aria-labelledby={`terms-section-${index}`}
                  className="rounded-[24px] border border-white/[0.07] bg-white/[0.018] p-6 sm:p-7"
                >
                  <div className="flex gap-5">
                    <span
                      aria-hidden="true"
                      className="mt-1 shrink-0 text-[10px] font-semibold tracking-[0.2em] text-zinc-700"
                    >
                      {String(index + 1).padStart(2, "0")}
                    </span>

                    <div className="min-w-0">
                      <h2
                        id={`terms-section-${index}`}
                        className="text-base font-semibold tracking-[-0.015em] text-white sm:text-lg"
                      >
                        {section.title}
                      </h2>

                      <p className="mt-3 text-sm leading-7 text-zinc-400">
                        {section.body}
                      </p>
                    </div>
                  </div>
                </section>
              ))}
            </div>

            <div className="mt-8 rounded-[22px] border border-cyan-300/[0.1] bg-cyan-300/[0.025] px-6 py-5 sm:px-7">
              <p className="text-xs leading-6 text-zinc-500">
                Estos términos forman parte de la información legal publicada
                por VIMDY. Antes de realizar cambios comerciales o legales,
                actualiza el contenido oficial correspondiente para mantener
                toda la información consistente.
              </p>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
