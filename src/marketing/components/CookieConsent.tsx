import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Cookie } from "lucide-react";
import {
  COOKIE_CONSENT_OPEN_EVENT,
  readCookieConsent,
  saveCookieConsent,
} from "../cookieConsent";

type View = "closed" | "banner" | "settings";

const buttonBase =
  "inline-flex min-h-11 flex-1 items-center justify-center rounded-full px-5 py-2.5 text-sm font-semibold transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-200/70 focus-visible:ring-offset-2 focus-visible:ring-offset-[#080b0f]";

const buttonPrimary = `${buttonBase} bg-cyan-400 text-[#041014] hover:bg-cyan-300`;

export function CookieConsent() {
  const [view, setView] = useState<View>("closed");
  const [entered, setEntered] = useState(false);
  const regionRef = useRef<HTMLElement>(null);
  const settingsTitleRef = useRef<HTMLHeadingElement>(null);

  // Primera visita: sin decisión guardada (o de otra versión) → mostrar.
  useEffect(() => {
    if (!readCookieConsent()) setView("banner");
  }, []);

  // Reapertura desde otros puntos del sitio (p. ej. el enlace del Footer).
  useEffect(() => {
    const onOpen = () => setView("settings");
    window.addEventListener(COOKIE_CONSENT_OPEN_EVENT, onOpen);
    return () => window.removeEventListener(COOKIE_CONSENT_OPEN_EVENT, onOpen);
  }, []);

  // Animación de entrada (se respeta prefers-reduced-motion vía motion-reduce).
  useEffect(() => {
    if (view === "closed") {
      setEntered(false);
      return;
    }
    const frame = window.requestAnimationFrame(() => setEntered(true));
    return () => window.cancelAnimationFrame(frame);
  }, [view]);

  // Al abrir el panel desde el Footer, mover el foco al título.
  useEffect(() => {
    if (view === "settings") settingsTitleRef.current?.focus();
  }, [view]);

  // Solo hay cookies técnicas (no requieren consentimiento): el botón confirma
  // que el usuario vio el aviso. Si ya había una decisión guardada se conserva.
  const acknowledge = useCallback(() => {
    if (!readCookieConsent()) saveCookieConsent(false);
    setView("closed");
  }, []);

  if (view === "closed") return null;

  return (
    <section
      ref={regionRef}
      aria-label="Aviso de cookies"
      className={`fixed inset-x-3 bottom-3 z-[70] mx-auto max-w-xl rounded-3xl border border-white/[0.1] bg-[#080b0f]/95 p-5 text-white shadow-[0_30px_100px_rgba(0,0,0,0.55)] backdrop-blur-2xl transition-[transform,opacity] duration-500 ease-out motion-reduce:transition-none sm:inset-x-auto sm:bottom-6 sm:left-6 sm:mx-0 sm:p-6 ${
        entered ? "translate-y-0 opacity-100" : "translate-y-6 opacity-0"
      }`}
    >
      {view === "banner" ? (
        <>
          <div className="flex items-start gap-3">
            <span
              aria-hidden="true"
              className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-cyan-300/20 bg-cyan-300/10 text-cyan-200"
            >
              <Cookie className="h-4 w-4" />
            </span>
            <div>
              <h2 className="text-base font-semibold tracking-[-0.02em]">
                Tu privacidad en VIMDY
              </h2>
              <p className="mt-2 text-sm leading-6 text-zinc-300">
                Usamos únicamente cookies técnicas, necesarias para que el sitio
                funcione, como mantener tu sesión y recordar preferencias de idioma y
                país. Más información en nuestra{" "}
                <Link
                  to="/cookies"
                  className="text-cyan-200 underline underline-offset-2 hover:text-cyan-100"
                >
                  Política de Cookies
                </Link>{" "}
                y en la{" "}
                <Link
                  to="/privacidad"
                  className="text-cyan-200 underline underline-offset-2 hover:text-cyan-100"
                >
                  Política de Privacidad
                </Link>
                .
              </p>
            </div>
          </div>

          <div className="mt-5 flex flex-col gap-2 sm:flex-row">
            <button type="button" onClick={acknowledge} className={buttonPrimary}>
              Entendido
            </button>
          </div>
        </>
      ) : (
        <>
          <h2
            ref={settingsTitleRef}
            tabIndex={-1}
            className="text-base font-semibold tracking-[-0.02em] outline-none"
          >
            Preferencias de cookies
          </h2>

          <ul className="mt-4 space-y-3">
            <li className="flex items-start justify-between gap-4 rounded-2xl border border-white/[0.08] bg-white/[0.03] p-4">
              <div>
                <p className="text-sm font-semibold">Técnicas (necesarias)</p>
                <p className="mt-1 text-xs leading-5 text-zinc-400">
                  Mantienen tu sesión y recuerdan preferencias como idioma y país. Siempre
                  activas.
                </p>
              </div>
              <span className="shrink-0 rounded-full border border-white/10 px-2.5 py-1 text-[11px] font-medium text-zinc-300">
                Siempre activas
              </span>
            </li>
          </ul>

          <p className="mt-4 text-xs leading-5 text-zinc-400">
            Más información en nuestra{" "}
            <Link
              to="/cookies"
              className="text-cyan-200 underline underline-offset-2 hover:text-cyan-100"
            >
              Política de Cookies
            </Link>
            .
          </p>

          <div className="mt-5 flex flex-col gap-2 sm:flex-row">
            <button type="button" onClick={acknowledge} className={buttonPrimary}>
              Cerrar
            </button>
          </div>
        </>
      )}
    </section>
  );
}