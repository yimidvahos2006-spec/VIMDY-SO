import React, { useState } from "react";
import { Navigate } from "react-router-dom";

import { useAuth } from "../context/AuthContext";
import { VimdyIntro } from "../components/intro/VimdyIntro";
import { appIntroStore } from "../../core/store/appIntroStore";

interface Props {
  children: React.ReactNode;
}

/**
 * Envuelve TODO lo que va detrás del login (Dashboard, Caja, Cocina, etc.)
 * y aplica la regla del PASO 1 del onboarding inteligente:
 *
 *   - Si el negocio todavía no terminó la configuración inicial
 *     (onboardingCompleted === false en Supabase), lo manda automáticamente
 *     a /onboarding en vez de dejarlo entrar al Dashboard.
 *   - Si ya la terminó, muestra la intro cinematográfica de VIMDY UNA sola
 *     vez (appIntroStore, flag en localStorage por dispositivo) y luego
 *     deja pasar a las children (Dashboard, etc.).
 *
 * Se coloca DENTRO de ProtectedRoute (ver App.tsx), así que cuando esto se
 * evalúa ya sabemos que hay una sesión válida y que useAuth().isReady es true.
 */
export function OnboardingGate({ children }: Props) {
  const { onboardingCompleted } = useAuth();
  const [showIntro, setShowIntro] = useState(() => !appIntroStore.hasBeenShown());

  if (!onboardingCompleted) {
    return <Navigate to="/onboarding" replace />;
  }

  if (showIntro) {
    return (
      <VimdyIntro
        onComplete={() => {
          appIntroStore.markShown();
          setShowIntro(false);
        }}
      />
    );
  }

  return <>{children}</>;
}