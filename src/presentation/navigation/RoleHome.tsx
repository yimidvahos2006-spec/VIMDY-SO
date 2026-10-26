import React from "react";
import { Navigate } from "react-router-dom";

import { useAuth } from "../context/AuthContext";
import { homePathForRole, roleHasCustomHome } from "../../core/config/roleAccess";

/**
 * Ruta "/": manda a cada rol a su pantalla de inicio (MESERO -> /meseros,
 * el resto -> /dashboard).
 */
export function RoleHomeRedirect() {
  const { role } = useAuth();
  return <Navigate to={homePathForRole(role?.name)} replace />;
}

/**
 * Envuelve el Dashboard. Los roles con pantalla propia (MESERO) nunca ven el
 * Dashboard: se redirige antes de renderizarlo, así que ni siquiera se
 * descarga su código. Como TODOS los flujos de login/selector de negocio
 * terminan en "/dashboard", este es el punto único que decide el destino
 * real tras iniciar sesión.
 */
export function DashboardGate({ children }: { children: React.ReactNode }) {
  const { role } = useAuth();

  if (roleHasCustomHome(role?.name)) {
    return <Navigate to={homePathForRole(role?.name)} replace />;
  }

  return <>{children}</>;
}