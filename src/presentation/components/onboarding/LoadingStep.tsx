import { useEffect, useState } from "react";

import { GlassCard } from "../ui/GlassCard";

interface LoadingStepProps {
  onDone: () => void;
}

/**
 * PASO 10 del asistente de onboarding (FASE 3).
 *
 * No guarda nada nuevo en Supabase: todo lo real (módulos, mesas,
 * categorías, producto, caja) ya quedó guardado en los pasos anteriores.
 * Esta pantalla es la transición visual del documento de producto —
 * confirma en orden lo que de verdad ya se hizo, con una duración total
 * de ~4 segundos, y avanza sola al PASO 11.
 */
const CHECKLIST = [
  "Preparando módulos...",
  "Activando IA...",
  "Organizando inventario...",
  "Creando Dashboard...",
  "Todo listo."
];

const STEP_DELAY_MS = 700;

export function LoadingStep({ onDone }: LoadingStepProps) {
  const [visibleCount, setVisibleCount] = useState(0);

  useEffect(() => {
    if (visibleCount >= CHECKLIST.length) {
      const finalTimer = setTimeout(onDone, 500);
      return () => clearTimeout(finalTimer);
    }

    const timer = setTimeout(() => setVisibleCount((count) => count + 1), STEP_DELAY_MS);
    return () => clearTimeout(timer);
  }, [visibleCount, onDone]);

  return (
    <GlassCard className="w-full max-w-sm px-8 py-12 text-center hover:translate-y-0 hover:scale-100 hover:border-slate-800 hover:shadow-xl">
      <h2 className="text-xl font-bold text-white tracking-wide mb-8">
        Configurando negocio...
      </h2>

      <div className="flex flex-col gap-3 text-left">
        {CHECKLIST.map((label, index) => {
          const isVisible = index < visibleCount;
          return (
            <div
              key={label}
              className={`flex items-center gap-3 transition-opacity duration-300 ${
                isVisible ? "opacity-100" : "opacity-0"
              }`}
            >
              <span className="text-emerald-400">✓</span>
              <span className="text-sm text-slate-300">{label}</span>
            </div>
          );
        })}
      </div>
    </GlassCard>
  );
}