import { Mail, MessageCircle } from "lucide-react";
import { VimdyLogo } from "../../presentation/components/ui/VimdyLogo";

interface FooterLink {
  href: string;
  label: string;
  external?: boolean;
}

const footerLinks: Record<string, FooterLink[]> = {
  Producto: [
    { href: "#producto", label: "Funciones" },
    { href: "#precios", label: "Precios" },
    { href: "#como-funciona", label: "Cómo funciona" }
  ],
  Soporte: [
    { href: "/contacto", label: "Contacto" },
    { href: "https://wa.me/573000000000", label: "WhatsApp", external: true }
  ],
  Legal: [
    { href: "/privacidad", label: "Privacidad" },
    { href: "/terminos", label: "Términos" },
    { href: "/cookies", label: "Cookies" }
  ]
};

export function Footer() {
  return (
    <footer className="border-t border-white/5 bg-[#0B0B0D]">
      <div className="max-w-7xl mx-auto px-6 py-16">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-12">
          <div className="md:col-span-1">
            <div className="flex items-center gap-2 mb-4">
              <VimdyLogo size={32} />
              <span className="text-white font-bold text-xl tracking-tight">VIMDY</span>
            </div>
            <p className="text-zinc-500 text-sm leading-relaxed">
              Haz crecer lo que estás construyendo.
            </p>
          </div>

          {Object.entries(footerLinks).map(([title, links]) => (
            <div key={title}>
              <h4 className="text-white font-semibold text-sm mb-4">{title}</h4>
              <ul className="space-y-2.5">
                {links.map((link) => (
                  <li key={link.label}>
                    <a
                      href={link.href}
                      target={link.external ? "_blank" : undefined}
                      rel={link.external ? "noopener noreferrer" : undefined}
                      className="text-sm text-zinc-500 hover:text-white transition-colors"
                    >
                      {link.label}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <div className="mt-12 pt-8 border-t border-white/5 flex flex-col md:flex-row justify-between items-center gap-4">
          <p className="text-zinc-600 text-sm">
            © 2026 VIMDY. Todos los derechos reservados.
          </p>
          <div className="flex items-center gap-6">
            <a
              href="mailto:contacto@vimdy.co"
              className="text-zinc-500 hover:text-white transition-colors"
              aria-label="Email"
            >
              <Mail size={18} />
            </a>
            <a
              href="https://wa.me/573000000000"
              target="_blank"
              rel="noopener noreferrer"
              className="text-zinc-500 hover:text-white transition-colors"
              aria-label="WhatsApp"
            >
              <MessageCircle size={18} />
            </a>
          </div>
        </div>
      </div>
    </footer>
  );
}
