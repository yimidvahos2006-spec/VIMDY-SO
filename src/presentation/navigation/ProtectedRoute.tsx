import React from "react";
import { Navigate } from "react-router-dom";

import { useAuth } from "../context/AuthContext";

interface Props {
  children: React.ReactNode;
  /** Si se indica, además de estar logueado, exige este permiso puntual. */
  requires?: string;
}

/**
 * Envuelve una ruta y la protege: si no hay sesión, redirige a /login.
 * Si se pasa `requires`, además exige que el rol del usuario tenga ese
 * permiso — si no lo tiene, lo manda de vuelta al Dashboard en lugar de
 * dejarlo entrar a una pantalla que no le corresponde.
 */
export function ProtectedRoute({ children, requires }: Props) {
  const { isAuthenticated, isReady, can } = useAuth();

  if (!isReady) return null;

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  if (requires && !can(requires)) {
    return <Navigate to="/dashboard" replace />;
  }

  return <>{children}</>;
}