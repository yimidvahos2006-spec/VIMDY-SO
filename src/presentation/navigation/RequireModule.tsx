import React from "react";
import { Navigate } from "react-router-dom";

import { useBusinessOperatingProfile } from "../../core/store/useBusinessOperatingProfile";
import type { ModuleId } from "../../core/config/modules";
import {
  hasBusinessCapability,
  hasBusinessModuleCapability,
  type BusinessCapabilityId,
} from "../../core/config/businessOperatingProfile";

interface Props {
  children: React.ReactNode;
  module: ModuleId;
  alsoCapability?: BusinessCapabilityId;
}

/**
 * Bloquea una ruta cuando ya conocemos la configuración real del negocio y
 * el módulo solicitado no está habilitado. `null` significa que la sesión
 * todavía se está hidratando; en ese estado no bloqueamos por una lectura
 * temporalmente incompleta. Un arreglo vacío, en cambio, es una decisión real
 * y debe bloquear cualquier módulo que no esté habilitado.
 */
export function RequireModule({ children, module, alsoCapability }: Props) {
  const { status, profile } = useBusinessOperatingProfile();

  if (status === "idle" || status === "loading") {
    return <div role="status" aria-live="polite" className="p-6 text-sm text-slate-400">Cargando configuración operativa…</div>;
  }

  const enabled = profile && (
    hasBusinessModuleCapability(profile, module)
    || (alsoCapability ? hasBusinessCapability(profile, alsoCapability) : false)
  );

  if (status !== "ready" || !profile || !enabled) {
    return <Navigate to="/dashboard" replace />;
  }

  return <>{children}</>;
}