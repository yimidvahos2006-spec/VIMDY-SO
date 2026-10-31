import { LEGAL_INFO } from "../legal/legalInfo";
import { TERMS_PRICING_BODY } from "../pricingCopy";

const sections = [
  {
    title: "Quién ofrece VIMDY",
    body: `VIMDY es ofrecido por ${LEGAL_INFO.responsable}, ${LEGAL_INFO.calidad}, con domicilio en ${LEGAL_INFO.domicilio}. Puedes escribirnos a ${LEGAL_INFO.email} o por WhatsApp al ${LEGAL_INFO.whatsapp}.`,
  },
  {
    title: "Qué es VIMDY y qué no es",
    body: "VIMDY es un software en línea para gestionar ventas, caja, inventario, cocina y reportes de tu negocio. No es asesoría contable, tributaria ni legal. Las cifras, alertas y respuestas de VIMDY IA son una ayuda y pueden contener errores: revísalas antes de tomar decisiones. Tú sigues siendo responsable de tus impuestos, de tu facturación y de lo que registras.",
  },
  {
    title: "Tu cuenta",
    body: "Debes ser mayor de edad y dar información veraz. Eres responsable de la confidencialidad de tu contraseña y de las personas a las que das acceso (por ejemplo, tus empleados). Avísanos de inmediato si crees que alguien usó tu cuenta sin permiso.",
  },
  {
    title: "Prueba gratuita",
    body: "Al crear tu cuenta tienes 14 días de prueba, sin tarjeta de crédito y sin cobro. Al terminar la prueba, para seguir usando VIMDY debes elegir un plan de pago. Si no lo haces, tu cuenta queda inactiva.",
  },
  {
    title: "Planes y precios",
    body: TERMS_PRICING_BODY,
  },
  {
    title: "Pagos y renovación",
    body: "Los pagos se procesan a través de Wompi u otros proveedores de pago habilitados; VIMDY no guarda los datos de tu tarjeta. No hacemos cobros automáticos: cuando tu plan está por vencer te avisamos y tú decides si lo renuevas desde Configuración.",
  },
  {
    title: "Cancelación y devoluciones",
    body: "Como no hay cobro automático, puedes dejar de usar VIMDY cuando quieras simplemente no renovando; tu acceso continúa hasta el final del período pagado. Si pagaste un plan y en los primeros 7 días calendario sientes que VIMDY no te sirve, escríbenos a hola@vimdy.co y te devolvemos lo pagado, al mismo medio de pago, en un máximo de 15 días calendario. Pasados esos 7 días no devolvemos el tiempo no usado, salvo que el servicio haya fallado gravemente por causa nuestra. Esto no limita los derechos que la ley te reconozca como consumidor.",
  },
  {
    title: "Uso permitido",
    body: "Usa VIMDY solo para fines legales y de acuerdo con estos términos. No está permitido usar la plataforma para actividades fraudulentas o ilegales, intentar acceder a datos de otros negocios, ni dañar o sobrecargar el servicio.",
  },
  {
    title: "Tus datos y los de tus clientes",
    body: "La información de tu negocio (ventas, productos, clientes, empleados) es tuya. Nos autorizas a guardarla y procesarla para prestarte el servicio. Si registras datos personales de tus clientes o empleados, tú eres quien responde ante ellos por su tratamiento (por ejemplo, avisarles y pedir su autorización cuando corresponda) y VIMDY actúa como encargado que los guarda en tu nombre. Más detalles en la Política de Privacidad. Si dejas de ser cliente, puedes pedirnos eliminar tus datos escribiendo a hola@vimdy.co; si no lo pides, podremos conservarlos hasta 90 días y luego eliminarlos o anonimizarlos.",
  },
  {
    title: "Disponibilidad",
    body: "Trabajamos para que VIMDY esté disponible, pero no garantizamos un servicio sin interrupciones. Pueden ocurrir fallas o mantenimientos, y VIMDY puede depender de proveedores externos. Te recomendamos conservar tus propios respaldos de los reportes importantes.",
  },
  {
    title: "Propiedad intelectual",
    body: "VIMDY, su software, marca y diseño pertenecen a su titular. Te damos una licencia de uso mientras tengas un plan activo o una prueba vigente; no puedes copiar, modificar, revender ni distribuir el software sin autorización.",
  },
  {
    title: "Límite de responsabilidad",
    body: "VIMDY se ofrece tal como está. No respondemos por pérdidas indirectas, como ventas dejadas de recibir o decisiones de negocio tomadas con base en la información o en VIMDY IA. Salvo dolo o culpa grave, nuestra responsabilidad total por cualquier reclamo se limita a lo que pagaste por VIMDY en los 3 meses anteriores. Esto no limita lo que la ley no permita limitar.",
  },
  {
    title: "Suspensión y terminación",
    body: "Si incumples estos términos, te avisaremos por correo y tendrás 5 días hábiles para corregirlo antes de suspender tu cuenta. Podemos suspenderla de inmediato, sin aviso previo, solo en casos de fraude, uso ilegal o riesgo para otros usuarios o para el servicio.",
  },
  {
    title: "Cambios en estos términos",
    body: "Podemos actualizar estos términos. Si el cambio es importante, te avisaremos por correo o dentro de la app con al menos 15 días de anticipación. Si sigues usando VIMDY después, entendemos que aceptas la nueva versión.",
  },
  {
    title: "Peticiones, quejas y reclamos",
    body: "Puedes presentar cualquier petición, queja o reclamo escribiendo a hola@vimdy.co o por WhatsApp. Cada solicitud recibe un número de radicado y la respondemos en un máximo de 15 días hábiles. Si no quedas conforme con la respuesta, puedes acudir a la Superintendencia de Industria y Comercio (www.sic.gov.co).",
  },
  {
    title: "Ley aplicable",
    body: "Estos términos se rigen por las leyes de Colombia. Si tienes un problema, escríbenos primero a hola@vimdy.co para resolverlo de buena fe; si no hay acuerdo, se acudirá a las autoridades colombianas competentes.",
  },
  {
    title: "Soporte y contacto",
    body: "Ofrecemos soporte por correo (hola@vimdy.co) y WhatsApp en horario laboral. El soporte no incluye personalización ni desarrollo a medida.",
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

            <p className="mt-8 text-xs leading-6 text-zinc-500">
              Última actualización: {LEGAL_INFO.ultimaActualizacion}.
            </p>
          </div>
        </div>
      </section>
    </div>
  );
}