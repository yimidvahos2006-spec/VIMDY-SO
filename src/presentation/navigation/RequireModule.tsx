import React from "react";
import { Navigate } from "react-router-dom";

import { useEnabledModules } from "../../core/store/useEnabledModules";
import type { ModuleId } from "../../core/config/modules";

interface Props {
  children: React.ReactNode;
  /** Módulo que esta ruta necesita para tener sentido (ver core/config/modules.ts). */
  module: ModuleId;
}

/**
 * Envuelve una ruta que solo tiene sentido si el negocio activó ese módulo
 * en el onboarding (PASO 4 — ver ModulesStep.tsx y modules.ts).
 *
 * Hasta ahora, "navegación condicional" solo pasaba por VimdySidebar
 * ocultando el enlace del menú — pero nada impedía entrar escribiendo la
 * URL a mano, con un link viejo guardado, o volviendo con el botón "atrás"
 * del navegador después de que el dueño desactivó ese módulo. Una Tienda
 * sin el módulo "mesas" podía terminar de todas formas en /meseros viendo
 * una pantalla de mesas que no le corresponde ni tiene datos reales.
 *
 * `enabledModules === null` significa "todavía no se sabe" (sesión
 * cargando) — en ese caso se deja pasar sin bloquear, igual que hace
 * VimdySidebar, para no expulsar a alguien por una carga que apenas va a
 * tardar un instante. Una vez se conoce la lista real, si el módulo no
 * está en ella, se manda a /dashboard en vez de dejarlo entrar.
 */
export function RequireModule({ children, module }: Props) {
  const enabledModules = useEnabledModules();

  if (enabledModules !== null && !enabledModules.includes(module)) {
    return <Navigate to="/dashboard" replace />;
  }

  return <>{children}</>;
}