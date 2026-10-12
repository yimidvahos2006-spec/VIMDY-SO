-- ops-monitor: métricas reales (usuarios y conexiones) y cierre de acceso.
-- Antes el monitor leía auth.users y pg_stat_activity por la API REST, que no
-- los expone, por eso reportaba siempre 0 usuarios y 0 conexiones.

create or replace function public.get_auth_users_count()
returns bigint
language sql stable security definer
set search_path = public
as $$ select count(*) from auth.users; $$;

create or replace function public.get_active_connections()
returns integer
language sql stable security definer
set search_path = public
as $$ select count(*)::int from pg_stat_activity where datname = current_database(); $$;

-- Solo el backend (service_role) puede consultarlas. De paso se cierran
-- get_db_size_bytes y get_cache_hit_ratio, que estaban abiertas a cualquier
-- usuario logueado.
revoke all on function public.get_auth_users_count()   from public, anon, authenticated;
revoke all on function public.get_active_connections() from public, anon, authenticated;
revoke all on function public.get_db_size_bytes()      from public, anon, authenticated;
revoke all on function public.get_cache_hit_ratio()    from public, anon, authenticated;

grant execute on function public.get_auth_users_count()   to service_role;
grant execute on function public.get_active_connections() to service_role;
grant execute on function public.get_db_size_bytes()      to service_role;
grant execute on function public.get_cache_hit_ratio()    to service_role;