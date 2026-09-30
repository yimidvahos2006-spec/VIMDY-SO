import { useEffect, useState } from "react";
import { Rocket, Loader2, CheckCircle2 } from "lucide-react";

import { VimdyCard } from "../ui/VimdyCard";
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
    <div className="w-full max-w-3xl mx-auto">
      <div className="text-center mb-10">
        <h2 className="text-vimdy-h2 text-vimdy-text mb-2">Tu negocio está listo</h2>
        <p className="text-vimdy-small text-vimdy-text-secondary max-w-md mx-auto">
          Ya puedes comenzar a vender.
        </p>
      </div>

      <VimdyCard padding="lg" className="w-full max-w-md mx-auto text-center relative overflow-visible">
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

        <div className="flex flex-col items-center gap-5 relative z-10 py-8">
          <div className="w-16 h-16 rounded-full bg-vimdy-accent/15 text-vimdy-accent flex items-center justify-center">
            <CheckCircle2 size={32} strokeWidth={1.8} />
          </div>

          <div className="flex flex-col gap-2">
            <h1 className="text-vimdy-h2 text-vimdy-text tracking-wide">
              Tu negocio está listo.
            </h1>
            <p className="text-vimdy-small text-vimdy-text-secondary">
              Ya puedes comenzar a vender.
            </p>
          </div>

          <VimdyButton onClick={handleFinish} disabled={finishing} className="mt-4 min-w-[260px]">
            {finishing ? (
              <span className="flex items-center gap-2">
                <Loader2 size={18} className="animate-spin" />
                Entrando...
              </span>
            ) : (
              <span className="flex items-center gap-2">
                <Rocket size={18} strokeWidth={1.8} />
                Empezar a vender
              </span>
            )}
          </VimdyButton>

          {error && (
            <div className="flex items-start gap-2 rounded-vimdy-md border border-vimdy-danger/40 bg-vimdy-danger-bg px-4 py-3 text-vimdy-small text-vimdy-danger">
              <span className="mt-0.5 shrink-0">⚠</span>
              <span>{error}</span>
            </div>
          )}
        </div>
      </VimdyCard>
    </div>
  );
}