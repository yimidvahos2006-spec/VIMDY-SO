import React, { useId } from "react";

import "./CopilotOrb.css";

export type CopilotOrbState =
  | "idle"
  | "listening"
  | "thinking"
  | "responding"
  | "angry"
  | "wink"
  | "success"
  | "warning";

interface CopilotOrbProps {
  /** Estado visual: reposo, escuchando, pensando, respondiendo o una reacción (angry, wink, success, warning). */
  state?: CopilotOrbState;
  /** Diámetro total en px (incluye el espacio del anillo y las ondas). */
  size?: number;
  /**
   * false = esfera estática y liviana (sin anillo, ondas ni barras).
   * Úsalo para los avatares pequeños dentro de cada mensaje.
   */
  animated?: boolean;
  className?: string;
}

const BAR_COUNT = 5;

/**
 * CopilotOrb
 * ---------------------------------------------------------------------------
 * Avatar animado de VIMDY IA (estilo "orbe"). Todo es CSS + SVG: sin
 * librerías ni imágenes. Los estados cambian con el atributo data-state y
 * las animaciones viven en CopilotOrb.css:
 *
 *  - idle       → respiración suave
 *  - listening  → pulsación activa + ondas que se expanden
 *  - thinking   → anillo de partículas girando (violeta)
 *  - responding → barras de audio + ondas suaves
 *  - angry      → rojo intenso, parpadeo rápido y vibración
 *  - wink       → destello lateral rápido (felicitación / venta récord)
 *  - success    → verde brillante con pulso (buenas noticias)
 *  - warning    → amarillo con pulso lento (alertas)
 *
 * Es decorativo (aria-hidden): el estado en texto lo anuncia la página.
 */
export function CopilotOrb({ state = "idle", size = 120, animated = true, className = "" }: CopilotOrbProps) {
  // useId devuelve ids con ":", que dan problemas dentro de url(#...) en SVG.
  const gradientId = `orb-arc-${useId().replace(/:/g, "")}`;

  return (
    <div
      className={`copilot-orb ${className}`.trim()}
      data-state={state}
      data-animated={animated ? "true" : "false"}
      style={{ width: size, height: size, ["--orb-size" as string]: `${size}px` }}
      aria-hidden="true"
    >
      <span className="copilot-orb__halo" />

      {animated && (
        <>
          <span className="copilot-orb__ripple copilot-orb__ripple--1" />
          <span className="copilot-orb__ripple copilot-orb__ripple--2" />
          <span className="copilot-orb__ripple copilot-orb__ripple--3" />
        </>
      )}

      <span className="copilot-orb__body">
        <span className="copilot-orb__blob copilot-orb__blob--a" />
        <span className="copilot-orb__blob copilot-orb__blob--b" />
        <span className="copilot-orb__blob copilot-orb__blob--c" />
        <span className="copilot-orb__gloss" />
        {animated && (
          <span className="copilot-orb__face">
            <span className="copilot-orb__brow copilot-orb__brow--l" />
            <span className="copilot-orb__brow copilot-orb__brow--r" />
            <span className="copilot-orb__eye copilot-orb__eye--l" />
            <span className="copilot-orb__eye copilot-orb__eye--r" />
            <span className="copilot-orb__mouth" />
          </span>
        )}
        {animated && <span className="copilot-orb__flash" />}
        {animated && (
          <span className="copilot-orb__bars">
            {Array.from({ length: BAR_COUNT }, (_, i) => (
              <span key={i} className="copilot-orb__bar" />
            ))}
          </span>
        )}
      </span>

      {animated && (
        <svg className="copilot-orb__ring" viewBox="0 0 100 100" fill="none">
          <defs>
            <linearGradient id={gradientId} x1="0" y1="0" x2="100" y2="100" gradientUnits="userSpaceOnUse">
              <stop offset="0" stopColor="currentColor" stopOpacity="1" />
              <stop offset="1" stopColor="currentColor" stopOpacity="0.05" />
            </linearGradient>
          </defs>
          <g className="copilot-orb__ring-dots">
            <circle cx="50" cy="50" r="46" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeDasharray="0.01 7.2" />
          </g>
          <g className="copilot-orb__ring-dots-inner">
            <circle cx="50" cy="50" r="41.5" stroke="currentColor" strokeOpacity="0.55" strokeWidth="1.6" strokeLinecap="round" strokeDasharray="0.01 10.8" />
          </g>
          <g className="copilot-orb__ring-arc">
            <circle cx="50" cy="50" r="44" stroke={`url(#${gradientId})`} strokeWidth="2.6" strokeLinecap="round" strokeDasharray="62 214" />
          </g>
        </svg>
      )}
    </div>
  );
}

export default CopilotOrb;