import { useEffect, useState } from "react";

/**
 * WelcomeAmbientMotes — partículas flotantes para WelcomeStep.
 *
 * 7 puntitos (3-4px, rounded-full, bg-vimdy-accent a 30-40% opacidad)
 * con posiciones absolutas y delays/distintos. aria-hidden y
 * pointer-events:none. Si prefers-reduced-motion está activo,
 * retorna null.
 */
const MOTES = [
  { left: "8%",  delay: "0s",  duration: "9s"  },
  { left: "22%", delay: "1.4s", duration: "11s" },
  { left: "38%", delay: "0.6s", duration: "8s"  },
  { left: "55%", delay: "2.1s", duration: "10s" },
  { left: "70%", delay: "0.3s", duration: "12s" },
  { left: "84%", delay: "1.8s", duration: "9.5s" },
  { left: "92%", delay: "0.9s", duration: "11s" },
];

export function WelcomeAmbientMotes() {
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduced(mq.matches);
    const handler = (e: MediaQueryListEvent) => setReduced(e.matches);
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []);

  if (reduced) return null;

  return (
    <div
      className="absolute inset-0 overflow-hidden pointer-events-none"
      aria-hidden="true"
    >
      {MOTES.map((m, i) => (
        <div
          key={i}
          className="absolute w-1 h-1 rounded-full bg-vimdy-accent animate-vimdy-mote"
          style={{
            left: m.left,
            bottom: "-20px",
            opacity: 0.35,
            animationDelay: m.delay,
            animationDuration: m.duration,
          }}
        />
      ))}
    </div>
  );
}