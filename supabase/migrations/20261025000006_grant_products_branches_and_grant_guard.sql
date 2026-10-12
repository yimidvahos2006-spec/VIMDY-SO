-- ============================================================================
-- Arregla "permission denied for table products" y evita que vuelva a pasar.
--
-- CAUSA: en este proyecto las tablas nuevas de `public` NO reciben permisos
-- automáticos para los usuarios logueados (rol `authenticated`). `products` y
-- `branches` tenían sus reglas de seguridad (RLS) pero nunca un GRANT, así que
-- cualquier insert/lectura desde la app fallaba con "permission denied".
-- Las reglas RLS siguen decidiendo QUÉ filas puede ver/tocar cada rol; el
-- GRANT solo abre la puerta de la tabla.
-- ============================================================================

grant select, insert, update, delete on public.products to authenticated;
grant select, insert, update, delete on public.branches to authenticated;

-- ----------------------------------------------------------------------------
-- GUARDIA: lista las tablas que tienen una política RLS para usuarios logueados
-- pero les falta el permiso de tabla correspondiente (el mismo error de arriba).
-- Las combinaciones de `allow` están cerradas A PROPÓSITO (escrituras que solo
-- se hacen por funciones seguras o por el backend). Si agregas una tabla nueva
-- y olvidas el GRANT, esta función la devuelve y ops-monitor avisa por Discord.
-- ----------------------------------------------------------------------------
create or replace function public.get_grant_gaps()
returns table(table_name text, missing_privileges text)
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  with pol as (
    select p.tablename, x.priv
    from pg_policies p
    cross join lateral unnest(
      case when p.cmd = 'ALL'
           then array['SELECT','INSERT','UPDATE','DELETE']
           else array[p.cmd] end
    ) as x(priv)
    where p.schemaname = 'public'
      and (p.roles && array['authenticated','public']::name[])
  ),
  need as (select distinct tablename, priv from pol),
  allow(tablename, priv) as (values
    ('cash_drawer_counts','INSERT'),('cash_drawer_counts','UPDATE'),('cash_drawer_counts','DELETE'),
    ('cash_movements','INSERT'),('cash_movements','UPDATE'),('cash_movements','DELETE'),
    ('cash_register_transfers','INSERT'),('cash_register_transfers','UPDATE'),('cash_register_transfers','DELETE'),
    ('cash_registers','DELETE'),
    ('inventory_batch_operations','SELECT'),('inventory_batch_operations','INSERT'),
    ('business_invitations','SELECT'),('business_invitations','INSERT'),
    ('business_invitations','UPDATE'),('business_invitations','DELETE'),
    ('business_members','INSERT'),('business_members','UPDATE'),('business_members','DELETE'),
    ('businesses','INSERT'),
    ('dian_certificates','SELECT'),('dian_certificates','INSERT'),
    ('dian_certificates','UPDATE'),('dian_certificates','DELETE'),
    ('subscription_audit_log','INSERT'),
    ('subscription_payments','INSERT'),
    ('user_trial_usage','SELECT'),('user_trial_usage','INSERT'),
    ('user_trial_usage','UPDATE'),('user_trial_usage','DELETE')
  )
  select n.tablename::text, string_agg(n.priv, ', ' order by n.priv)
  from need n
  where not has_table_privilege('authenticated', format('public.%I', n.tablename), n.priv)
    and not exists (
      select 1 from allow a where a.tablename = n.tablename and a.priv = n.priv
    )
  group by n.tablename
  order by 1;
$$;

revoke all on function public.get_grant_gaps() from public, anon, authenticated;
grant execute on function public.get_grant_gaps() to service_role;