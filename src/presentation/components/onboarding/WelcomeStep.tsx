import { VimdyLogo } from "../ui/VimdyLogo";
import { VimdyButton } from "../ui/VimdyButton";
import { GlassCard } from "../ui/GlassCard";

interface WelcomeStepProps {
  /** Nombre real del dueño, viene de useAuth() — vacío si Supabase todavía no lo resolvió. */
  ownerName?: string;
  onStart: () => void;
}

/**
 * PASO 2 del asistente de onboarding (FASE 3).
 *
 * Pantalla de bienvenida pura: no lee ni escribe nada en Supabase — solo
 * saluda y dispara onStart() para avanzar al PASO 3 (tipo de negocio).
 * El nombre que muestra es el real de la sesión (useAuth().user.name),
 * nunca un placeholder inventado.
 */
export function WelcomeStep({ ownerName, onStart }: WelcomeStepProps) {
  return (
    <GlassCard className="w-full max-w-md px-8 py-12 text-center hover:translate-y-0 hover:scale-100 hover:border-slate-800 hover:shadow-xl">
      <div className="flex flex-col items-center gap-6">
        <VimdyLogo size={90} />

        <div className="flex flex-col gap-3">
          <h1 className="text-2xl sm:text-3xl font-bold text-white tracking-wide">
            <span className="wave-hand inline-block mr-2">👋</span>
            Bienvenido a VIMDY{ownerName ? `, ${ownerName}` : ""}
          </h1>

          <p className="text-slate-300 text-base">Vamos a preparar tu negocio.</p>

          <p className="text-slate-500 text-sm">Solo tomará unos minutos.</p>
        </div>

        <VimdyButton onClick={onStart} className="mt-2 min-w-[220px]">
          Comenzar
        </VimdyButton>
      </div>
    </GlassCard>
  );
}