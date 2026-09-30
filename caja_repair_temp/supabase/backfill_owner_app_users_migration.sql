-- ============================================================================
-- backfill_owner_app_users_migration.sql
-- ----------------------------------------------------------------------------
-- PROBLEMA: register-business (Edge Function) ya inserta al dueño en
-- app_users cuando alguien se registra HOY. Pero cualquier negocio creado
-- ANTES de que ese insert existiera se quedó con el dueño en auth.users y en
-- business_members, pero NUNCA en app_users. Resultado: cualquier pantalla
-- que lea el directorio de empleados (ej. BusinessAnalyzer -> "empleado que
-- más vende" del Dashboard) no encuentra su nombre y muestra
-- "Empleado sin nombre registrado" cada vez que el dueño hace una venta él
-- mismo.
--
-- QUÉ HACE: por cada fila de business_members con role = 'ADMIN' que no
-- tenga ya una fila correspondiente en app_users, crea esa fila usando:
--   - el nombre real que quedó guardado en auth.users.raw_user_meta_data
--     ->> 'full_name' (lo guarda authBusinessContext.ts al registrarse), o
--   - si por lo que sea ese metadato no existe, la parte del correo antes
--     de la @ (nunca deja el nombre vacío).
--
-- SEGURO DE RE-CORRER: el "not exists" hace que si ya corriste esto antes,
-- correrlo de nuevo no duplique ni pise nada.
--
-- CÓMO CORRERLA: Supabase Dashboard -> SQL Editor -> pegar y ejecutar UNA
-- vez (o las veces que quieras, es idempotente). Requiere permisos para
-- leer auth.users, así que se corre como postgres/service_role — el SQL
-- Editor del dashboard ya tiene esos permisos por defecto.
-- ============================================================================

insert into app_users (id, business_id, data, created_at, updated_at)
select
  bm.user_id::text,
  bm.business_id,
  jsonb_build_object(
    'id', bm.user_id::text,
    'name', coalesce(
      nullif(trim(au.raw_user_meta_data ->> 'full_name'), ''),
      split_part(au.email, '@', 1)
    ),
    'email', coalesce(au.email, ''),
    'roleId', 'ADMIN',
    'status', 'ACTIVE',
    'createdAt', now(),
    'updatedAt', now()
  ),
  now(),
  now()
from business_members bm
join auth.users au on au.id = bm.user_id
where bm.role = 'ADMIN'
  and not exists (
    select 1
    from app_users existing
    where existing.id = bm.user_id::text
      and existing.business_id = bm.business_id
  );

-- Verificación rápida (opcional): corre esto después para confirmar que ya
-- no queda ningún dueño sin perfil.
--
-- select bm.business_id, bm.user_id, au.email
-- from business_members bm
-- join auth.users au on au.id = bm.user_id
-- left join app_users apu on apu.id = bm.user_id::text and apu.business_id = bm.business_id
-- where bm.role = 'ADMIN' and apu.id is null;