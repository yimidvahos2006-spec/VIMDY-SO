import { useEffect, useId, useRef, useState } from "react";
import { ArrowRight, Menu, X } from "lucide-react";
import { VimdyLogo } from "../../presentation/components/ui/VimdyLogo";

const navLinks = [
  { href: "/#como-funciona", label: "Cómo funciona" },
  { href: "/#soluciones", label: "Soluciones" },
  { href: "/#precios", label: "Precios" },
  { href: "/#faq", label: "Preguntas" },
];

export function Navbar() {
  const [scrolled, setScrolled] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const mobileMenuId = useId().replace(/:/g, "");
  const menuButtonRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 24);

    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });

    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    if (!mobileOpen) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setMobileOpen(false);
      }
    };

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", onKeyDown);
    menuButtonRef.current?.focus();

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [mobileOpen]);

  const closeMobile = () => setMobileOpen(false);

  return (
    <header className="fixed inset-x-0 top-0 z-50">
      <nav
        aria-label="Navegación principal"
        className={[
          "transition-[background-color,border-color,box-shadow,backdrop-filter] duration-500",
          scrolled
            ? "border-b border-white/[0.07] bg-[#05070a]/82 shadow-[0_12px_40px_rgba(0,0,0,0.18)] backdrop-blur-2xl"
            : "bg-transparent",
        ].join(" ")}
      >
        <div className="mx-auto flex h-[76px] max-w-[1440px] items-center justify-between px-5 sm:px-8 lg:px-10">
          <a
            href="/"
            aria-label="VIMDY — inicio"
            onClick={closeMobile}
            className="group flex items-center gap-3 rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/50 focus-visible:ring-offset-4 focus-visible:ring-offset-[#05070a]"
          >
            <span className="relative">
              <span
                aria-hidden="true"
                className="absolute -inset-2 rounded-2xl bg-cyan-400/10 opacity-0 blur-xl transition-opacity duration-500 group-hover:opacity-100"
              />
              <VimdyLogo size={38} />
            </span>

            <span className="leading-none">
              <span className="block text-[17px] font-semibold tracking-[0.18em] text-white">
                VIMDY
              </span>
              <span className="mt-1 block text-[9px] font-medium uppercase tracking-[0.28em] text-zinc-500">
                Operating system
              </span>
            </span>
          </a>

          <div className="hidden items-center gap-8 lg:flex">
            {navLinks.map((link) => (
              <a
                key={link.href}
                href={link.href}
                className="group relative rounded-lg py-3 text-[13px] font-medium text-zinc-400 transition-colors duration-300 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/45"
              >
                {link.label}
                <span
                  aria-hidden="true"
                  className="absolute inset-x-1 bottom-1 h-px origin-left scale-x-0 bg-cyan-300/80 transition-transform duration-300 group-hover:scale-x-100"
                />
              </a>
            ))}
          </div>

          <div className="hidden items-center gap-2 md:flex">
            <a
              href="/login"
              className="rounded-full px-4 py-2.5 text-[13px] font-medium text-zinc-300 transition-colors hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/45"
            >
              Iniciar sesión
            </a>

            <a
              href="/registro"
              className="group inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.07] px-5 py-2.5 text-[13px] font-semibold text-white shadow-[0_0_30px_rgba(56,189,248,0.06)] backdrop-blur-xl transition-[background-color,border-color,transform] duration-300 hover:-translate-y-px hover:border-cyan-300/30 hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/50 focus-visible:ring-offset-4 focus-visible:ring-offset-[#05070a]"
            >
              Empezar con VIMDY
              <ArrowRight
                size={15}
                aria-hidden="true"
                className="transition-transform duration-300 group-hover:translate-x-0.5"
              />
            </a>
          </div>

          <button
            ref={menuButtonRef}
            type="button"
            aria-label={mobileOpen ? "Cerrar menú" : "Abrir menú"}
            aria-expanded={mobileOpen}
            aria-controls={mobileMenuId}
            onClick={() => setMobileOpen((value) => !value)}
            className="rounded-full border border-white/10 bg-white/[0.04] p-2.5 text-zinc-300 transition-[background-color,border-color,color] duration-300 hover:border-white/15 hover:bg-white/[0.08] hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/50 focus-visible:ring-offset-2 focus-visible:ring-offset-[#05070a] lg:hidden"
          >
            {mobileOpen ? (
              <X size={20} aria-hidden="true" />
            ) : (
              <Menu size={20} aria-hidden="true" />
            )}
          </button>
        </div>

        {mobileOpen && (
          <div
            id={mobileMenuId}
            className="fixed inset-x-0 top-[76px] bottom-0 overflow-y-auto border-t border-white/[0.07] bg-[#05070a]/96 px-5 pb-8 pt-5 backdrop-blur-2xl lg:hidden"
          >
            <div className="mx-auto max-w-[1440px]">
              <div className="rounded-3xl border border-white/[0.07] bg-white/[0.025] p-3 shadow-[0_24px_80px_rgba(0,0,0,0.28)]">
                {navLinks.map((link) => (
                  <a
                    key={link.href}
                    href={link.href}
                    onClick={closeMobile}
                    className="block rounded-2xl px-4 py-4 text-base font-medium text-zinc-300 transition-[background-color,color] duration-200 hover:bg-white/[0.05] hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-cyan-300/45"
                  >
                    {link.label}
                  </a>
                ))}
              </div>

              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                <a
                  href="/login"
                  onClick={closeMobile}
                  className="rounded-2xl border border-white/[0.08] bg-white/[0.03] px-5 py-4 text-center text-sm font-semibold text-zinc-200 transition-[background-color,border-color,color] duration-300 hover:border-white/[0.14] hover:bg-white/[0.06] hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/45"
                >
                  Iniciar sesión
                </a>

                <a
                  href="/registro"
                  onClick={closeMobile}
                  className="inline-flex items-center justify-center gap-2 rounded-2xl bg-white px-5 py-4 text-sm font-semibold text-black transition-[background-color,transform] duration-300 hover:-translate-y-0.5 hover:bg-zinc-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/50"
                >
                  Empezar con VIMDY
                  <ArrowRight size={16} aria-hidden="true" />
                </a>
              </div>
            </div>
          </div>
        )}
      </nav>
    </header>
  );
}
