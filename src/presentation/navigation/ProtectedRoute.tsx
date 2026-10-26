import React from "react";
import { Navigate, useLocation } from "react-router-dom";

import { useAuth } from "../context/AuthContext";
import { hasAnyPermission, resolveDeniedRedirect } from "../../core/config/roleAccess";
import { AccessDeniedScreen } from "./AccessDeniedScreen";

interface Props {
  children: React.ReactNode;
  /**
   * Si se indica, además de estar logueado, exige este permiso puntual.
   * Con una lista basta con tener UNO de los permisos.
   */
  requires?: string | readonly string[];
}

/**
 * Envuelve una ruta y la protege: si no hay sesión, redirige a /login.
 * Si se pasa `requires`, además exige que el rol del usuario tenga ese
 * permiso — si no lo tiene, lo manda a SU pantalla de inicio (el Dashboard, o
 * /meseros para un MESERO) en vez de dejarlo entrar a una pantalla que no le
 * corresponde.
 *
 * Sin bucles: si la ruta bloqueada ya ES la pantalla de inicio del rol, no hay
 * a dónde redirigir; se muestra un aviso en lugar de volver a redirigir.
 */
export function ProtectedRoute({ children, requires }: Props) {
  const { isAuthenticated, isReady, can, role } = useAuth();
  const location = useLocation();

  if (!isReady) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#050505]">
        <div className="w-8 h-8 rounded-full border-2 border-cyan-500/30 border-t-cyan-400 animate-spin" />
      </div>
    );
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  if (!hasAnyPermission(can, requires)) {
    const target = resolveDeniedRedirect(location.pathname, role?.name);
    if (target === null) {
      return <AccessDeniedScreen />;
    }
    return <Navigate to={target} replace />;
  }

  return <>{children}</>;
}