-- =============================================================================
-- FIX: inventory_products_read con products.id de tipo uuid
-- -----------------------------------------------------------------------------
-- En la base real products.id es uuid. La versión de 20261107000000 comparaba
-- ese uuid contra text (p.id = any(text[]), p.id > text) y fallaba SIEMPRE con
-- "operator does not exist: uuid = text", lo que rompía la lectura del
-- catálogo para todos los usuarios.
--
-- Misma firma y mismo contrato hacia el cliente (id sigue saliendo como text).
-- Solo cambia cómo se comparan los ids dentro de la función.
-- Aplicar DESPUÉS de 20261108000000. Es idempotente.
-- =============================================================================
begin;

create or replace function public.inventory_products_read(
  p_business_id uuid,
  p_branch_id uuid default null,
  p_product_ids text[] default null,
  p_after_id text default null,
  p_limit integer default 1000
)
returns table (id text, branch_id uuid, version integer, data jsonb)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_masked boolean;
  v_branches uuid[];
  v_limit integer := least(greatest(coalesce(p_limit, 1000), 1), 1000);
  v_ids uuid[] := null;
  v_after uuid := null;
begin
  if auth.uid() is null then
    raise exception 'PRODUCTS_AUTH_REQUIRED' using errcode = '42501';
  end if;
  if p_business_id is null
     or p_business_id not in (select public.auth_business_ids()) then
    raise exception 'PRODUCTS_FORBIDDEN' using errcode = '42501';
  end if;

  -- Los ids llegan como texto; un id que no sea uuid no puede existir: se ignora.
  if p_product_ids is not null then
    select coalesce(array_agg(x::uuid), '{}'::uuid[])
      into v_ids
    from unnest(p_product_ids) as x
    where x ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
  end if;
  if p_after_id is not null
     and p_after_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    v_after := p_after_id::uuid;
  end if;

  v_masked := public.inventory_count_user_is_masked(p_business_id);
  v_branches := public.auth_branch_ids();   -- una vez, no por fila

  return query
    select
      p.id::text,
      p.branch_id,
      p.version,
      case when v_masked then public.inventory_mask_product_data(p.data) else p.data end
    from public.products p
    where p.business_id = p_business_id
      and (p_branch_id is null or p.branch_id = p_branch_id)
      and (p.branch_id is null or p.branch_id = any (v_branches))
      and (v_ids is null or p.id = any (v_ids))
      and (v_after is null or p.id > v_after)
    order by p.id
    limit v_limit;
end;
$$;

revoke all on function public.inventory_products_read(uuid, uuid, text[], text, integer) from public, anon;
grant execute on function public.inventory_products_read(uuid, uuid, text[], text, integer) to authenticated;

commit;