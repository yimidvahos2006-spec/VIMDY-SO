-- ============================================================================
-- BLOQUE 1 — Normalización del rol administrativo
-- ============================================================================
-- PROBLEMA:
--
--   En algunos negocios el rol almacenado en business_members es
--   'ADMINISTRACIÓN' en lugar de 'ADMIN'. Eso rompe la policy
--   permissions_admin_only y roles_admin_only, que exigen
--   auth_role(business_id) = 'ADMIN'.
--
--   Como resultado, el seed de identidad no puede crear/asegurar permisos
--   ni roles para esos negocios, aunque el usuario sea administrador.
--
-- ALCANCE:
--
--   Solo normaliza business_members.role de 'ADMINISTRACIÓN' a 'ADMIN'.
--   No modifica:
--     - permissions
--     - roles
--     - RLS/policies
--     - otras tablas
--     - otros negocios
--
-- IDEMPOTENCIA:
--
--   Se protege con WHERE role = 'ADMINISTRACIÓN'. Si se ejecuta dos veces,
--   la segunda no afecta filas.
--
-- SEGURIDAD:
--
--   - Solo modifica el rol administrativo.
--   - No otorga privilegios adicionales.
--   - No expone datos.
--   - No cambia la policy permissions_admin_only.
--
-- ROLLBACK:
--
--   Si algo sale mal, ejecutar:
--
--     update public.business_members
--     set role = 'ADMINISTRACIÓN'
--     where role = 'ADMIN' and user_id in (
--       select user_id from public.business_members
--       where role = 'ADMIN' and business_id = '5ccff48a-45b2-43f9-ab52-fcc191f5ee72'
--     );
--
--   Ajustar el business_id si aplica a más de un negocio.
-- ============================================================================

-- 1. Verificación previa: ver qué negocios/usuarios tienen 'ADMINISTRACIÓN'
--    Ejecutar ESTO PRIMERO y compartir el resultado.
select
  business_id,
  user_id,
  role,
  created_at
from public.business_members
where role = 'ADMINISTRACIÓN'
order by business_id, user_id;

-- 2. Normalización (solo después de aprobar la verificación)
-- update public.business_members
-- set role = 'ADMIN'
-- where role = 'ADMINISTRACIÓN';

-- 3. Verificación posterior
-- select
--   business_id,
--   user_id,
--   role
-- from public.business_members
-- where business_id = '5ccff48a-45b2-43f9-ab52-fcc191f5ee72'
--   and user_id = 'f2a82375-39fe-49e0-81ad-8382ca47e86c';
