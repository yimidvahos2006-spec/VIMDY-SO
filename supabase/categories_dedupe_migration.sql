-- ============================================================================
-- categories_dedupe_migration.sql
-- ----------------------------------------------------------------------------
-- Corrige categorías duplicadas (mismo nombre, mismo negocio — ej. dos
-- "Entradas") que se colaron por la ventana de carrera entre "revisar si ya
-- existe" y "guardar": CategoryEngine.create() revisa el catálogo ANTES de
-- guardar, pero esa revisión solo mira el caché local (CategoryRepository.
-- findAll() devuelve primero lo que ya tiene en IndexedDB y refresca contra
-- Supabase en paralelo). En un negocio con más de un dispositivo/pestaña,
-- dos creaciones casi simultáneas pueden pasar esa revisión igual — ninguna
-- ve todavía la categoría que está creando la otra — y de ahí salen los
-- duplicados.
--
-- Qué hace:
--   1. Por cada negocio, agrupa las categorías con el mismo nombre (sin
--      distinguir mayúsculas/minúsculas ni espacios al borde, igual que la
--      revisión de CategoryEngine.create/update) y elige como "titular" la
--      más antigua (created_at más chico; en empate, el id menor, solo para
--      que el criterio sea determinista).
--   2. Reasigna categoryId en todos los productos que apuntaban a una
--      categoría duplicada, para que ahora apunten al titular — así ningún
--      producto se queda "huérfano" al borrar la duplicada.
--   3. Borra las filas de categorías duplicadas, ya sin productos
--      apuntándoles.
--   4. Agrega un índice único (por negocio + nombre en minúsculas) para que
--      esta duplicación no pueda volver a pasar — ni siquiera por una
--      carrera entre dispositivos — porque ahora la propia base de datos la
--      rechaza (VIMDY ya sabe traducir ese rechazo a un mensaje amigable,
--      ver DuplicateNameError / CategoryEngine).
--
-- Cómo aplicar: pega este archivo completo en el "SQL Editor" de Supabase y
-- dale "Run". Es seguro correrlo más de una vez (los duplicados que ya se
-- fusionaron la primera vez no vuelven a aparecer, y `create index if not
-- exists` no falla si el índice ya existe).
-- ============================================================================

do $$
declare
  dup record;
  ids_sorted text[];
  keeper text;
  duplicates text[];
begin
  for dup in
    select business_id, lower(trim(data->>'name')) as norm_name
    from categories
    group by business_id, lower(trim(data->>'name'))
    having count(*) > 1
  loop
    select array_agg(id order by created_at asc, id asc)
    into ids_sorted
    from categories
    where business_id = dup.business_id
      and lower(trim(data->>'name')) = dup.norm_name;

    keeper := ids_sorted[1];
    duplicates := ids_sorted[2:array_length(ids_sorted, 1)];

    -- Reasigna cada producto que apuntaba a una categoría duplicada, al titular.
    update products
    set data = jsonb_set(data, '{categoryId}', to_jsonb(keeper))
    where business_id = dup.business_id
      and data->>'categoryId' = any (duplicates);

    -- Borra las categorías duplicadas, ya sin productos apuntándoles.
    delete from categories
    where business_id = dup.business_id
      and id = any (duplicates);
  end loop;
end $$;

-- Blindaje real (a nivel de base de datos) contra que esto vuelva a pasar.
create unique index if not exists categories_business_name_unique_idx
  on categories (business_id, lower(trim(data->>'name')));