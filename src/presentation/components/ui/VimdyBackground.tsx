import React from "react";

interface Props {
  children: React.ReactNode;
}

/**
 * VimdyBackground — fondo oficial para pantallas de autenticación
 * (Login, Registro, OTP, Recuperar/Actualizar contraseña, Selección
 * de país) y la intro.
 *
 * Reemplaza la versión anterior, que usaba un `linear-gradient` de
 * 500% animado que en varios momentos de su ciclo llenaba toda la
 * pantalla de azul sólido (bug visual reportado). Aquí el movimiento
 * vuelve, pero acotado: los resplandores respiran y se desplazan
 * unos pocos px en un ciclo largo (14-22s) sin salir nunca de su
 * zona ni subir de opacidad más allá de lo ambiental — nunca pueden
 * llegar a cubrir la pantalla. Respeta prefers-reduced-motion.
 */
export function VimdyBackground({ children }: Props) {
  return (
    <div className="relative min-h-screen overflow-hidden bg-vimdy-background">
      <style>{`
        @keyframes vimdy-bg-drift-a {
          0%, 100% { transform: translate3d(-50%, 0, 0) scale(1); opacity: 0.85; }
          50% { transform: translate3d(-46%, 3%, 0) scale(1.08); opacity: 1; }
        }
        @keyframes vimdy-bg-drift-b {
          0%, 100% { transform: translate3d(0, 0, 0) scale(1); opacity: 0.7; }
          50% { transform: translate3d(-3%, -4%, 0) scale(1.12); opacity: 1; }
        }
        .vimdy-bg-glow-a { animation: vimdy-bg-drift-a 18s ease-in-out infinite; }
        .vimdy-bg-glow-b { animation: vimdy-bg-drift-b 22s ease-in-out infinite; animation-delay: -6s; }
        @media (prefers-reduced-motion: reduce) {
          .vimdy-bg-glow-a, .vimdy-bg-glow-b { animation: none; }
        }
      `}</style>

      {/* Resplandor superior — marca, se desplaza y respira suavemente */}
      <div
        className="vimdy-bg-glow-a pointer-events-none absolute -top-[420px] left-1/2 h-[820px] w-[820px] rounded-full blur-[160px]"
        style={{ background: "radial-gradient(circle, rgba(56,189,248,0.13), transparent 70%)" }}
      />

      {/* Resplandor inferior — acento, ciclo distinto para que no se sincronicen */}
      <div
        className="vimdy-bg-glow-b pointer-events-none absolute -bottom-[360px] -right-[280px] h-[700px] w-[700px] rounded-full blur-[160px]"
        style={{ background: "radial-gradient(circle, rgba(37,99,235,0.10), transparent 70%)" }}
      />

      {/* Rejilla fina, enmascarada para que solo se insinúe cerca del centro */}
      <div
        className="pointer-events-none absolute inset-0 opacity-[0.05]"
        style={{
          backgroundImage: `
            linear-gradient(rgba(245,245,244,.5) 1px, transparent 1px),
            linear-gradient(90deg, rgba(245,245,244,.5) 1px, transparent 1px)
          `,
          backgroundSize: "64px 64px",
          maskImage: "radial-gradient(ellipse 60% 50% at 50% 35%, black, transparent)",
          WebkitMaskImage: "radial-gradient(ellipse 60% 50% at 50% 35%, black, transparent)"
        }}
      />

      {/* Viñeta — profundidad hacia los bordes, foco hacia el centro */}
      <div
        className="pointer-events-none absolute inset-0"
        style={{ boxShadow: "inset 0 0 220px 40px rgba(0,0,0,0.55)" }}
      />

      <div className="relative z-10">{children}</div>
    </div>
  );
}