import { useState, useEffect } from "react";
import { Menu, X } from "lucide-react";
import { VimdyLogo } from "../../presentation/components/ui/VimdyLogo";

const navLinks = [
  { href: "/funciones", label: "Funciones" },
  { href: "#soluciones", label: "Soluciones" },
  { href: "#precios", label: "Precios" },
  { href: "#como-funciona", label: "Cómo funciona" },
  { href: "#faq", label: "Preguntas" }
];

export function Navbar() {
  const [scrolled, setScrolled] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    const handleScroll = () => setScrolled(window.scrollY > 20);
    window.addEventListener("scroll", handleScroll);
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  return (
    <nav
      className={`fixed top-0 left-0 right-0 z-50 transition-all duration-300 ${
        scrolled
          ? "bg-[#050505]/80 backdrop-blur-xl border-b border-white/5"
          : "bg-transparent"
      }`}
    >
      <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between">
        <a href="/" className="flex items-center gap-2">
          <VimdyLogo size={32} />
          <span className="text-white font-bold text-xl tracking-tight">VIMDY</span>
        </a>

        <div className="hidden md:flex items-center gap-8">
          {navLinks.map((link) => (
            <a
              key={link.href}
              href={link.href}
              className="text-sm text-zinc-400 hover:text-white transition-colors"
            >
              {link.label}
            </a>
          ))}
        </div>

        <div className="hidden md:flex items-center gap-3">
          <a
            href="/login"
            className="text-sm text-zinc-300 hover:text-white transition-colors px-4 py-2"
          >
            Iniciar sesión
          </a>
          <a
            href="/registro"
            className="text-sm font-semibold text-white bg-blue-600 hover:bg-blue-500 px-5 py-2.5 rounded-lg transition-colors"
          >
            Probar VIMDY
          </a>
        </div>

        <button
          onClick={() => setMobileOpen(!mobileOpen)}
          className="md:hidden text-zinc-400 hover:text-white p-2"
        >
          {mobileOpen ? <X size={24} /> : <Menu size={24} />}
        </button>
      </div>

      {mobileOpen && (
        <div className="md:hidden bg-[#0B0B0D] border-t border-white/5 px-6 py-4 space-y-3">
          {navLinks.map((link) => (
            <a
              key={link.href}
              href={link.href}
              onClick={() => setMobileOpen(false)}
              className="block text-sm text-zinc-400 hover:text-white transition-colors py-2"
            >
              {link.label}
            </a>
          ))}
          <div className="pt-3 border-t border-white/5 space-y-2">
            <a
              href="/login"
              onClick={() => setMobileOpen(false)}
              className="block text-sm text-zinc-300 hover:text-white transition-colors py-2"
            >
              Iniciar sesión
            </a>
            <a
              href="/registro"
              onClick={() => setMobileOpen(false)}
              className="block text-sm font-semibold text-white bg-blue-600 hover:bg-blue-500 px-5 py-2.5 rounded-lg transition-colors text-center"
            >
              Probar VIMDY
            </a>
          </div>
        </div>
      )}
    </nav>
  );
}
