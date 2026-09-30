import React, { useEffect, useState } from "react";
import { VimdyLogo } from "../ui/VimdyLogo";

/**
 * WelcomeEmblem — emblema premium del Paso 2 (WelcomeStep).
 *
 * Solo se usa aquí. Renderiza una faceta (hexágono vía clip-path) con
 * el degradé azul del isotipo (vimdy-blue → vimdy-accent) a baja
 * opacidad, borde sutil, un barrido de luz diagonal (una sola vez)
 * y un pulso reutilizando .animate-vimdy-breath.
 *
 * No toca VimdyLogo.tsx: ese componente se importa normalmente
 * con size={40} y se coloca encima de la faceta.
 */
export function WelcomeEmblem() {
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduced(mq.matches);
    const handler = (e: MediaQueryListEvent) => setReduced(e.matches);
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []);

  return (
    <div className="relative shrink-0 w-24 h-24 flex items-center justify-center">
      {/* Faceta: hexágono con degradé sutil del isotipo */}
      <div
        className="absolute inset-0"
        style={{
          clipPath:
            "polygon(25% 0%, 75% 0%, 100% 50%, 75% 100%, 25% 100%, 0% 50%)",
          background:
            "linear-gradient(135deg, rgba(56,189,248,.18), rgba(37,99,235,.10))",
          border: "1px solid rgba(37,99,235,.40)",
        }}
      >
        {!reduced && (
          <div
            className="absolute inset-0 animate-vimdy-emblem-sweep"
            style={{
              background:
                "linear-gradient(90deg, transparent, rgba(56,189,248,.35), transparent)",
              mixBlendMode: "screen" as const,
            }}
          />
        )}
      </div>

      {/* Pulso de fondo (reutiliza clase existente) */}
      {!reduced && (
        <div className="absolute inset-0 rounded-full animate-vimdy-breath" />
      )}

      {/* Logo real, siempre visible, sin modifications */}
      <div className="relative z-10">
        <VimdyLogo size={40} />
      </div>
    </div>
  );
}