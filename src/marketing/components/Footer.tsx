import { ArrowUpRight, Mail, MessageCircle } from "lucide-react";
import { VimdyLogo } from "../../presentation/components/ui/VimdyLogo";
import { VIMDY_CONTACT } from "../../core/config/contact";

interface FooterLink {
  href: string;
  label: string;
  external?: boolean;
}

const footerLinks: Record<string, FooterLink[]> = {
  Producto: [
    { href: "/funciones", label: "Funciones" },
    { href: "/precios", label: "Precios" },
    { href: "/#como-funciona", label: "Cómo funciona" },
  ],
  Soporte: [
    { href: "/contacto", label: "Contacto" },
    { href: VIMDY_CONTACT.whatsapp.link, label: "WhatsApp", external: true },
  ],
  Legal: [
    { href: "/privacidad", label: "Privacidad" },
    { href: "/terminos", label: "Términos" },
    { href: "/cookies", label: "Cookies" },
  ],
};

export function Footer() {
  return (
    <footer className="relative overflow-hidden border-t border-white/[0.06] bg-[#030507]">
      <div aria-hidden="true" className="pointer-events-none absolute inset-0">
        <div className="absolute left-1/2 top-0 h-80 w-[48rem] -translate-x-1/2 rounded-full bg-cyan-300/[0.025] blur-[130px]" />
        <div className="absolute bottom-0 left-[-10rem] h-64 w-64 rounded-full bg-blue-500/[0.018] blur-[110px]" />
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_0%,rgba(56,189,248,0.03),transparent_38%)]" />
      </div>

      <div className="relative mx-auto max-w-[1440px] px-5 pb-8 pt-16 sm:px-8 sm:pt-20 lg:px-10 lg:pt-24">
        <div className="grid gap-14 lg:grid-cols-[minmax(0,1.65fr)_repeat(3,minmax(0,0.72fr))] lg:gap-12">
          <div className="max-w-xl">
            <a
              href="/"
              aria-label="VIMDY — inicio"
              className="group inline-flex items-center gap-3"
            >
              <span className="relative flex h-11 w-11 items-center justify-center rounded-2xl border border-white/[0.08] bg-white/[0.03] shadow-[0_15px_45px_rgba(0,0,0,0.22)]">
                <span
                  aria-hidden="true"
                  className="absolute -inset-4 rounded-full bg-cyan-300/[0.08] opacity-0 blur-xl transition-opacity duration-500 group-hover:opacity-100"
                />
                <VimdyLogo size={30} />
              </span>

              <span>
                <span className="block text-[15px] font-semibold tracking-[0.2em] text-white">
                  VIMDY
                </span>
                <span className="mt-1 block text-[9px] font-medium uppercase tracking-[0.26em] text-zinc-600">
                  Tecnología para tu operación
                </span>
              </span>
            </a>

            <p className="mt-8 max-w-lg text-2xl font-medium leading-tight tracking-[-0.035em] text-zinc-200 sm:text-3xl">
              La tecnología detrás de la operación.
            </p>

            <p className="mt-5 max-w-lg text-sm leading-7 text-zinc-500">
              VIMDY reúne herramientas para conectar la operación diaria de
              negocios de alimentos y bebidas en una sola experiencia.
            </p>

            <a
              href="/registro"
              className="group mt-7 inline-flex items-center gap-2 rounded-full border border-white/[0.08] bg-white/[0.025] px-4 py-2.5 text-sm font-semibold text-zinc-200 transition-[border-color,background-color,color,transform] duration-300 hover:-translate-y-px hover:border-cyan-300/20 hover:bg-white/[0.05] hover:text-cyan-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/50 focus-visible:ring-offset-4 focus-visible:ring-offset-[#030507]"
            >
              Empezar con VIMDY
              <ArrowUpRight
                size={15}
                aria-hidden="true"
                className="transition-transform duration-300 group-hover:-translate-y-0.5 group-hover:translate-x-0.5"
              />
            </a>
          </div>

          {Object.entries(footerLinks).map(([title, links]) => (
            <div key={title}>
              <h2 className="text-[10px] font-semibold uppercase tracking-[0.24em] text-zinc-600">
                {title}
              </h2>

              <nav aria-label={`Enlaces de ${title}`} className="mt-5">
                <ul className="space-y-3">
                  {links.map((link) => (
                    <li key={link.label}>
                      <a
                        href={link.href}
                        target={link.external ? "_blank" : undefined}
                        rel={link.external ? "noopener noreferrer" : undefined}
                        className="inline-flex items-center gap-1 text-sm text-zinc-500 transition-colors duration-200 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/50 focus-visible:ring-offset-4 focus-visible:ring-offset-[#030507]"
                      >
                        {link.label}
                        {link.external && (
                          <ArrowUpRight size={13} aria-hidden="true" />
                        )}
                      </a>
                    </li>
                  ))}
                </ul>
              </nav>
            </div>
          ))}
        </div>

        <div className="mt-16 border-t border-white/[0.06] pt-6 sm:mt-20">
          <div className="flex flex-col gap-6 text-xs text-zinc-600 sm:flex-row sm:items-end sm:justify-between">
            <div className="space-y-1">
              <p>© {new Date().getFullYear()} VIMDY. Todos los derechos reservados.</p>
              <p className="text-zinc-700">
                Tecnología para la operación de negocios de alimentos y bebidas.
              </p>
            </div>

            <div className="flex items-center gap-2">
              <a
                href={`mailto:${VIMDY_CONTACT.email.support}`}
                className="flex h-10 w-10 items-center justify-center rounded-full border border-white/[0.07] bg-white/[0.02] text-zinc-500 transition-[border-color,background-color,color,transform] duration-300 hover:-translate-y-px hover:border-cyan-300/20 hover:bg-white/[0.05] hover:text-cyan-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/50 focus-visible:ring-offset-4 focus-visible:ring-offset-[#030507]"
                aria-label="Enviar correo a VIMDY"
              >
                <Mail size={17} aria-hidden="true" />
              </a>

              <a
                href={VIMDY_CONTACT.whatsapp.link}
                target="_blank"
                rel="noopener noreferrer"
                className="flex h-10 w-10 items-center justify-center rounded-full border border-white/[0.07] bg-white/[0.02] text-zinc-500 transition-[border-color,background-color,color,transform] duration-300 hover:-translate-y-px hover:border-cyan-300/20 hover:bg-white/[0.05] hover:text-cyan-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/50 focus-visible:ring-offset-4 focus-visible:ring-offset-[#030507]"
                aria-label="Contactar a VIMDY por WhatsApp"
              >
                <MessageCircle size={17} aria-hidden="true" />
              </a>
            </div>
          </div>
        </div>
      </div>
    </footer>
  );
}
