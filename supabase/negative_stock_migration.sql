-- ============================================================================
-- negative_stock_migration.sql
-- ----------------------------------------------------------------------------
-- BLOQUEANTE #4 del checklist de lanzamiento — "Permitir stock negativo" no
-- hacía nada. El switch existía en Ajustes (companyConfigStore) pero nunca
-- llegaba hasta donde de verdad se decide si un descuento de stock se
-- rechaza: la función SQL `adjust_product_stock`, que SIEMPRE rechazaba
-- cualquier descuento que dejara el stock en negativo, sin importar el
-- switch. Esta migración le agrega un cuarto parámetro `p_allow_negative`
-- (default false, para no romper ninguna llamada vieja) y lo usa en la
-- condición del UPDATE.
--
-- El código de la app (ProductRepository.adjustStock -> InventoryEngine
-- .decreaseStock / .consumeForSale) ya manda este parámetro leyendo
-- companyConfigStore.get().allowNegativeStock en cada llamada.
--
-- Se hace DROP + CREATE (no solo CREATE OR REPLACE) a propósito: agregar un
-- parámetro nuevo a una función existente puede dejar dos versiones
-- (overloads) coexistiendo en vez de reemplazar la de siempre, lo que
-- causaría errores de "function is not unique" mientras la app vieja (que
-- todavía llama con 3 argumentos) conviva con la nueva definición. El DROP
-- elimina la versión de 3 argumentos por completo, así solo queda una.
--
-- Cómo aplicar: pega este archivo completo en el "SQL Editor" de Supabase y
-- dale "Run". Es seguro correrlo más de una vez.
-- ============================================================================

drop function if exists public.adjust_product_stock(text, numeric, jsonb);
drop function if exists public.adjust_product_stock(text, numeric, jsonb, boolean);

create function public.adjust_product_stock(
  p_product_id text,
  p_delta numeric,
  p_extra_fields jsonb default '{}'::jsonb,
  -- true = el negocio activó "Permitir stock negativo" en Ajustes: no se
  -- rechaza el descuento aunque el stock resultante quede negativo.
  p_allow_negative boolean default false
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
    -- El UPDATE de arriba no afectó ninguna fila: o el producto no existe
    -- (o no pertenece al negocio del usuario, lo que RLS ve igual que "no
    -- existe"), o sí existe pero no había stock suficiente Y el negocio no
    -- permite stock negativo. Se distingue con una lectura aparte SOLO
    -- para dar un mensaje de error útil — el UPDATE de arriba ya falló
    -- como transacción completa, así que esta lectura no reintroduce
    -- ninguna condición de carrera real.
    if not exists (select 1 from products where id = p_product_id) then
      raise exception 'PRODUCT_NOT_FOUND' using errcode = 'P0002';
    else
      raise exception 'INSUFFICIENT_STOCK' using errcode = 'P0001';
    end if;
  end if;

  return v_updated;
end;
$$;

revoke all on function public.adjust_product_stock(text, numeric, jsonb, boolean) from public, anon;
grant execute on function public.adjust_product_stock(text, numeric, jsonb, boolean) to authenticated;