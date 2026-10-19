import { useEffect, useMemo, useState } from "react";

import { VimdyLogo } from "../ui/VimdyLogo";
import { useTranslation } from "../../../core/i18n/useTranslation";

/**
 * WelcomeIntro
 * ---------------------------------------------------------------------------
 * Intro de ~7s que se muestra cuando la persona terminó el registro y todos
 * los pasos del onboarding, justo antes de entrar a la app (ver
 * OnboardingGate). Frases cortas que aparecen una tras otra, una esfera de
 * luz con círculos flotando que se reúnen, y al final el logo de VIMDY.
 *
 * Colores oficiales: fondo #0A0A0C, azul #2563EB, celeste #38BDF8.
 * Línea de tiempo (ms): frases 400-5000, esfera + círculos se reúnen 4600,
 * logo 5200, texto de bienvenida 5900, fundido de salida 6500-7000.
 *
 * Para cambiar los textos, edita PHRASES / WELCOME más abajo.
 * Respeta prefers-reduced-motion (sin movimiento, solo fundidos).
 */

const TOTAL_MS = 7000;
const PHRASE_STARTS = [400, 1950, 3500];
const GATHER_MS = 4600;
const LOGO_MS = 5200;
const WELCOME_MS = 5900;
const FADE_OUT_MS = 6500;

type Language = "es" | "en" | "pt";
interface Phrase {
  before: string;
  strong: string;
  after: string;
}

const PHRASES: Record<Language, Phrase[]> = {
  es: [
    { before: "Tu ", strong: "negocio", after: "." },
    { before: "Tu ", strong: "control", after: "." },
    { before: "Sin ", strong: "complicaciones", after: "." }
  ],
  en: [
    { before: "Your ", strong: "business", after: "." },
    { before: "Your ", strong: "control", after: "." },
    { before: "No ", strong: "complications", after: "." }
  ],
  pt: [
    { before: "Seu ", strong: "negócio", after: "." },
    { before: "Seu ", strong: "controle", after: "." },
    { before: "Sem ", strong: "complicações", after: "." }
  ]
};

const WELCOME: Record<Language, string> = {
  es: "Bienvenido a VIMDY",
  en: "Welcome to VIMDY",
  pt: "Bem-vindo ao VIMDY"
};

/** Círculos que flotan alrededor y luego se reúnen en la esfera. */
const RINGS = [
  { x: -150, y: -120, s: 26, d: 0.0 },
  { x: 130, y: -150, s: 38, d: 0.3 },
  { x: -190, y: 40, s: 18, d: 0.6 },
  { x: 170, y: 20, s: 30, d: 0.2 },
  { x: -90, y: 150, s: 34, d: 0.5 },
  { x: 110, y: 140, s: 20, d: 0.8 },
  { x: -40, y: -190, s: 16, d: 0.4 },
  { x: 40, y: 190, s: 24, d: 0.1 }
];

export function WelcomeIntro({ onComplete }: { onComplete: () => void }) {
  const { language } = useTranslation();
  const lang = (language in PHRASES ? language : "es") as Language;
  const phrases = PHRASES[lang];

  const reducedMotion = useMemo(
    () =>
      typeof window !== "undefined" && typeof window.matchMedia === "function"
        ? window.matchMedia("(prefers-reduced-motion: reduce)").matches
        : false,
    []
  );

  const [phraseIndex, setPhraseIndex] = useState(-1);
  const [phase, setPhase] = useState<"words" | "gather" | "logo">("words");
  const [showWelcome, setShowWelcome] = useState(false);
  const [fadeOut, setFadeOut] = useState(false);

  useEffect(() => {
    const timers: number[] = [];
    PHRASE_STARTS.forEach((ms, i) => timers.push(window.setTimeout(() => setPhraseIndex(i), ms)));
    timers.push(window.setTimeout(() => { setPhraseIndex(-1); setPhase("gather"); }, GATHER_MS));
    timers.push(window.setTimeout(() => setPhase("logo"), LOGO_MS));
    timers.push(window.setTimeout(() => setShowWelcome(true), WELCOME_MS));
    timers.push(window.setTimeout(() => setFadeOut(true), FADE_OUT_MS));
    timers.push(window.setTimeout(onComplete, TOTAL_MS));
    return () => timers.forEach((id) => window.clearTimeout(id));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const phrase = phraseIndex >= 0 ? phrases[phraseIndex] : null;
  const gathered = phase !== "words";

  return (
    <div
      className="fixed inset-0 z-[100] overflow-hidden bg-vimdy-background"
      style={{ opacity: fadeOut ? 0 : 1, transition: "opacity 500ms ease-in" }}
      role="status"
      aria-label={WELCOME[lang]}
    >
      <style>{`
        @keyframes wi-orb-in { 0% { opacity:0; transform:translate(-50%,-50%) scale(.2); } 100% { opacity:1; transform:translate(-50%,-50%) scale(1); } }
        @keyframes wi-orb-pulse { 0%,100% { transform:translate(-50%,-50%) scale(1); } 50% { transform:translate(-50%,-50%) scale(1.12); } }
        @keyframes wi-ring-float { 0%,100% { transform:translate(0,0); } 50% { transform:translate(8px,-10px); } }
        @keyframes wi-phrase { 0% { opacity:0; transform:translateY(10px); filter:blur(6px); } 20%,80% { opacity:1; transform:translateY(0); filter:blur(0); } 100% { opacity:0; transform:translateY(-6px); filter:blur(4px); } }
        @keyframes wi-logo-in { 0% { opacity:0; transform:translate(-50%,-50%) scale(.6); } 100% { opacity:1; transform:translate(-50%,-50%) scale(1); } }
        @keyframes wi-flash { 0% { opacity:.9; transform:translate(-50%,-50%) scale(.3); } 100% { opacity:0; transform:translate(-50%,-50%) scale(3.2); } }
        @keyframes wi-welcome { 0% { opacity:0; transform:translateY(8px); } 100% { opacity:1; transform:translateY(0); } }
        @media (prefers-reduced-motion: reduce) {
          .wi-anim { animation-duration: 1ms !important; }
        }
      `}</style>

      {/* Resplandor de fondo, azul de marca */}
      <div
        className="pointer-events-none absolute left-1/2 top-1/2 h-[720px] w-[720px] -translate-x-1/2 -translate-y-1/2 rounded-full"
        style={{
          background: "radial-gradient(circle, rgba(37,99,235,0.22), transparent 65%)",
          opacity: phraseIndex >= 0 || gathered ? 1 : 0,
          transition: "opacity 1200ms ease-out"
        }}
      />

      {/* Círculos flotantes que se reúnen en la esfera */}
      {RINGS.map((r, i) => (
        <div
          key={i}
          className="pointer-events-none absolute left-1/2 top-1/2"
          style={{
            width: r.s,
            height: r.s,
            marginLeft: -r.s / 2,
            marginTop: -r.s / 2,
            transform: gathered ? "translate(0,0) scale(.2)" : `translate(${r.x}px, ${r.y}px)`,
            opacity: gathered ? 0 : 1,
            transition: gathered
              ? "transform 700ms cubic-bezier(.65,0,.35,1), opacity 700ms ease-in"
              : "opacity 600ms ease-out"
          }}
        >
          <div
            className="wi-anim h-full w-full rounded-full"
            style={{
              border: "1px solid rgba(56,189,248,0.45)",
              animation: reducedMotion ? "none" : `wi-ring-float ${4 + (i % 3)}s ease-in-out ${r.d}s infinite`,
              opacity: phraseIndex >= 0 ? 1 : 0,
              transition: "opacity 800ms ease-out"
            }}
          />
        </div>
      ))}

      {/* Esfera de luz */}
      {phase !== "logo" && (
        <div
          className="wi-anim absolute left-1/2 top-1/2 h-[84px] w-[84px] rounded-full"
          style={{
            background: "radial-gradient(circle at 35% 30%, #E0F2FE, #38BDF8 45%, #2563EB 100%)",
            boxShadow: "0 0 50px 10px rgba(56,189,248,0.45), 0 0 140px 40px rgba(37,99,235,0.35)",
            opacity: 0,
            animation: reducedMotion
              ? "wi-orb-in 1ms forwards"
              : `wi-orb-in 1100ms cubic-bezier(.16,1,.3,1) 900ms forwards${gathered ? "" : ", wi-orb-pulse 2.6s ease-in-out 2s infinite"}`
          }}
        />
      )}

      {/* Destello al aparecer el logo */}
      {phase === "logo" && (
        <div
          className="wi-anim absolute left-1/2 top-1/2 h-[200px] w-[200px] rounded-full"
          style={{
            background: "radial-gradient(circle, rgba(56,189,248,0.8), rgba(37,99,235,0.3) 50%, transparent 70%)",
            animation: "wi-flash 900ms ease-out forwards"
          }}
        />
      )}

      {/* Logo oficial */}
      {phase === "logo" && (
        <div
          className="wi-anim absolute left-1/2 top-1/2 flex flex-col items-center gap-3"
          style={{ opacity: 0, animation: "wi-logo-in 700ms cubic-bezier(.16,1,.3,1) 150ms forwards" }}
        >
          <VimdyLogo size={96} />
          <span className="text-3xl font-bold tracking-tight text-white">VIMDY</span>
        </div>
      )}

      {/* Frases */}
      <div className="absolute inset-x-0 top-[62%] flex justify-center px-6 text-center">
        {phrase && (
          <p
            key={phraseIndex}
            className="wi-anim text-3xl text-white sm:text-4xl"
            style={{ animation: "wi-phrase 1550ms ease-in-out forwards" }}
          >
            {phrase.before}
            <strong className="font-extrabold text-vimdy-accent-hover">{phrase.strong}</strong>
            {phrase.after}
          </p>
        )}
      </div>

      {/* Bienvenida final */}
      {showWelcome && (
        <p
          className="wi-anim absolute inset-x-0 top-[66%] px-6 text-center text-lg text-vimdy-text-secondary"
          style={{ animation: "wi-welcome 600ms ease-out forwards" }}
        >
          {WELCOME[lang]}
        </p>
      )}
    </div>
  );
}