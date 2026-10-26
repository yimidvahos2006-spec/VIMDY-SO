import { ShieldAlert } from "lucide-react";

import { useAuth } from "../context/AuthContext";

interface Props {
  title?: string;
  message?: string;
}

/**
 * Pantalla final cuando NO hay a dónde redirigir (la ruta bloqueada ya es la
 * pantalla de inicio del rol). Mostrar un aviso en vez de redirigir es lo que
 * evita el bucle infinito de redirecciones.
 */
export function AccessDeniedScreen({
  title = "Acceso restringido",
  message = "Tu rol no tiene acceso a esta sección. Pídele a un administrador que revise tus permisos."
}: Props) {
  const { logout } = useAuth();

  return (
    <div className="min-h-screen flex items-center justify-center p-8">
      <div className="text-center max-w-sm">
        <ShieldAlert className="w-10 h-10 text-slate-600 mx-auto mb-3" />
        <p className="text-lg font-semibold text-white">{title}</p>
        <p className="text-sm text-slate-400 mt-1">{message}</p>
        <button
          type="button"
          onClick={() => void logout()}
          className="mt-5 px-4 py-2 rounded-xl text-sm font-medium text-red-400 hover:text-red-300 hover:bg-red-500/10 transition-all"
        >
          Cerrar sesión
        </button>
      </div>
    </div>
  );
}