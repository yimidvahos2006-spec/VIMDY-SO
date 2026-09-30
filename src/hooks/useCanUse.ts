import { useBusinessOperatingProfile } from "../core/store/useBusinessOperatingProfile";
import { useEnabledModules } from "../core/store/useEnabledModules";
import type { BusinessCapabilityId } from "../core/config/businessOperatingProfile";

/**
 * useCanUse — Hook reactivo de capacidades operativas de VIMDY.
 * Consulta el perfil operativo activo (o enabledModules como fallback inmediato)
 * para responder si el negocio actual puede usar la capacidad consultada.
 *
 * Ejemplo de uso:
 * const canUseTables = useCanUse("tables");
 * const canUseKitchen = useCanUse("kitchen");
 * const canUseKds = useCanUse("kds");
 */
export function useCanUse(capability: BusinessCapabilityId): boolean {
  const snapshot = useBusinessOperatingProfile();
  const enabledModules = useEnabledModules();

  if (snapshot.status === "ready" && snapshot.profile) {
    return snapshot.profile.capabilities[capability] ?? false;
  }

  // Fallback seguro mientras se hidrata el perfil completo o en tests
  const modules = enabledModules ?? [];
  switch (capability) {
    case "tables":
      return modules.includes("mesas");
    case "waiters":
      return modules.includes("mesas");
    case "kitchen":
    case "kds":
    case "kitchenPrinter":
      return modules.includes("cocina");
    case "inventory":
      return modules.includes("inventario");
    case "customers":
      return modules.includes("clientes");
    case "cash":
    case "sales":
      return modules.includes("caja");
    case "orders":
      return modules.includes("pedidos");
    case "ai":
      return modules.includes("ia");
    default:
      return false;
  }
}

