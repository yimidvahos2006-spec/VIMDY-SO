import React, { useEffect } from "react";
import { Navigate } from "react-router-dom";

import { copilotStore } from "../../core/store/copilotStore";
import { homePathForRole } from "../../core/config/roleAccess";
import { useAuth } from "../context/AuthContext";

/**
 * CopilotPage — "/ia"
 * ---------------------------------------------------------------------------
 * VIMDY IA ya NO es una pantalla: vive en el panel flotante (CopilotPanel),
 * montado en VimdyAppLayout por encima de todos los módulos. Esta ruta solo se
 * conserva para enlaces/marcadores viejos: abre el panel y deja al usuario en
 * la pantalla de inicio de su rol.
 */
export function CopilotPage() {
  const { role } = useAuth();

  useEffect(() => {
    copilotStore.open();
  }, []);

  return <Navigate to={homePathForRole(role?.name)} replace />;
}

export default CopilotPage;