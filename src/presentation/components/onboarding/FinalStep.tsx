import { useState } from "react";

import { GlassCard } from "../ui/GlassCard";
import { VimdyButton } from "../ui/VimdyButton";
import { useAuth } from "../../context/AuthContext";

/**
 * PASO 11 del asistente de onboarding (FASE 3) — pantalla final.
 *
 * Al pulsar "Empezar a vender", marca onboarding_completed = true en
 * Supabase de verdad (useAuth().completeOnboarding(), ver
 * markOnboardingCompleted en authBusinessContext.ts). En cuanto eso
 * termina, OnboardingPage detecta onboardingCompleted === true y
 * redirige sola al Dashboard — no hace falta navegar a mano aquí.
 */
export function FinalStep() {
  const { completeOnboarding } = useAuth();
  const [finishing, setFinishing] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
    <GlassCard className="w-full max-w-md px-8 py-12 text-center hover:translate-y-0 hover:scale-100 hover:border-slate-800 hover:shadow-xl">
      <div className="flex flex-col items-center gap-5">
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