import React from "react";
import { Navigate } from "react-router-dom";

import { useEnabledModules } from "../../core/store/useEnabledModules";
import type { ModuleId } from "../../core/config/modules";

interface Props {
  children: React.ReactNode;
  module: ModuleId;
}

/**
 * Bloquea una ruta cuando ya conocemos la configuración real del negocio y
 * el módulo solicitado no está habilitado. `null` significa que la sesión
 * todavía se está hidratando; en ese estado no bloqueamos por una lectura
 * temporalmente incompleta. Un arreglo vacío, en cambio, es una decisión real
 * y debe bloquear cualquier módulo que no esté habilitado.
 */
export function RequireModule({ children, module }: Props) {
  const enabledModules = useEnabledModules();

  if (enabledModules !== null && !enabledModules.includes(module)) {
    return <Navigate to="/dashboard" replace />;
  }

  return <>{children}</>;
}