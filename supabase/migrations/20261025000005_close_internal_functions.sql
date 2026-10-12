-- Cierra funciones internas que cualquier usuario logueado podía llamar.
-- 1) get_next_invoice_consecutive: no valida pertenencia al negocio; un usuario
--    logueado con el UUID de otro negocio podía quemar sus consecutivos DIAN.
--    La única llamada legítima es la Edge Function dian-invoice (service_role).
-- 2) get_db_metrics: expone tamaño/conexiones de la base a cualquier logueado.
--    Solo la usa el monitoreo (service_role).
revoke all on function public.get_next_invoice_consecutive(uuid) from public, anon, authenticated;
grant execute on function public.get_next_invoice_consecutive(uuid) to service_role;

revoke all on function public.get_db_metrics() from public, anon, authenticated;
grant execute on function public.get_db_metrics() to service_role;

-- 3) Fija search_path en las 4 funciones que lo tenían mutable.
do $$
declare r record;
begin
  for r in
    select p.oid::regprocedure as sig
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in ('test_is_active','touch_updated_at',
                        'touch_daily_report_settings_updated_at','immutable_timestamptz')
  loop
    execute format('alter function %s set search_path = pg_catalog, public', r.sig);
  end loop;
end $$;