import React from "react";
import { Navigate } from "react-router-dom";

import { useAuth } from "../context/AuthContext";

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
 *   - Si ya la terminó, no hace nada y deja pasar la ruta normalmente.
 *
 * Se coloca DENTRO de ProtectedRoute (ver App.tsx), así que cuando esto se
 * evalúa ya sabemos que hay una sesión válida y que useAuth().isReady es true.
 */
export function OnboardingGate({ children }: Props) {
  const { onboardingCompleted } = useAuth();

  if (!onboardingCompleted) {
    return <Navigate to="/onboarding" replace />;
  }

  return <>{children}</>;
}