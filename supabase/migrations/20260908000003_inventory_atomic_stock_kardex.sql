-- ============================================================================
-- INVENTORY ATOMIC OPERATIONS — Stock + Kardex atómicos
-- ============================================================================
-- Problema resuelto:
--   Antes: kardex.record() se ejecutaba ANTES de adjustStock(). Si
--   adjustStock fallaba (stock insuficiente, producto no encontrado, etc.),
--   quedaba un movimiento de Kardex "huérfano" sin cambio de stock real.
--
-- Solución: esta función ejecuta AMBAS operaciones dentro de la MISMA
-- transacción de PostgreSQL. Si cualquiera falla, NADA se persiste.
--
-- Idempotencia: si se pasa p_movement_id y ya existe en inventory_movements,
-- la función no modifica stock ni duplica el movimiento; devuelve el estado
-- actual del producto.
-- ============================================================================

create or replace function public.adjust_stock_with_kardex(
  p_product_id text,
  p_delta numeric,
  p_reason text,
  p_type text,
  p_performed_by text default null,
  p_supplier_id uuid default null,
  p_supplier_name text default null,
  p_loss_category text default null,
  p_movement_id text default null,
  p_branch_id uuid default null,
  p_allow_negative boolean default false
)
returns jsonb
language plpgsql
security invoker
as $$
declare
  v_updated jsonb;
  v_product_name text;
  v_business_id uuid;
  v_movement_id text;
begin
  -- Idempotencia: si el movimiento ya existe, no hacemos nada.
  if p_movement_id is not null and exists (
    select 1 from inventory_movements where id = p_movement_id
  ) then
    select data, business_id into v_updated, v_business_id
    from products
    where id = p_product_id;

    return v_updated;
  end if;

  -- Datos del producto para el Kardex y validaciones.
  select data->>'name', business_id into v_product_name, v_business_id
  from products
  where id = p_product_id;

  if v_product_name is null then
    raise exception 'PRODUCT_NOT_FOUND' using errcode = 'P0002';
  end if;

  v_movement_id := coalesce(p_movement_id, gen_random_uuid()::text);

  -- 1) Registrar Kardex PRIMERO.
  --    Si el paso 2 (ajuste de stock) falla, la transacción completa se
  --    revierte y este INSERT desaparece. No quedan movimientos huérfanos.
  insert into inventory_movements (id, business_id, branch_id, data)
  values (
    v_movement_id,
    v_business_id,
    p_branch_id,
    jsonb_build_object(
      'id', v_movement_id,
      'productId', p_product_id,
      'productName', v_product_name,
      'quantity', abs(p_delta),
      'date', now(),
      'type', p_type,
      'reason', p_reason,
      'performedBy', p_performed_by,
      'supplierId', p_supplier_id,
      'supplierName', p_supplier_name,
      'lossCategory', p_loss_category,
      'branchId', p_branch_id
    )
  );

  -- 2) Ajustar stock (función atómica existente).
  v_updated := public.adjust_product_stock(
    p_product_id,
    p_delta,
    '{}'::jsonb,
    p_allow_negative,
    p_branch_id
  );

  if v_updated is null then
    raise exception 'INSUFFICIENT_STOCK' using errcode = 'P0001';
  end if;

  return v_updated;
end;
$$;
revoke all on function public.adjust_stock_with_kardex(
  text, numeric, text, text,
  text, uuid, text, text,
  text, uuid, boolean
) from public, anon;
grant execute on function public.adjust_stock_with_kardex(
  text, numeric, text, text,
  text, uuid, text, text,
  text, uuid, boolean
) to authenticated;
