import React from "react";
import { Navigate, useLocation } from "react-router-dom";

import { companyConfigStore } from "../../core/store/companyConfigStore";

interface Props {
  children: React.ReactNode;
}

/**
 * Envuelve /login, /registro, /verificar-codigo, /recuperar-password y
 * /actualizar-password. Si este dispositivo nunca pasó por el selector de
 * país (/pais), lo redirige ahí primero — así toda la app (idioma, moneda,
 * hora) queda configurada ANTES de que el visitante vea el login, tal como
 * pide el flujo: primero país, y ese país cambia automáticamente el resto.
 *
 * Guarda la ruta original en location.state.from para que
 * CountrySelectionPage pueda mandarlo de vuelta exactamente ahí (ej. si
 * alguien entró con un link directo a /registro) en vez de siempre a
 * /login.
 */
export function RequireCountry({ children }: Props) {
  const location = useLocation();

  if (!companyConfigStore.hasSelectedCountry()) {
    return (
      <Navigate
        to="/pais"
        replace
        state={{ from: location.pathname + location.search }}
      />
    );
  }

  return <>{children}</>;
}