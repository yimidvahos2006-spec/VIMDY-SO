-- ============================================================================
-- VIMDY OS — Migración: activar Supabase Realtime (sincronización en vivo)
-- ----------------------------------------------------------------------------
-- Cómo usarlo:
--   1. Ve a tu proyecto en https://supabase.com -> "SQL Editor".
--   2. Pega TODO este archivo y dale "Run".
--   3. Listo. A partir de aquí, cualquier INSERT/UPDATE/DELETE que haga
--      Computador A llega en vivo (sin recargar) a Computador B, Tablet y
--      Celular, siempre que estén conectados a internet.
--
-- Es seguro correrlo aunque ya tengas datos: usa "if not exists" / checks
-- condicionales en todo, así que no borra ni rompe nada existente.
--
-- QUÉ HACE ESTO Y POR QUÉ HACÍA FALTA:
--   Por defecto, Supabase Postgres NO transmite cambios en vivo. Hay que
--   decirle explícitamente, tabla por tabla, "esta tabla sí debe avisar
--   cuando cambie" (agregarla a la publicación `supabase_realtime`) y
--   además decirle "cuando borres una fila, manda la fila completa, no
--   solo el id" (REPLICA IDENTITY FULL) — esto último es obligatorio
--   porque cada suscripción se filtra por business_id, y sin la fila
--   completa en el DELETE, Postgres no tiene cómo saber a qué negocio
--   pertenecía la fila borrada, y el evento nunca llegaría a nadie.
-- ============================================================================

do $$
declare
  t text;
  tables text[] := array[
    'products', 'sales', 'customers', 'kitchen_orders', 'alerts',
    'inventory_movements', 'cash_movements', 'tables', 'orders',
    'shifts', 'roles', 'permissions', 'audit_logs', 'categories', 'suppliers',
    'business_snapshots', 'app_users', 'notifications', 'receipts'
  ];
begin
  foreach t in array tables loop

    -- REPLICA IDENTITY FULL: necesario para que los eventos DELETE (y los
    -- UPDATE con filtro) incluyan todas las columnas, incluida business_id.
    execute format('alter table %I replica identity full;', t);

    -- Agrega la tabla a la publicación realtime, solo si no está ya.
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table %I;', t);
    end if;

  end loop;
end $$;

-- ----------------------------------------------------------------------------
-- Verificación: esta consulta debe devolver las 19 tablas de arriba.
-- Si falta alguna, vuelve a correr este archivo completo.
-- ----------------------------------------------------------------------------
select tablename
from pg_publication_tables
where pubname = 'supabase_realtime'
order by tablename;