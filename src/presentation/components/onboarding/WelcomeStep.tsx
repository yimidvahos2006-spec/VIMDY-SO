import type { CSSProperties } from "react";

import { VimdyButton } from "../ui/VimdyButton";
import { WelcomeEmblem } from "./WelcomeEmblem";
import { WelcomeAmbientMotes } from "./WelcomeAmbientMotes";

interface WelcomeStepProps {
  /** Nombre real del dueño (el que escribió al registrarse), viene de useAuth(). */
  ownerName?: string;
  onStart: () => void;
}

/** Lo que el usuario va a dejar listo en el asistente (pasos 2 a 7). */
const WELCOME_CHECKLIST: ReadonlyArray<{ title: string; detail: string }> = [
  { title: "Tu negocio", detail: "Tipo de negocio y módulos que vas a usar" },
  { title: "Tu equipo", detail: "Las personas que te ayudan a operar" },
  { title: "Tu carta o catálogo", detail: "Categorías y tu primer producto" },
  { title: "Tu caja", detail: "El dinero con el que abres hoy" },
];

/** Primer nombre con mayúscula inicial: "yimid vahos" → "Yimid". */
function firstNameOf(fullName?: string): string {
  const first = (fullName ?? "").trim().split(/\s+/)[0] ?? "";
  if (!first) return "";
  return first.charAt(0).toLocaleUpperCase("es") + first.slice(1);
}

/**
 * PASO 1 del asistente de onboarding.
 *
 * Pantalla de bienvenida pura: no lee ni escribe nada en Supabase — solo
 * saluda y dispara onStart() para avanzar al PASO 2 (tipo de negocio).
 * El nombre que muestra es el real de la sesión (useAuth().user.name, el
 * mismo que se escribió en el registro), nunca un placeholder inventado.
 *
 * Diseño: emblema de marca, saludo personal con el primer nombre, una
 * lista corta de lo que se va a configurar (para que el usuario sepa qué
 * viene y cuánto falta) y un solo CTA.
 */
export function WelcomeStep({ ownerName, onStart }: WelcomeStepProps) {
  const firstName = firstNameOf(ownerName);

  return (
    <div className="w-full max-w-md text-center relative">
      <div className="relative rounded-vimdy-xl bg-vimdy-surface border border-vimdy-border-subtle p-8 md:p-10 overflow-hidden shadow-vimdy-lg">
        {/* Halo azul suave detrás del emblema */}
        <div
          className="pointer-events-none absolute -top-24 left-1/2 h-64 w-64 -translate-x-1/2 rounded-full"
          style={
            {
              background:
                "radial-gradient(circle, rgba(37,99,235,.22), transparent 70%)",
              filter: "blur(20px)",
            } as CSSProperties
          }
        />

        {/* Partículas ambientales (dentro del contenedor) */}
        <WelcomeAmbientMotes />

        <div className="relative z-10">
          <div className="mx-auto mb-6 flex justify-center">
            <WelcomeEmblem />
          </div>

          <p className="text-vimdy-micro uppercase tracking-[0.18em] text-vimdy-accent mb-3">
            Bienvenido a VIMDY
          </p>
          <h1 className="text-vimdy-h1 text-vimdy-text mb-3">
            {firstName ? `Hola, ${firstName}` : "Hola"}
          </h1>
          <p className="text-vimdy-body text-vimdy-text-secondary max-w-[340px] mx-auto mb-8">
            Vamos a dejar tu negocio listo para vender. Puedes ajustar cada
            cosa después, a tu ritmo.
          </p>

          {/* Qué vamos a configurar */}
          <ul className="mb-8 space-y-2 text-left" aria-label="Lo que vas a configurar">
            {WELCOME_CHECKLIST.map((item, index) => (
              <li
                key={item.title}
                className="flex items-center gap-3 rounded-vimdy-md border border-vimdy-border-subtle bg-vimdy-surface-hover/60 px-4 py-3"
              >
                <span
                  aria-hidden="true"
                  className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-vimdy-accent/40 bg-vimdy-accent/10 text-vimdy-micro text-vimdy-accent"
                >
                  {index + 1}
                </span>
                <span className="min-w-0">
                  <span className="block text-vimdy-small font-semibold text-vimdy-text">
                    {item.title}
                  </span>
                  <span className="block text-vimdy-micro font-normal text-vimdy-text-tertiary">
                    {item.detail}
                  </span>
                </span>
              </li>
            ))}
          </ul>

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