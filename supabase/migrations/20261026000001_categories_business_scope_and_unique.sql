-- ============================================================================
-- 20261026000001_categories_business_scope_and_unique.sql
-- ----------------------------------------------------------------------------
-- Categorías = del NEGOCIO completo (todas las sucursales ven las mismas).
--
-- 1. Pasa todas las categorías a branch_id = null (antes algunas quedaban con
--    sucursal y otras sin ella, y la app no veía las que no coincidían).
-- 2. Fusiona categorías repetidas (mismo negocio + mismo nombre, sin importar
--    mayúsculas ni espacios al borde): se queda la más antigua y los productos
--    que apuntaban a la repetida pasan a la que se queda.
-- 3. Crea el índice único (negocio + nombre en minúsculas) para que no vuelva
--    a pasar, ni siquiera entre dos dispositivos a la vez.
--
-- Es seguro correrlo más de una vez.
-- ============================================================================

update categories set branch_id = null where branch_id is not null;

do $$
declare
  dup record;
  ids_sorted uuid[];
  keeper uuid;
  duplicates uuid[];
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

    update products
    set data = jsonb_set(data, '{categoryId}', to_jsonb(keeper::text))
    where business_id = dup.business_id
      and data->>'categoryId' = any (select d::text from unnest(duplicates) d);

    delete from categories
    where business_id = dup.business_id
      and id = any (duplicates);
  end loop;
end $$;

create unique index if not exists categories_business_name_unique_idx
  on categories (business_id, lower(trim(data->>'name')));