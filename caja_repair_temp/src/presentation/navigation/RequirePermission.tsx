import React from "react";
import { ShieldAlert } from "lucide-react";

import { useAuth } from "../context/AuthContext";

interface Props {
  children: React.ReactNode;
  /** Permiso puntual que el rol activo debe tener para ver el contenido. */
  requires: string;
}

/**
 * Segunda capa de defensa de permisos, a nivel de página en vez de a nivel
 * de ruta.
 *
 * `ProtectedRoute` (routes/App.tsx) ya bloquea la navegación por URL, pero
 * eso depende de que TODO el que agregue o reordene una ruta se acuerde de
 * envolverla con `requires`. Si mañana alguien monta uno de estos
 * dashboards en otro lugar del árbol (un modal, un embed, un test, una
 * ruta nueva sin querer desprotegida), este guard sigue funcionando
 * porque no depende de dónde vive el componente — solo de si el rol
 * activo tiene el permiso.
 *
 * `isReady === false` (sesión todavía cargando) no bloquea, igual que
 * hace ProtectedRoute, para no mostrar "acceso restringido" por un
 * instante mientras se resuelve el rol.
 */
export function RequirePermission({ children, requires }: Props) {
  const { can, isReady } = useAuth();

  if (!isReady) return null;

  if (!can(requires)) {
    return (
      <div className="min-h-screen flex items-center justify-center p-8">
        <div className="text-center max-w-sm">
          <ShieldAlert className="w-10 h-10 text-slate-600 mx-auto mb-3" />
          <p className="text-lg font-semibold text-white">Acceso restringido</p>
          <p className="text-sm text-slate-400 mt-1">
            Tu rol no tiene permiso para ver esta sección. Si creés que
            deberías tenerlo, pedile a un administrador que lo revise.
          </p>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}