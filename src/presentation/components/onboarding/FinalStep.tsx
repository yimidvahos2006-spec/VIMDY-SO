import { useEffect, useState } from "react";

import { GlassCard } from "../ui/GlassCard";
import { VimdyButton } from "../ui/VimdyButton";
import { useAuth } from "../../context/AuthContext";

interface Particle {
  id: number;
  x: number;
  delay: number;
  duration: number;
  color: string;
  size: number;
}

const COLORS = ["#38BDF8", "#2563EB", "#A855F7", "#F472B6", "#FBBF24", "#34D399"];

function createParticles(count: number): Particle[] {
  return Array.from({ length: count }, (_, i) => ({
    id: i,
    x: Math.random() * 100,
    delay: Math.random() * 0.5,
    duration: 1.5 + Math.random() * 1.5,
    color: COLORS[Math.floor(Math.random() * COLORS.length)],
    size: 4 + Math.random() * 6
  }));
}

export function FinalStep() {
  const { completeOnboarding } = useAuth();
  const [finishing, setFinishing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [particles] = useState(() => createParticles(40));

  useEffect(() => {
    const styleId = "confetti-keyframes";
    if (document.getElementById(styleId)) return;

    const style = document.createElement("style");
    style.id = styleId;
    style.textContent = `
      @keyframes confetti-fall {
        0% { transform: translateY(-10px) rotate(0deg); opacity: 1; }
        100% { transform: translateY(100vh) rotate(720deg); opacity: 0; }
      }
    `;
    document.head.appendChild(style);

    return () => {
      document.head.removeChild(style);
    };
  }, []);

  async function handleFinish() {
    if (finishing) return;
    setFinishing(true);
    setError(null);

    try {
      await completeOnboarding();
    } catch (err) {
      const message = err instanceof Error ? err.message : "No se pudo terminar la configuración.";
      setError(message);
      setFinishing(false);
    }
  }

  return (
    <GlassCard className="w-full max-w-md px-8 py-12 text-center hover:translate-y-0 hover:scale-100 hover:border-slate-800 hover:shadow-xl relative overflow-visible">
      <div
        aria-hidden="true"
        className="pointer-events-none fixed inset-0 overflow-hidden"
        style={{ zIndex: 50 }}
      >
        {particles.map((p) => (
          <span
            key={p.id}
            className="absolute rounded-sm"
            style={{
              left: `${p.x}%`,
              top: "-10px",
              width: `${p.size}px`,
              height: `${p.size}px`,
              backgroundColor: p.color,
              animation: `confetti-fall ${p.duration}s ease-in ${p.delay}s forwards`
            }}
          />
        ))}
      </div>

      <div className="flex flex-col items-center gap-5 relative z-10">
        <span className="text-5xl">🎉</span>

        <div className="flex flex-col gap-2">
          <h1 className="text-2xl sm:text-3xl font-bold text-white tracking-wide">
            Tu negocio está listo.
          </h1>
          <p className="text-slate-300 text-base">Ya puedes comenzar a vender.</p>
        </div>

        <VimdyButton onClick={handleFinish} disabled={finishing} className="mt-2 min-w-[260px]">
          {finishing ? "Entrando..." : "🚀 EMPEZAR A VENDER"}
        </VimdyButton>

        {error && <p className="text-sm text-red-400">{error}</p>}
      </div>
    </GlassCard>
  );
}
