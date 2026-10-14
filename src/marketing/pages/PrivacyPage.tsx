import { ArrowLeft, ShieldCheck } from "lucide-react";
import { LEGAL_INFO } from "../legal/legalInfo";

type PrivacySection = {
  readonly id: string;
  readonly title: string;
  readonly paragraphs?: readonly string[];
  readonly items?: readonly string[];
  readonly after?: readonly string[];
};

const sections: readonly PrivacySection[] = [
  {
    id: "responsable",
    title: "Quién es el responsable",
    paragraphs: [
      `El responsable del tratamiento de tus datos personales es ${LEGAL_INFO.responsable}, ${LEGAL_INFO.calidad}, con domicilio en ${LEGAL_INFO.domicilio}. Correo: ${LEGAL_INFO.email}. WhatsApp: ${LEGAL_INFO.whatsapp}.`,
      "Esta política aplica a los datos de las personas que usan VIMDY (dueños y empleados). Para los datos de los clientes de tu negocio que registras en VIMDY, tú eres el responsable y VIMDY actúa como encargado que los guarda en tu nombre.",
    ],
  },
  {
    id: "datos",
    title: "Qué datos recopilamos",
    items: [
      "De tu cuenta: nombre, correo electrónico, contraseña (guardada de forma protegida) y teléfono si lo das.",
      "De tu negocio: nombre, dirección, teléfono, país y configuración.",
      "De la operación: ventas, caja, inventario, productos, proveedores y reportes.",
      "De tus empleados: nombre, rol y permisos.",
      "De tus clientes finales, si los registras: nombre, contacto y compras.",
      "De pagos: los procesa Wompi; VIMDY no guarda el número de tu tarjeta.",
      "Técnicos mínimos: los necesarios para mantener tu sesión iniciada y proteger la cuenta.",
    ],
    after: [
      "No necesitamos datos sensibles (salud, orientación sexual, religión, etc.). Te pedimos no registrarlos en VIMDY.",
    ],
  },
  {
    id: "finalidades",
    title: "Para qué usamos tus datos",
    items: [
      "Crear tu cuenta y prestarte el servicio (ventas, caja, inventario, reportes).",
      "Mantener la seguridad de la plataforma y evitar fraudes.",
      "Procesar pagos de tu suscripción y atender devoluciones.",
      "Enviarte avisos del servicio (verificación, vencimiento del plan, reportes que actives).",
      "Darte soporte y responder tus consultas.",
      "Corregir errores y mejorar VIMDY.",
      "Cumplir obligaciones legales.",
    ],
    after: [
      "No vendemos tus datos ni los usamos para publicidad de terceros.",
    ],
  },
  {
    id: "ia",
    title: "VIMDY IA",
    paragraphs: [
      "Cuando le haces una pregunta a VIMDY IA, enviamos a nuestro proveedor de inteligencia artificial tu pregunta junto con el resumen de tu negocio que necesita para responder (por ejemplo ventas, inventario, caja y, si existen, nombres de tus clientes frecuentes). Usamos esta información solo para generar la respuesta.",
    ],
  },
  {
    id: "terceros",
    title: "Con quién compartimos datos",
    paragraphs: [
      "Para operar VIMDY usamos proveedores que tratan datos en nuestro nombre:",
    ],
    items: [
      "Supabase: base de datos y autenticación.",
      "Vercel: alojamiento de la aplicación y la página web.",
      "Anthropic: inteligencia artificial de VIMDY IA.",
      "Resend: envío de correos del servicio.",
      "Wompi: procesamiento de pagos en Colombia.",
      "Meta (WhatsApp): solo si activas reportes por WhatsApp.",
      "Factus: solo si activas facturación electrónica.",
    ],
    after: [
      "Algunos de estos proveedores tienen sus servidores fuera de Colombia (por ejemplo, en Estados Unidos). Al aceptar esta política autorizas esa transferencia y transmisión internacional de datos, que hacemos solo para prestar el servicio. También podemos compartir datos si una autoridad competente lo exige.",
    ],
  },
  {
    id: "derechos",
    title: "Tus derechos",
    paragraphs: ["Como titular de datos personales tienes derecho a:"],
    items: [
      "Conocer, actualizar y rectificar tus datos.",
      "Pedir prueba de la autorización que nos diste.",
      "Que te informemos para qué hemos usado tus datos.",
      "Presentar quejas ante la Superintendencia de Industria y Comercio (SIC).",
      "Revocar tu autorización y pedir que eliminemos tus datos, cuando la ley lo permita.",
      "Acceder gratis a tus datos.",
    ],
  },
  {
    id: "ejercer",
    title: "Cómo ejercer tus derechos",
    paragraphs: [
      `Escríbenos a ${LEGAL_INFO.email} con el asunto «Datos personales», indicando tu nombre, el correo de tu cuenta y lo que necesitas. Respondemos las consultas en máximo 10 días hábiles y los reclamos en máximo 15 días hábiles; si necesitamos más tiempo te lo avisaremos con el motivo, como lo permite la ley.`,
    ],
  },
  {
    id: "conservacion",
    title: "Cuánto tiempo guardamos tus datos",
    paragraphs: [
      "Mientras tu cuenta esté activa. Si cancelas o tu plan vence, podemos conservarlos hasta 90 días por si decides volver y luego eliminarlos o anonimizarlos. Podemos guardar por más tiempo lo que la ley nos obligue a conservar (por ejemplo, registros de pagos).",
    ],
  },
  {
    id: "seguridad",
    title: "Seguridad",
    paragraphs: [
      "Usamos conexión cifrada (HTTPS), control de acceso por roles y separación entre los datos de cada negocio, entre otras medidas técnicas y organizativas. Ningún sistema es 100% infalible, pero trabajamos para proteger tus datos contra acceso no autorizado, pérdida o alteración.",
    ],
  },
  {
    id: "menores",
    title: "Menores de edad",
    paragraphs: [
      "VIMDY es para personas mayores de edad. No recopilamos a propósito datos de menores.",
    ],
  },
  {
    id: "cookies",
    title: "Cookies",
    paragraphs: [
      "Puedes ver cómo usamos las cookies en nuestra Política de Cookies.",
    ],
  },
  {
    id: "cambios",
    title: "Cambios en esta política",
    paragraphs: [
      "Si cambiamos esta política de forma importante, te avisaremos por correo o dentro de la app. La fecha de la última actualización aparece arriba.",
    ],
  },
  {
    id: "contacto",
    title: "Contacto",
    paragraphs: [
      `Para cualquier consulta sobre privacidad, escríbenos a ${LEGAL_INFO.email}.`,
    ],
  },
];

export function PrivacyPage() {
  return (
    <div className="relative overflow-hidden bg-transparent text-zinc-300">
      <div aria-hidden="true" className="pointer-events-none absolute inset-0">
        <div className="absolute left-1/2 top-0 h-80 w-[40rem] -translate-x-1/2 rounded-full bg-cyan-300/[0.04] blur-[120px]" />
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_0%,rgba(56,189,248,0.03),transparent_42%)]" />
      </div>

      <section className="relative px-5 pb-24 pt-32 sm:px-8 sm:pb-28 sm:pt-36 lg:px-10 lg:pb-36">
        <div className="mx-auto max-w-5xl">
          <a
            href="/"
            className="inline-flex items-center gap-2 rounded-full border border-white/[0.07] bg-white/[0.025] px-3.5 py-2 text-xs font-medium text-zinc-400 transition-[border-color,background-color,color] duration-300 hover:border-white/[0.12] hover:bg-white/[0.05] hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/45"
          >
            <ArrowLeft size={14} aria-hidden="true" />
            Volver a VIMDY
          </a>

          <div className="mt-10 grid gap-6 lg:grid-cols-[minmax(0,0.72fr)_minmax(0,1.28fr)] lg:gap-14">
            <aside className="self-start lg:sticky lg:top-28">
              <div className="rounded-[28px] border border-white/[0.07] bg-white/[0.018] p-6 backdrop-blur-sm sm:p-7">
                <div className="flex h-11 w-11 items-center justify-center rounded-2xl border border-cyan-300/10 bg-cyan-300/[0.05] text-cyan-200/80">
                  <ShieldCheck size={20} aria-hidden="true" />
                </div>

                <p className="mt-6 text-[10px] font-semibold uppercase tracking-[0.24em] text-cyan-300/65">
                  Información legal
                </p>

                <h1 className="mt-3 text-3xl font-semibold tracking-[-0.035em] text-white sm:text-4xl">
                  Política de Privacidad
                </h1>

                <p className="mt-4 text-sm leading-6 text-zinc-500">
                  Qué datos recopilamos, para qué los usamos y cómo puedes
                  ejercer tus derechos. Última actualización:{" "}
                  {LEGAL_INFO.ultimaActualizacion}.
                </p>
              </div>
            </aside>

            <article className="rounded-[30px] border border-white/[0.07] bg-white/[0.018] p-6 shadow-[0_30px_90px_rgba(0,0,0,0.22)] backdrop-blur-sm sm:p-8 lg:p-10">
              <div className="space-y-10 text-[15px] leading-7 text-zinc-400">
                <p>
                  VIMDY se compromete a proteger la privacidad de sus usuarios.
                  Esta política describe cómo recopilamos, usamos y protegemos
                  tu información.
                </p>

                {sections.map((section) => (
                  <section key={section.id} aria-labelledby={`privacy-${section.id}`}>
                    <h2
                      id={`privacy-${section.id}`}
                      className="text-xl font-semibold tracking-[-0.02em] text-white"
                    >
                      {section.title}
                    </h2>
                    {section.paragraphs?.map((paragraph) => (
                      <p key={paragraph} className="mt-4">
                        {paragraph}
                      </p>
                    ))}
                    {section.items && (
                      <ul className="mt-4 space-y-3">
                        {section.items.map((item) => (
                          <li key={item} className="flex gap-3">
                            <span
                              aria-hidden="true"
                              className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-cyan-300/70"
                            />
                            <span>{item}</span>
                          </li>
                        ))}
                      </ul>
                    )}
                    {section.after?.map((paragraph) => (
                      <p key={paragraph} className="mt-4">
                        {paragraph}
                      </p>
                    ))}
                  </section>
                ))}
              </div>
            </article>
          </div>
        </div>
      </section>
    </div>
  );
}