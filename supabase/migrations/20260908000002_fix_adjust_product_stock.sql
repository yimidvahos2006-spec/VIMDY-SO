-- ============================================================================
-- INVENTORY FIX — Simplificar adjust_product_stock
-- ============================================================================
-- Problema:
--   La versión anterior acumulaba datos en `branchStocks` (columna JSONB
--   que la app nunca lee) y solo actualizaba `stock` cuando
--   `branch_id = p_branch_id`, dejando inconsistencias en el caso
--   extremo de que un producto se ajustara para otra sucursal.
--
-- Solución:
--   Cada registro de producto pertenece a UNA sucursal. La función ahora
--   solo actualiza `stock` de forma atómica, sin ramas de branchStocks.
-- ============================================================================

create or replace function public.adjust_product_stock(
  p_product_id text,
  p_delta numeric,
  p_extra_fields jsonb default '{}'::jsonb,
  p_allow_negative boolean default false,
  p_branch_id uuid default null
)
returns jsonb
language plpgsql
security invoker
as $$
declare
  v_updated jsonb;
begin
  update products
  set data = jsonb_set(
               data,
               '{stock}',
               to_jsonb(((data->>'stock')::numeric + p_delta))
             ) || p_extra_fields,
      updated_at = now()
  where id = p_product_id
    and (p_allow_negative or (data->>'stock')::numeric + p_delta >= 0)
  returning data into v_updated;

  if v_updated is null then
    if not exists (select 1 from products where id = p_product_id) then
      raise exception 'PRODUCT_NOT_FOUND' using errcode = 'P0002';
    else
      raise exception 'INSUFFICIENT_STOCK' using errcode = 'P0001';
    end if;
  end if;

  return v_updated;
end;
$$;
revoke all on function public.adjust_product_stock(text, numeric, jsonb, boolean, uuid) from public, anon;
grant execute on function public.adjust_product_stock(text, numeric, jsonb, boolean, uuid) to authenticated;
