import { ArrowLeft, ShieldCheck } from "lucide-react";

const collectedInformation = [
  "Información de cuenta (nombre, email, contraseña)",
  "Información del negocio (nombre, dirección, teléfono)",
  "Datos de operación (ventas, caja, inventario, clientes)",
  "Datos de empleados (nombres, roles, permisos)",
  "Información de pagos (procesada por proveedores externos)",
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
                  Información sobre los datos que VIMDY declara recopilar, usar
                  y proteger según esta política.
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

                <section aria-labelledby="privacy-collected">
                  <h2
                    id="privacy-collected"
                    className="text-xl font-semibold tracking-[-0.02em] text-white"
                  >
                    Información que recopilamos
                  </h2>
                  <ul className="mt-4 space-y-3">
                    {collectedInformation.map((item) => (
                      <li key={item} className="flex gap-3">
                        <span
                          aria-hidden="true"
                          className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-cyan-300/70"
                        />
                        <span>{item}</span>
                      </li>
                    ))}
                  </ul>
                </section>

                <section aria-labelledby="privacy-use">
                  <h2
                    id="privacy-use"
                    className="text-xl font-semibold tracking-[-0.02em] text-white"
                  >
                    Uso de la información
                  </h2>
                  <p className="mt-4">
                    Utilizamos tu información para operar la plataforma,
                    procesar pagos, enviar notificaciones relevantes y mejorar
                    el servicio.
                  </p>
                </section>

                <section aria-labelledby="privacy-security">
                  <h2
                    id="privacy-security"
                    className="text-xl font-semibold tracking-[-0.02em] text-white"
                  >
                    Seguridad
                  </h2>
                  <p className="mt-4">
                    Implementamos medidas de seguridad técnicas y organizativas
                    para proteger tus datos contra acceso no autorizado,
                    pérdida o alteración.
                  </p>
                </section>

                <section aria-labelledby="privacy-rights">
                  <h2
                    id="privacy-rights"
                    className="text-xl font-semibold tracking-[-0.02em] text-white"
                  >
                    Tus derechos
                  </h2>
                  <p className="mt-4">
                    Puedes acceder, corregir o eliminar tu información en
                    cualquier momento desde la configuración de tu cuenta.
                    También puedes solicitar la eliminación completa de tu
                    cuenta contactándonos.
                  </p>
                </section>

                <section aria-labelledby="privacy-contact">
                  <h2
                    id="privacy-contact"
                    className="text-xl font-semibold tracking-[-0.02em] text-white"
                  >
                    Contacto
                  </h2>
                  <p className="mt-4">
                    Para cualquier consulta sobre privacidad, escríbenos a{" "}
                    <a
                      href="mailto:hola@vimdy.co"
                      className="font-medium text-cyan-200 transition-colors hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/45"
                    >
                      hola@vimdy.co
                    </a>
                    .
                  </p>
                </section>
              </div>
            </article>
          </div>
        </div>
      </section>
    </div>
  );
}
