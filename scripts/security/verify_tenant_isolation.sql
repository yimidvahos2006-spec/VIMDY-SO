-- ==============================================================================
-- verify_tenant_isolation.sql — El "forzar el error a propósito" de RLS.
-- ------------------------------------------------------------------------------
-- Fase 3.5 #3: no basta con que las políticas de seguridad "se vean bien" en
-- schema.sql — hay que demostrar, con datos reales, que un negocio JAMÁS
-- puede ver ni tocar los datos de otro. Este script:
--
--   1. Crea un mini-stub del esquema `auth` de Supabase (auth.uid()) para
--      poder simular "estoy logueado como el usuario X" en un Postgres
--      normal (este script corre contra un Postgres efímero en CI, nunca
--      contra producción — mismo patrón que restore_and_verify.sh).
--   2. Aplica schema.sql tal cual, así se prueba el RLS real del proyecto,
--      no una copia aparte que se puede desincronizar con el tiempo.
--   3. Crea 2 negocios (A y B) con un usuario cada uno, y una venta en cada
--      uno directamente (bypassing RLS, como lo haría el backend real).
--   4. Se "loguea" como el usuario del negocio A y confirma:
--        a) SOLO ve la venta del negocio A (nunca la de B).
--        b) Si intenta INSERTAR una fila marcada como del negocio B, la
--           política la rechaza (no silenciosamente ignorada — falla).
--        c) Si intenta hacer UPDATE sobre la fila del negocio B (aunque
--           conozca su id), no la encuentra / no la puede tocar.
--   5. Si CUALQUIERA de estas 3 verificaciones no se comporta como debe,
--      el script termina con error — para que la CI quede en rojo, visible,
--      nunca en silencio (mismo principio que backup.sh y
--      restore_and_verify.sh).
--
-- Uso (contra un Postgres efímero, nunca producción):
--   psql "$TEST_DB_URL" -v ON_ERROR_STOP=1 -f verify_tenant_isolation.sql
-- ==============================================================================

\set ON_ERROR_STOP on

-- ------------------------------------------------------------------------------
-- 1. Stub mínimo del esquema auth de Supabase, para poder simular sesiones
--    de usuario en un Postgres plano (CI). auth.uid() real de Supabase lee
--    el JWT de la conexión; acá lo reemplazamos por una variable de sesión
--    que este mismo script controla con set_config().
-- ------------------------------------------------------------------------------
create schema if not exists auth;

create or replace function auth.uid() returns uuid
language sql stable
as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
$$;

-- ------------------------------------------------------------------------------
-- 2. El schema.sql real del proyecto se aplica ANTES de correr este archivo
--    (ver verify_tenant_isolation.sh, que hace: psql -f schema.sql -f este).
--    Acá abajo asumimos que businesses / business_members / products /
--    sales / auth_business_ids() ya existen tal cual los define schema.sql.
-- ------------------------------------------------------------------------------

do $$
declare
  business_a uuid := gen_random_uuid();
  business_b uuid := gen_random_uuid();
  user_a uuid := gen_random_uuid();
  user_b uuid := gen_random_uuid();
  leaked_count int;
  insert_blocked boolean := false;
  update_blocked boolean := false;
begin
  -- Datos base, insertados como "servicio" (sin RLS activo en esta sesión
  -- superuser todavía) — así es como lo haría el backend real al crear un
  -- negocio nuevo.
  insert into businesses (id, name) values
    (business_a, 'Negocio A — prueba de aislamiento'),
    (business_b, 'Negocio B — prueba de aislamiento');

  insert into business_members (business_id, user_id) values
    (business_a, user_a),
    (business_b, user_b);

  insert into sales (id, business_id, data) values
    ('venta-a-1', business_a, jsonb_build_object('total', 10000, 'nota', 'venta real de A')),
    ('venta-b-1', business_b, jsonb_build_object('total', 99999, 'nota', 'venta real de B — NUNCA debe verla A'));

  -- --------------------------------------------------------------------------
  -- 3a. "Login" como usuario del negocio A. RLS debe filtrar automáticamente.
  -- --------------------------------------------------------------------------
  perform set_config('request.jwt.claim.sub', user_a::text, true);
  set local role authenticated;

  select count(*) into leaked_count
  from sales
  where id = 'venta-b-1';

  if leaked_count > 0 then
    raise exception 'FALLO CRÍTICO: el usuario del negocio A pudo ver la venta del negocio B. RLS no está aislando los datos.';
  end if;

  -- --------------------------------------------------------------------------
  -- 3b. Intentar INSERTAR una fila marcada como del negocio B, logueado
  --     como usuario de A. Debe ser rechazada por la política (with check).
  -- --------------------------------------------------------------------------
  begin
    insert into sales (id, business_id, data)
    values ('venta-intrusa', business_b, jsonb_build_object('total', 1, 'nota', 'intento de colar una venta en el negocio ajeno'));
    -- Si llegó hasta acá sin error, la política NO está bloqueando el insert.
  exception
    when insufficient_privilege or others then
      insert_blocked := true;
  end;

  if not insert_blocked then
    raise exception 'FALLO CRÍTICO: el usuario del negocio A pudo insertar una fila marcada como del negocio B. La política with check no está funcionando.';
  end if;

  -- --------------------------------------------------------------------------
  -- 3c. Intentar UPDATE directo sobre la fila del negocio B (conociendo su
  --     id exacto). RLS debe hacer que Postgres reporte 0 filas afectadas,
  --     no un error — pero el resultado neto debe ser que NADA cambió.
  -- --------------------------------------------------------------------------
  update sales set data = jsonb_build_object('total', 1, 'nota', 'modificado por A -- no debería pasar')
  where id = 'venta-b-1';

  set local role postgres; -- volver a modo servicio para poder leer sin filtro y verificar
  perform set_config('request.jwt.claim.sub', '', true);

  select (data->>'nota' = 'venta real de B — NUNCA debe verla A') into update_blocked
  from sales where id = 'venta-b-1';

  if not update_blocked then
    raise exception 'FALLO CRÍTICO: el usuario del negocio A pudo modificar una venta del negocio B.';
  end if;

  -- --------------------------------------------------------------------------
  -- Limpieza — este script puede correr varias veces contra la misma base
  -- efímera de CI sin dejar basura.
  -- --------------------------------------------------------------------------
  delete from sales where business_id in (business_a, business_b);
  delete from business_members where business_id in (business_a, business_b);
  delete from businesses where id in (business_a, business_b);

  raise notice 'OK — aislamiento entre negocios verificado: lectura, insert y update ajenos fueron bloqueados correctamente.';
end $$;