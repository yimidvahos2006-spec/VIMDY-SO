import { useBusinessOperatingProfile } from "../core/store/useBusinessOperatingProfile";
import type { BusinessCapabilityId } from "../core/config/businessOperatingProfile";

/**
 * useCanUse — Hook reactivo de capacidades operativas de VIMDY.
 * Consulta únicamente el perfil operativo cargado desde Supabase. Durante
 * carga/error devuelve false para no exponer capacidades desde estado viejo.
 *
 * Ejemplo de uso:
 * const canUseTables = useCanUse("tables");
 * const canUseKitchen = useCanUse("kitchen");
 * const canUseKds = useCanUse("kds");
 */
export function useCanUse(capability: BusinessCapabilityId): boolean {
  const snapshot = useBusinessOperatingProfile();

  if (snapshot.status !== "ready" || !snapshot.profile) return false;
  return snapshot.profile.capabilities[capability] ?? false;
}

