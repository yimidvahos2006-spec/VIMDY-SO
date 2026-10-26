/* ===========================================================================
   roleAccess
   ---------------------------------------------------------------------------
   Única fuente de verdad de "qué ruta puede ver cada rol" y "a dónde se manda
   a cada rol cuando entra o cuando intenta algo que no le corresponde".

   La usan TODOS los que antes decidían por su cuenta:
     - routes/App.tsx            -> permisos de cada ruta (ProtectedRoute)
     - VimdySidebar / MobileBottomNav -> qué módulos se muestran
     - ProtectedRoute / RequireModule -> a dónde redirigir sin crear bucles

   Los permisos de cada rol viven en infrastructure/supabase/rolePermissions.ts.
   Aquí solo se dice qué permiso(s) pide cada pantalla.
=========================================================================== */

export const DEFAULT_HOME_PATH = "/dashboard";

/**
 * Rol -> pantalla de inicio. Un rol que aparece aquí NO usa el Dashboard:
 * al entrar (o al ir a /dashboard) se le manda a su pantalla.
 * Para agregar otro rol (ej. COCINA: "/cocina") basta con una línea.
 */
const ROLE_HOME_PATH: Readonly<Record<string, string>> = {
  MESERO: "/meseros"
};

/**
 * Permisos que pide cada ruta. Basta con tener UNO de la lista.
 * Una ruta que no aparece aquí es de acceso libre para cualquier usuario
 * autenticado (notificaciones, cocina, checkout de POS).
 */
export const ROUTE_PERMISSIONS: Readonly<Record<string, readonly string[]>> = {
  "/caja": ["cash.view"],
  // /meseros: el MESERO tiene tables.view (no staff.view). El CAJERO entra con
  // staff.view como hasta ahora. La página además valida su propio permiso.
  "/meseros": ["tables.view", "staff.view"],
  "/inventario": ["inventory.view"],
  "/clientes": ["customers.view"],
  "/reportes": ["reports.view"],
  "/ganancias": ["reports.view"],
  "/perdidas": ["reports.view"],
  "/compras-inteligentes": ["reports.view"],
  "/pronostico": ["reports.view"],
  "/ia": ["reports.view"],
  "/configuracion": ["company.settings"]
};

export function normalizeRoleName(roleName?: string | null): string {
  return (roleName ?? "").trim().toUpperCase();
}

function normalizePath(path: string): string {
  const clean = path.split(/[?#]/)[0] || "/";
  return clean.length > 1 ? clean.replace(/\/+$/, "") : clean;
}

/** Pantalla de inicio del rol (el Dashboard salvo que el rol tenga una propia). */
export function homePathForRole(roleName?: string | null): string {
  return ROLE_HOME_PATH[normalizeRoleName(roleName)] ?? DEFAULT_HOME_PATH;
}

/** ¿Este rol tiene una pantalla de inicio propia (no usa el Dashboard)? */
export function roleHasCustomHome(roleName?: string | null): boolean {
  return normalizeRoleName(roleName) in ROLE_HOME_PATH;
}

/** ¿Tiene al menos uno de los permisos pedidos? Lista vacía/undefined = libre. */
export function hasAnyPermission(
  can: (permissionId: string) => boolean,
  required?: string | readonly string[]
): boolean {
  if (required === undefined) return true;
  const list = typeof required === "string" ? [required] : required;
  return list.length === 0 || list.some((permission) => can(permission));
}

/** ¿Puede este rol ver esta ruta? Lo usan los menús para ocultar módulos. */
export function canAccessPath(
  path: string,
  can: (permissionId: string) => boolean,
  roleName?: string | null
): boolean {
  const normalized = normalizePath(path);
  if (normalized === DEFAULT_HOME_PATH) return !roleHasCustomHome(roleName);
  return hasAnyPermission(can, ROUTE_PERMISSIONS[normalized]);
}

/**
 * A dónde mandar a alguien que intentó entrar a una ruta que no le toca.
 * Devuelve `null` cuando la ruta bloqueada YA es su pantalla de inicio: en ese
 * caso NO se debe redirigir (sería un bucle infinito), sino mostrar un aviso.
 */
export function resolveDeniedRedirect(
  currentPath: string,
  roleName?: string | null
): string | null {
  const home = homePathForRole(roleName);
  return normalizePath(currentPath) === home ? null : home;
}