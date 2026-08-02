import { useEffect, useRef, useState } from "react";

import { VimdyLogo } from "../ui/VimdyLogo";

/**
 * VimdyIntro — FASE 6, PASO 1.
 * ---------------------------------------------------------------------------
 * Intro cinematográfica que se muestra UNA sola vez, justo después de
 * instalar la app (ver appIntroStore + el gate en App.tsx). Nunca vuelve a
 * aparecer, no se puede saltar, no tiene botones ni información técnica.
 *
 * Estructura (todo corre sobre una única línea de tiempo, ~4.6s en total —
 * dentro de la ventana de 3 a 5s que pide el documento):
 *   1. Negro + silencio                              0.0s – 0.5s
 *   2. Partículas apareciendo, flotando suavemente    0.5s – 1.3s
 *   3. Partículas reuniéndose en una esfera de        1.3s – 2.1s
 *      energía, la luz general sube poco a poco
 *   4. La esfera "explota" con suavidad y aparece     2.1s – 2.8s
 *      el logo VIMDY (con el sonido corto y elegante)
 *   5. Aparece el texto debajo del logo               2.8s – 3.4s
 *   6. El logo se sostiene en pantalla                 3.4s – 4.3s
 *   7. Fundido de salida                                4.3s – 4.7s -> onComplete
 *
 * Las partículas y la esfera se dibujan en un <canvas> 2D (liviano, sin
 * WebGL) para no consumir recursos de más; el logo y el texto son HTML/CSS
 * normales, animados con las clases vimdy-intro-* de styles/index.css.
 *
 * Si el dispositivo tiene activado "reducir movimiento", se omite el
 * movimiento de partículas (solo un fundido simple del logo) pero se
 * respeta igual la ventana de 3-5s — la intro nunca se salta ni se omite,
 * solo se vuelve más quieta.
 */

const TOTAL_DURATION_MS = 4700;
const PARTICLES_START_MS = 500;
const GATHER_START_MS = 1300;
const EXPLODE_MS = 2100;
const LOGO_VISIBLE_MS = 2200;
const TAGLINE_VISIBLE_MS = 2800;
const FADE_OUT_START_MS = 4300;

const PARTICLE_COLORS = ["#22d3ee", "#2563eb", "#8b5cf6", "#10b981"];
const PARTICLE_COUNT = 70;

interface Particle {
  x: number;
  y: number;
  startX: number;
  startY: number;
  targetX: number;
  targetY: number;
  size: number;
  color: string;
  driftSeed: number;
  burstAngle: number;
}

function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 3;
}

/** Sonido corto y elegante (Web Audio API): dos tonos ascendentes con
 * ataque rápido y caída suave — nada de archivos de audio que descargar,
 * y nada que se sienta agresivo o fuerte. Si el navegador bloquea el
 * audio por política de autoplay (sin gesto previo del usuario), falla
 * en silencio: la intro sigue igual, solo sin sonido. */
function playChime(): void {
  try {
    const AudioContextClass =
      window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioContextClass) return;

    const ctx = new AudioContextClass();
    const now = ctx.currentTime;

    const notes: { freq: number; start: number; duration: number; gain: number }[] = [
      { freq: 987.77, start: 0, duration: 0.5, gain: 0.05 },
      { freq: 1318.51, start: 0.12, duration: 0.6, gain: 0.06 }
    ];

    notes.forEach(({ freq, start, duration, gain }) => {
      const oscillator = ctx.createOscillator();
      const gainNode = ctx.createGain();
      oscillator.type = "sine";
      oscillator.frequency.setValueAtTime(freq, now + start);
      gainNode.gain.setValueAtTime(0, now + start);
      gainNode.gain.linearRampToValueAtTime(gain, now + start + 0.03);
      gainNode.gain.exponentialRampToValueAtTime(0.0001, now + start + duration);
      oscillator.connect(gainNode);
      gainNode.connect(ctx.destination);
      oscillator.start(now + start);
      oscillator.stop(now + start + duration + 0.05);
    });

    setTimeout(() => ctx.close().catch(() => undefined), 1500);
  } catch {
    /** Autoplay bloqueado o Web Audio no disponible: la intro sigue sin sonido. */
  }
}

export function VimdyIntro({ onComplete }: { onComplete: () => void }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [showLogo, setShowLogo] = useState(false);
  const [showTagline, setShowTagline] = useState(false);
  const [fadeOut, setFadeOut] = useState(false);

  const reducedMotion =
    typeof window !== "undefined" && window.matchMedia
      ? window.matchMedia("(prefers-reduced-motion: reduce)").matches
      : false;

  // Línea de tiempo: solo controla estados de React para el logo/texto/salida.
  // El canvas de partículas corre en su propio efecto, en un único RAF.
  useEffect(() => {
    const timers: ReturnType<typeof setTimeout>[] = [];

    timers.push(setTimeout(() => setShowLogo(true), reducedMotion ? 200 : EXPLODE_MS));
    timers.push(setTimeout(() => playChime(), reducedMotion ? 200 : EXPLODE_MS));
    timers.push(setTimeout(() => setShowTagline(true), reducedMotion ? 900 : TAGLINE_VISIBLE_MS));
    timers.push(setTimeout(() => setFadeOut(true), reducedMotion ? 2400 : FADE_OUT_START_MS));
    timers.push(
      setTimeout(onComplete, reducedMotion ? 2900 : TOTAL_DURATION_MS)
    );

    return () => timers.forEach(clearTimeout);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Canvas de partículas: se omite por completo si el usuario prefiere
  // menos movimiento (el logo igual aparece, solo que sin el "universo
  // digital" de fondo).
  useEffect(() => {
    if (reducedMotion) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let width = window.innerWidth;
    let height = window.innerHeight;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);

    function resize() {
      width = window.innerWidth;
      height = window.innerHeight;
      canvas!.width = width * dpr;
      canvas!.height = height * dpr;
      canvas!.style.width = `${width}px`;
      canvas!.style.height = `${height}px`;
      ctx!.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    resize();
    window.addEventListener("resize", resize);

    const centerX = () => width / 2;
    const centerY = () => height / 2;
    const sphereRadius = Math.min(width, height) * 0.09;

    const particles: Particle[] = Array.from({ length: PARTICLE_COUNT }, (_, i) => {
      const angle = (i / PARTICLE_COUNT) * Math.PI * 2 + Math.random() * 0.4;
      const radiusJitter = sphereRadius * (0.6 + Math.random() * 0.5);
      const startX = Math.random() * width;
      const startY = Math.random() * height;
      return {
        x: startX,
        y: startY,
        startX,
        startY,
        targetX: centerX() + Math.cos(angle) * radiusJitter,
        targetY: centerY() + Math.sin(angle) * radiusJitter * 0.85,
        size: 1.2 + Math.random() * 2.2,
        color: PARTICLE_COLORS[Math.floor(Math.random() * PARTICLE_COLORS.length)],
        driftSeed: Math.random() * Math.PI * 2,
        burstAngle: angle
      };
    });

    const startTime = performance.now();
    let rafId = 0;

    function frame(now: number) {
      const t = now - startTime;
      ctx!.clearRect(0, 0, width, height);

      // Fase 3: resplandor de fondo que crece lentamente mientras las
      // partículas se reúnen, simulando que "la iluminación aumenta".
      if (t >= GATHER_START_MS) {
        const glowProgress = Math.min(1, (t - GATHER_START_MS) / (EXPLODE_MS - GATHER_START_MS));
        const glowAlpha = 0.18 * glowProgress;
        const gradient = ctx!.createRadialGradient(
          centerX(),
          centerY(),
          0,
          centerX(),
          centerY(),
          sphereRadius * 4
        );
        gradient.addColorStop(0, `rgba(34,211,238,${glowAlpha})`);
        gradient.addColorStop(1, "rgba(34,211,238,0)");
        ctx!.fillStyle = gradient;
        ctx!.fillRect(0, 0, width, height);
      }

      particles.forEach((p) => {
        let opacity = 0;
        let drawX = p.x;
        let drawY = p.y;

        if (t < PARTICLES_START_MS) {
          opacity = 0;
        } else if (t < GATHER_START_MS) {
          // Fase 2: aparecen y flotan suave, como en el espacio.
          const local = (t - PARTICLES_START_MS) / (GATHER_START_MS - PARTICLES_START_MS);
          opacity = Math.min(1, local * 1.4);
          drawX = p.startX + Math.sin(t / 900 + p.driftSeed) * 8;
          drawY = p.startY + Math.cos(t / 1100 + p.driftSeed) * 8;
        } else if (t < EXPLODE_MS) {
          // Fase 3: se reúnen formando la esfera de energía.
          const local = easeInOutCubic(Math.min(1, (t - GATHER_START_MS) / (EXPLODE_MS - GATHER_START_MS)));
          drawX = p.startX + (p.targetX - p.startX) * local;
          drawY = p.startY + (p.targetY - p.startY) * local;
          opacity = 1;
        } else {
          // Fase 4: la esfera explota suavemente y las partículas se
          // desvanecen mientras el logo (HTML) aparece encima.
          const local = Math.min(1, (t - EXPLODE_MS) / 500);
          const burst = local * sphereRadius * 3.5;
          drawX = p.targetX + Math.cos(p.burstAngle) * burst;
          drawY = p.targetY + Math.sin(p.burstAngle) * burst * 0.85;
          opacity = Math.max(0, 1 - local);
        }

        if (opacity <= 0) return;
        ctx!.beginPath();
        ctx!.fillStyle = p.color;
        ctx!.globalAlpha = opacity;
        ctx!.arc(drawX, drawY, p.size, 0, Math.PI * 2);
        ctx!.fill();
      });

      ctx!.globalAlpha = 1;

      if (t < EXPLODE_MS + 600) {
        rafId = requestAnimationFrame(frame);
      }
    }

    rafId = requestAnimationFrame(frame);

    return () => {
      cancelAnimationFrame(rafId);
      window.removeEventListener("resize", resize);
    };
  }, [reducedMotion]);

  return (
    <div
      role="status"
      aria-label="Iniciando VIMDY"
      className={`fixed inset-0 z-[9999] bg-black flex flex-col items-center justify-center overflow-hidden select-none ${
        fadeOut ? "animate-vimdy-intro-fadeout" : ""
      }`}
    >
      {!reducedMotion && (
        <canvas ref={canvasRef} className="absolute inset-0 pointer-events-none" aria-hidden="true" />
      )}

      <div className="relative flex flex-col items-center justify-center gap-6">
        {showLogo && (
          <div className="animate-vimdy-intro-logo">
            <VimdyLogo size={140} />
          </div>
        )}

        {showTagline && (
          <div className="animate-vimdy-intro-tagline text-center">
            <p className="text-2xl sm:text-3xl font-bold text-white tracking-wide">VIMDY</p>
            <p className="mt-1 text-xs sm:text-sm text-cyan-300/80 uppercase tracking-[0.2em]">
              El futuro de los negocios comienza hoy
            </p>
          </div>
        )}
      </div>
    </div>
  );
}