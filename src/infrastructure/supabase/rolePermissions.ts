/* ===========================================================================
   rolePermissions
   ---------------------------------------------------------------------------
   Reexporta el ÚNICO catálogo de permisos por rol (core/config/permissions.ts).
   AuthContext.can() sigue importando de aquí, pero ya no existe una segunda
   copia que pueda desincronizarse.
=========================================================================== */

export { ROLE_PERMISSIONS, permissionsForRole } from "../../core/config/permissions";