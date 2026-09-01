-- VIMDY OS — Verificación de RLS multi-tenant
-- Ejecuta esto en el SQL Editor de Supabase para confirmar que todas
-- las tablas tienen RLS activado y políticas correctas.
--
-- Resultado esperado: todas las tablas deben aparecer con
--   rowsecurity: true
-- y, para las tablas de datos, al menos 4 políticas (SELECT/INSERT/UPDATE/DELETE).

select
  schemaname,
  tablename,
  rowsecurity as rls_enabled,
  (
    select count(*)
    from pg_policies p
    where p.schemaname = t.schemaname
      and p.tablename = t.tablename
  ) as policy_count
from pg_tables t
where schemaname = 'public'
  and tablename not like 'pg_%'
order by tablename;

-- Políticas detalladas por tabla (para inspección manual)
select
  schemaname,
  tablename,
  policyname,
  permissive,
  cmd,
  qual,
  with_check
from pg_policies
where schemaname = 'public'
order by tablename, cmd;

-- Verificar que auth_business_ids() y auth_branch_ids() existen
select 
  n.nspname as schema,
  p.proname as function_name,
  pg_get_functiondef(p.oid) as definition
from pg_proc p
join pg_namespace n on p.pronamespace = n.oid
where n.nspname = 'public'
  and p.proname in ('auth_business_ids', 'auth_branch_ids', 'has_business_role', 'is_business_subscription_active');
