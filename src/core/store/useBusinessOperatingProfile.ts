/**
 * useBusinessOperatingProfile.ts
 * ---------------------------------------------------------------------------
 * Hook de lectura del perfil operativo REAL ya hidratado por AuthContext.
 *
 * La carga se realiza una sola vez en el bootstrap de sesión. El hook no
 * dispara consultas propias y por tanto no duplica tráfico a Supabase ni
 * compite con el cambio de negocio.
 */

import { useSyncExternalStore } from "react";
import { businessOperatingProfileStore } from "./businessOperatingProfileStore";

export function useBusinessOperatingProfile() {
  return useSyncExternalStore(
    businessOperatingProfileStore.subscribe,
    businessOperatingProfileStore.getSnapshot,
    businessOperatingProfileStore.getSnapshot,
  );
}
