import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Volume2, VolumeX } from "lucide-react";

import { VimdyLogo } from "../ui/VimdyLogo";
import { useTranslation } from "../../../core/i18n/useTranslation";
import { createIntroSound, isIntroMuted, setIntroMuted, type IntroSound } from "./introAudio";
import { createIntroScene, INTRO_LOGO_SECONDS, INTRO_TOTAL_SECONDS, type IntroScene } from "./introScene";

/**
 * CinematicIntro
 * ---------------------------------------------------------------------------
 * Intro premium de VIMDY: escenario 3D de terrazas azules que una luz celeste
 * recorre, un destello y la V de VIMDY que emerge de la luz (ver introScene.ts).
 * Solo usa los colores de la marca: #0A0A0C, #2563EB, #38BDF8 y blanco.
 *
 * Quién la ve y cuándo lo decide OnboardingGate: únicamente el ADMIN que acaba
 * de crear el negocio, una sola vez, al terminar el onboarding. Ningún otro
 * rol la ve nunca.
 *
 * Duración ~5.2 s. Tiene "Omitir" y botón de sonido (la elección se recuerda).
 * Si el dispositivo no soporta WebGL o la persona pidió "reducir movimiento",
 * se muestra una versión quieta con el logo, sin 3D.
 */

type Language = "es" | "en" | "pt";

const TAGLINE: Record<Language, string> = {
  es: "El sistema operativo de tu negocio",
  en: "The operating system of your business",
  pt: "O sistema operacional do seu negócio"
};
const SKIP_LABEL: Record<Language, string> = { es: "Omitir", en: "Skip", pt: "Pular" };
const SOUND_ON_LABEL: Record<Language, string> = { es: "Activar sonido", en: "Turn sound on", pt: "Ativar som" };
const SOUND_OFF_LABEL: Record<Language, string> = { es: "Silenciar", en: "Mute", pt: "Silenciar" };

const STATIC_TOTAL_SECONDS = 2.6;

export function CinematicIntro({ onComplete }: { onComplete: () => void }) {
  const { language } = useTranslation();
  const lang = (language in TAGLINE ? language : "es") as Language;

  const reducedMotion = useMemo(
    () =>
      typeof window !== "undefined" && typeof window.matchMedia === "function"
        ? window.matchMedia("(prefers-reduced-motion: reduce)").matches
        : false,
    []
  );

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const soundRef = useRef<IntroSound | null>(null);
  const mutedRef = useRef(isIntroMuted());
  const doneRef = useRef(false);
  const [muted, setMuted] = useState(mutedRef.current);
  const [staticMode, setStaticMode] = useState(reducedMotion);
  const [seconds, setSeconds] = useState(0);
  const [fadeOut, setFadeOut] = useState(false);

  const finish = useCallback(() => {
    if (doneRef.current) return;
    doneRef.current = true;
    soundRef.current?.stop();
    onComplete();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const sound = createIntroSound();
    soundRef.current = sound;
    sound.setMuted(mutedRef.current);
    if (!mutedRef.current) sound.start();

    let scene: IntroScene | null = null;
    const canvas = canvasRef.current;
    if (!staticMode && canvas) {
      try {
        scene = createIntroScene(canvas, Math.min(window.devicePixelRatio || 1, 2));
      } catch {
        // Sin WebGL: se usa la versión quieta.
        setStaticMode(true);
      }
    }

    const total = staticMode || !scene ? STATIC_TOTAL_SECONDS : INTRO_TOTAL_SECONDS;
    const cues = staticMode || !scene
      ? [{ at: 0.4, run: () => sound.chime() }]
      : [
          { at: 2.45, run: () => sound.sweep() },
          { at: INTRO_LOGO_SECONDS - 0.05, run: () => sound.hit() },
          { at: INTRO_LOGO_SECONDS + 0.05, run: () => sound.chime() }
        ];
    const fired = new Set<number>();

    let raf = 0;
    let faded = false;
    const startedAt = performance.now();

    const onResize = () => {
      if (scene && canvas) scene.resize(canvas.clientWidth, canvas.clientHeight);
    };
    window.addEventListener("resize", onResize);
    onResize();

    const tick = () => {
      const t = (performance.now() - startedAt) / 1000;
      setSeconds(t);
      if (scene) scene.renderAt(Math.min(t, total));
      cues.forEach((cue, i) => {
        if (t >= cue.at && !fired.has(i)) {
          fired.add(i);
          cue.run();
        }
      });
      if (!faded && t >= total - 0.5) {
        faded = true;
        setFadeOut(true);
        sound.fadeOut();
      }
      if (t >= total) {
        finish();
        return;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", onResize);
      scene?.dispose();
      sound.stop();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [staticMode]);

  function toggleMuted() {
    const next = !mutedRef.current;
    mutedRef.current = next;
    setMuted(next);
    setIntroMuted(next);
    const sound = soundRef.current;
    if (next) {
      sound?.setMuted(true);
    } else {
      sound?.setMuted(false);
      sound?.start();
    }
  }

  // Letras de VIMDY y eslogan: aparecen justo después de que la V emerge.
  const textIn = staticMode ? Math.min(1, seconds / 0.9) : Math.min(1, Math.max(0, (seconds - (INTRO_LOGO_SECONDS + 0.45)) / 0.8));
  const taglineIn = staticMode ? Math.min(1, Math.max(0, (seconds - 0.5) / 0.9)) : Math.min(1, Math.max(0, (seconds - (INTRO_LOGO_SECONDS + 0.85)) / 0.8));

  return (
    <div
      className="fixed inset-0 z-[100] overflow-hidden bg-vimdy-background"
      style={{ opacity: fadeOut ? 0 : 1, transition: "opacity 500ms ease-in" }}
      role="status"
      aria-label="VIMDY"
    >
      <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" style={{ display: staticMode ? "none" : "block" }} />

      {staticMode && (
        <div
          className="absolute left-1/2 top-[38%] -translate-x-1/2 -translate-y-1/2"
          style={{ opacity: Math.min(1, seconds / 0.8), filter: "drop-shadow(0 0 40px rgba(37,99,235,0.55))" }}
        >
          <VimdyLogo size={168} />
        </div>
      )}

      {/* Wordmark y eslogan, sobre el canvas */}
      <div className="pointer-events-none absolute inset-x-0 bottom-[10%] flex flex-col items-center px-6 text-center">
        <p
          className="font-extrabold uppercase text-white"
          style={{
            fontSize: "clamp(34px, 6vw, 72px)",
            letterSpacing: `${0.7 - textIn * 0.38}em`,
            opacity: textIn,
            transform: `translateY(${(1 - textIn) * 14}px)`,
            filter: `blur(${(1 - textIn) * 8}px)`,
            textShadow: "0 0 40px rgba(37,99,235,0.6)"
          }}
        >
          VIMDY <span style={{ color: "#38BDF8" }}>OS</span>
        </p>
        <p
          className="mt-3 uppercase text-vimdy-text-secondary"
          style={{
            fontSize: "clamp(11px, 1.3vw, 15px)",
            letterSpacing: "0.32em",
            opacity: taglineIn,
            transform: `translateY(${(1 - taglineIn) * 8}px)`
          }}
        >
          {TAGLINE[lang]}
        </p>
      </div>

      {/* Controles: omitir y sonido */}
      <div className="absolute right-4 top-4 z-10 flex items-center gap-2 sm:right-6 sm:top-6">
        <button
          type="button"
          onClick={toggleMuted}
          aria-label={muted ? SOUND_ON_LABEL[lang] : SOUND_OFF_LABEL[lang]}
          title={muted ? SOUND_ON_LABEL[lang] : SOUND_OFF_LABEL[lang]}
          className="flex h-9 w-9 items-center justify-center rounded-full border border-vimdy-border bg-vimdy-surface/60 text-vimdy-text-secondary transition-colors hover:text-white"
        >
          {muted ? <VolumeX size={16} strokeWidth={1.8} /> : <Volume2 size={16} strokeWidth={1.8} />}
        </button>
        <button
          type="button"
          onClick={finish}
          className="rounded-full border border-vimdy-border bg-vimdy-surface/60 px-4 py-2 text-vimdy-small text-vimdy-text-secondary transition-colors hover:text-white"
        >
          {SKIP_LABEL[lang]}
        </button>
      </div>
    </div>
  );
}