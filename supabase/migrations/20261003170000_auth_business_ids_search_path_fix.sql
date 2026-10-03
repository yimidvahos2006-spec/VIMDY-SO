-- ===========================================================================
-- PASO 3 — Fix auth_business_ids search_path-safe
-- ===========================================================================
-- Problema:
--   auth_business_ids() residía en el schema base sin calificar
--   public.business_members. Cuando se ejecuta dentro de RPCs/DO blocks con
--   search_path alterado (ej. SET search_path TO ''), la resolución puede
--   fallar.
--
-- Solución:
--   Reemplazar la función por una versión que referencia EXPLÍCITAMENTE
--   public.business_members, preservando:
--     - seguridad (SECURITY DEFINER)
--     - tenant isolation (filtra por user_id = auth.uid())
--     - grants (REVOKE/GRANT a authenticated, service_role)
--     - comportamiento existente
--
-- NO toca migraciones históricas. Nueva migración aditiva.
-- ===========================================================================

create or replace function public.auth_business_ids()
returns setof uuid
language sql
stable
security definer
as $$
  select business_id
  from public.business_members
  where user_id = auth.uid()
$$;

revoke execute on function public.auth_business_ids() from public;
grant execute on function public.auth_business_ids() to authenticated;
grant execute on function public.auth_business_ids() to service_role;
