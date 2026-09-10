import { VimdyLogo } from "../ui/VimdyLogo";
import { VimdyButton } from "../ui/VimdyButton";
import { WelcomeEmblem } from "./WelcomeEmblem";
import { WelcomeAmbientMotes } from "./WelcomeAmbientMotes";

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
 *
 * Rediseño (2026-09): antes usaba GlassCard + emoji. Ahora sigue el
 * patrón "bienvenida profesional" aprobado con Yimid: logo real de marca,
 * saludo grande, un solo mensaje de confianza, un solo CTA. Sin iconos
 * decorativos, sin degradados fuera del isotipo (VimdyLogo ya es la
 * única excepción permitida por el design system).
 *
 * Tratamiento premium (2026-09, solo esta pantalla): emblema facetado
 * con barrido de luz, partículas ambientales y glow radial alrededor
 * del CTA. Nada de esto se reutiliza en el resto de la app.
 */
export function WelcomeStep({ ownerName, onStart }: WelcomeStepProps) {
  return (
    <div className="w-full max-w-md text-center relative">
      {/* Contenedor local con borde degradé sutil (única licencia nueva) */}
      <div className="relative rounded-vimdy-lg bg-vimdy-surface p-8 md:p-10 overflow-hidden">
        {/* Borde degradé vía pseudo-elemento ::before */}
        <div
          className="pointer-events-none absolute inset-0 rounded-vimdy-lg"
          style={{
            border: "1px solid transparent",
            background:
              "linear-gradient(135deg, rgba(56,189,248,.35), transparent 40%, rgba(37,99,235,.35))",
            backgroundClip: "padding-box",
            WebkitBackgroundClip: "padding-box",
          } as React.CSSProperties}
        />

        {/* Partículas ambientales (dentro del contenedor) */}
        <WelcomeAmbientMotes />

        <div className="relative z-10">
          <div className="flex justify-center gap-1.5 mb-10" aria-hidden="true">
            <span className="w-5 h-[3px] rounded-full bg-vimdy-accent" />
            <span className="w-5 h-[3px] rounded-full bg-vimdy-border-subtle" />
            <span className="w-5 h-[3px] rounded-full bg-vimdy-border-subtle" />
          </div>

          <div className="mx-auto mb-8 flex justify-center">
            <WelcomeEmblem />
          </div>

          <p className="text-vimdy-micro text-vimdy-text-tertiary mb-2">
            Bienvenido a VIMDY
          </p>
          <h1 className="text-vimdy-h1 text-vimdy-text mb-4">
            Hola{ownerName ? `, ${ownerName}` : ""}
          </h1>
          <p className="text-vimdy-body text-vimdy-text-secondary max-w-[340px] mx-auto mb-12">
            Vamos a dejar tu negocio operando en unos minutos. Puedes ajustar
            cada cosa después, a tu ritmo.
          </p>

          {/* Glow radial detrás del botón (group-hover / focus-within) */}
          <div className="relative group">
            <div
              className="absolute inset-0 -z-10 rounded-full opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity duration-200"
              style={{
                background:
                  "radial-gradient(circle, rgba(37,99,235,.15), transparent 70%)",
                filter: "blur(24px)",
                transform: "scale(1.4)",
              }}
            />
            <VimdyButton onClick={onStart} variant="primary" size="lg" fullWidth>
              Comenzar
            </VimdyButton>
          </div>

          <p className="text-vimdy-small text-vimdy-text-tertiary mt-4">
            Toma unos 4 minutos
          </p>
        </div>
      </div>
    </div>
  );
}