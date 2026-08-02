import React, { useMemo } from "react";

function VimdyParticlesComponent() {

  // useMemo evita recalcular 40 posiciones/tamaños aleatorios (y por lo
  // tanto que las partículas "salten" de lugar) cada vez que el layout
  // padre se re-renderiza por cualquier motivo ajeno al fondo.
  const particles = useMemo(
    () =>
      Array.from({ length: 40 }, () => ({
        width: Math.random() * 4 + 2,
        height: Math.random() * 4 + 2,
        opacity: Math.random() * 0.6,
        left: Math.random() * 100,
        top: Math.random() * 100,
        duration: 4 + Math.random() * 8
      })),
    []
  );

  return (

    <div className="absolute inset-0 overflow-hidden pointer-events-none">

      {

        particles.map((particle, index) => (

          <span

            key={index}

            className="absolute rounded-full animate-pulse"

            style={{

              width: `${particle.width}px`,

              height: `${particle.height}px`,

              background: "#8FD7FF",

              opacity: particle.opacity,

              left: `${particle.left}%`,

              top: `${particle.top}%`,

              animationDuration: `${particle.duration}s`

            }}

          />

        ))

      }

    </div>

  );

}

export const VimdyParticles = React.memo(VimdyParticlesComponent);