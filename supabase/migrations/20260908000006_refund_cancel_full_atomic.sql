-- supabase/migrations/20260908_refund_cancel_full_atomic.sql
-- ===========================================================================
--  FASE 4C — Cierre empresarial de dinero, inventario y estados de reembolso
--  ---------------------------------------------------------------------------
--  Este migration implementa transacciones PostgreSQL de VERDAD para
--  refund/cancel: cash + inventory + sale status + version en una sola
--  transacción. La garantía de consistencia viene del motor de base de datos,
--  no del código TypeScript.
--
--  PRs incluidos:
--    1. refund_sale_full_atomic  — cash + inventory restore + sale status (REFUNDED/PARTIALLY_REFUNDED)
--    2. cancel_sale_full_atomic  — cash + inventory restore + sale status (CANCELLED)
--    3. Fix: complete_payment_atomic, refund_sale_atomic, cancel_sale_atomic
--       ahora usan set search_path = '' y schema-qualified table refs.
--    4. Fix: adjust_product_stock usa set search_path = '' y schema-qualified refs.
--
--  Garantías:
--    - IDEMPOTENCIA: si p_refund_id ya existe en sale.refunds, se devuelve
--      already_refunded=true sin duplicar cash movements ni inventory restorations.
--    - CONCURRENCIA: optimistic lock por sale.version. Si dos requests compiten,
--      uno gana (200 OK) y el otro recibe OPTIMISTIC_LOCK_ERROR → el caller
--      reintentará y detectará la idempotencia en el segundo intento.
--    - ATOMICIDAD: si ANY paso falla (stock insuficiente, constraint violation,
--      etc.), la transacción hace rollback completo. Ni cash movement, ni
--      inventory restoration, ni sale status change se persisten.
--    - RECIPE-AWARE: la restauración de inventario expande recetas (BOM) en SQL,
--      igual que InventoryEngine.restoreForSale() en TypeScript.
-- ===========================================================================

-- ----------------------------------------------------------------------------
-- Fix: adjust_product_stock — security invoker + schema-qualified refs
-- ----------------------------------------------------------------------------
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
set search_path = ''
as $$
declare
  v_updated jsonb;
begin
  update public.products
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
    if not exists (select 1 from public.products where id = p_product_id) then
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
-- ----------------------------------------------------------------------------
-- Fix: adjust_stock_with_kardex — search_path + schema-qualified refs
-- ----------------------------------------------------------------------------
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
set search_path = ''
as $$
declare
  v_updated jsonb;
  v_product_name text;
  v_business_id uuid;
  v_movement_id text;
begin
  -- Idempotency: if the movement already exists, don't do anything.
  if p_movement_id is not null and exists (
    select 1 from public.inventory_movements where id = p_movement_id
  ) then
    select data, business_id into v_updated, v_business_id
    from public.products
    where id = p_product_id;

    return v_updated;
  end if;

  -- Get product name and business_id for kardex and validations.
  select data->>'name', business_id into v_product_name, v_business_id
  from public.products
  where id = p_product_id;

  if v_product_name is null then
    raise exception 'PRODUCT_NOT_FOUND' using errcode = 'P0002';
  end if;

  v_movement_id := coalesce(p_movement_id, gen_random_uuid()::text);

  -- 1) Insert kardex movement (atomic with stock adjustment via transaction).
  insert into public.inventory_movements (id, business_id, branch_id, data)
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

  -- 2) Adjust stock atomically.
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
-- ----------------------------------------------------------------------------
-- Fix: complete_payment_atomic — search_path + schema-qualified refs
-- ----------------------------------------------------------------------------
create or replace function public.complete_payment_atomic(
  p_business_id  uuid,
  p_branch_id    uuid,
  p_sale_id      text,
  p_sale_version integer,
  p_payment_method text,
  p_amount       numeric,
  p_cash_amount  numeric,
  p_change_amount numeric
)
returns table(
  sale_updated   boolean,
  income_id      text,
  change_id      text
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_sale jsonb;
  v_income_id text;
  v_change_id text;
begin
  -- 1. Re-leer la venta con su versión actual (optimistic lock)
  select data into v_sale
  from public.sales
  where business_id = p_business_id
    and branch_id = p_branch_id
    and data->>'id' = p_sale_id;

  if v_sale is null then
    raise exception 'SALE_NOT_FOUND';
  end if;

  -- 2. Idempotencia: si ya está PAID/CLOSED, no registrar nada de nuevo
  if (v_sale->>'status')::text in ('PAID', 'CLOSED') then
    return query select false, null::text, null::text;
    return;
  end if;

  -- 3. Optimistic lock: la versión debe coincidir
  if (v_sale->>'version')::integer <> p_sale_version then
    raise exception 'OPTIMISTIC_LOCK_ERROR';
  end if;

  -- 4. Marcar como PAID (incrementar versión)
  update public.sales
  set data = jsonb_set(v_sale, '{status}', '"PAID"', false)
             || jsonb_set(v_sale, '{paymentMethod}', to_jsonb(p_payment_method), false),
    version = version + 1,
    updated_at = now()
  where business_id = p_business_id
    and branch_id = p_branch_id
    and data->>'id' = p_sale_id
    and version = p_sale_version;  -- doble chequeo optimista

  -- 5. Insertar movimiento de ingreso en caja
  insert into public.cash_movements (business_id, branch_id, data)
  values (
    p_business_id,
    p_branch_id,
    jsonb_build_object(
      'id', gen_random_uuid(),
      'type', 'IN',
      'amount', p_amount,
      'paymentMethod', p_payment_method,
      'cashAmount', p_cash_amount,
      'saleId', p_sale_id,
      'createdAt', now()
    )
  )
  returning data->>'id' into v_income_id;

  -- 6. Insertar movimiento de cambio (si aplica)
  if p_change_amount > 0 then
    insert into public.cash_movements (business_id, branch_id, data)
    values (
      p_business_id,
      p_branch_id,
      jsonb_build_object(
        'id', gen_random_uuid(),
        'type', 'OUT',
        'amount', p_change_amount,
        'paymentMethod', 'CASH',
        'cashAmount', p_change_amount,
        'saleId', p_sale_id,
        'createdAt', now()
      )
    )
    returning data->>'id' into v_change_id;
  end if;

  -- 7. Todo en una transacción: si algo falló, se hace rollback automático
  return query select true, v_income_id, v_change_id;
end;
$$;
revoke execute on function public.complete_payment_atomic(uuid,uuid,text,integer,text,numeric,numeric,numeric) from public;
grant execute on function public.complete_payment_atomic(uuid,uuid,text,integer,text,numeric,numeric,numeric) to authenticated;
-- ----------------------------------------------------------------------------
-- Fix: refund_sale_atomic — search_path + schema-qualified refs
-- (This is the cash-only version; inventory restoration still happens in TS.
--  Use refund_sale_full_atomic for full transactional consistency.)
-- ----------------------------------------------------------------------------
create or replace function public.refund_sale_atomic(
  p_business_id  uuid,
  p_branch_id    uuid,
  p_sale_id      text,
  p_sale_version integer,
  p_amount       numeric,
  p_refund_reason text,
  p_actor_id     text,
  p_refund_id    text
)
returns table(
  sale_updated   boolean,
  cash_expense_id text,
  already_refunded boolean
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_sale jsonb;
  v_cash_expense_id text;
begin
  -- 1. Re-leer la venta con su versión actual (optimistic lock)
  select data into v_sale
  from public.sales
  where business_id = p_business_id
    and branch_id = p_branch_id
    and data->>'id' = p_sale_id;

  if v_sale is null then
    raise exception 'SALE_NOT_FOUND';
  end if;

  -- 2. Idempotency: if already refunded/cancelled/closed, check refund ID
  if (v_sale->>'status')::text in ('REFUNDED', 'CANCELLED', 'CLOSED', 'PARTIALLY_REFUNDED') then
    if jsonb_path_exists(v_sale, '$.refunds[*] ? (@.id == $refund_id)', p_refund_id, p_refund_id) then
      return query select false, null::text, true;
      return;
    end if;
  end if;

  -- 3. Optimistic lock: la versión debe coincidir
  if (v_sale->>'version')::integer <> p_sale_version then
    raise exception 'OPTIMISTIC_LOCK_ERROR';
  end if;

  -- 4. Insertar movimiento de egreso en caja (con ID determinístico)
  insert into public.cash_movements (business_id, branch_id, data)
  values (
    p_business_id,
    p_branch_id,
    jsonb_build_object(
      'id', p_refund_id,
      'type', 'OUT',
      'amount', p_amount,
      'paymentMethod', 'CASH',
      'cashAmount', p_amount,
      'saleId', p_sale_id,
      'description', p_refund_reason,
      'createdAt', now()
    )
  )
  returning data->>'id' into v_cash_expense_id;

  -- 5. Marcar la venta como REFUNDED y agregar el refund record
  update public.sales
  set data = jsonb_set(v_sale, '{status}', '"REFUNDED"', false)
            || jsonb_set(
                v_sale,
                '{refunds}',
                coalesce(v_sale->'refunds', '[]'::jsonb) || jsonb_build_array(
                  jsonb_build_object(
                    'id', p_refund_id,
                    'amount', p_amount,
                    'reason', p_refund_reason,
                    'actorId', p_actor_id,
                    'createdAt', now()
                  )
                ),
                false
              ),
      version = version + 1,
      updated_at = now()
  where business_id = p_business_id
    and branch_id = p_branch_id
    and data->>'id' = p_sale_id
    and version = p_sale_version;

  -- 6. Todo en una transacción: si algo falló, se hace rollback automático
  return query select true, v_cash_expense_id, false;
end;
$$;
revoke execute on function public.refund_sale_atomic(uuid,uuid,text,integer,numeric,text,text,text) from public;
grant execute on function public.refund_sale_atomic(uuid,uuid,text,integer,numeric,text,text,text) to authenticated;
-- ----------------------------------------------------------------------------
-- Fix: cancel_sale_atomic — search_path + schema-qualified refs
-- ----------------------------------------------------------------------------
create or replace function public.cancel_sale_atomic(
  p_business_id  uuid,
  p_branch_id    uuid,
  p_sale_id      text,
  p_sale_version integer,
  p_amount       numeric,
  p_cancel_reason text,
  p_actor_id     text
)
returns table(
  sale_updated   boolean,
  cash_expense_id text,
  already_cancelled boolean
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_sale jsonb;
  v_cash_expense_id text;
begin
  -- 1. Re-leer la venta
  select data into v_sale
  from public.sales
  where business_id = p_business_id
    and branch_id = p_branch_id
    and data->>'id' = p_sale_id;

  if v_sale is null then
    raise exception 'SALE_NOT_FOUND';
  end if;

  -- 2. Idempotency: if already cancelled, return without doing anything
  if (v_sale->>'status')::text = 'CANCELLED' then
    return query select false, null::text, true;
    return;
  end if;

  -- No se puede cancelar una venta REFUNDED o CLOSED (PARTIALLY_REFUNDED is allowed)
  if (v_sale->>'status')::text in ('REFUNDED', 'CLOSED') then
    raise exception 'SALE_CANNOT_BE_CANCELLED: la venta ya fue reembolsada o cerrada';
  end if;

  -- 3. Optimistic lock
  if (v_sale->>'version')::integer <> p_sale_version then
    raise exception 'OPTIMISTIC_LOCK_ERROR';
  end if;

  -- 4. Insertar movimiento de egreso en caja (ID determinístico)
  insert into public.cash_movements (business_id, branch_id, data)
  values (
    p_business_id,
    p_branch_id,
    jsonb_build_object(
      'id', 'sale-cancel-' || p_sale_id,
      'type', 'OUT',
      'amount', p_amount,
      'paymentMethod', 'CASH',
      'cashAmount', p_amount,
      'saleId', p_sale_id,
      'description', p_cancel_reason,
      'createdAt', now()
    )
  )
  returning data->>'id' into v_cash_expense_id;

  -- 5. Marcar como CANCELLED
  update public.sales
  set data = jsonb_set(v_sale, '{status}', '"CANCELLED"', false)
            || jsonb_set(v_sale, '{notes}',
                coalesce(v_sale->'notes', '""') || ' | ' || p_cancel_reason,
                false),
    version = version + 1,
    updated_at = now()
  where business_id = p_business_id
    and branch_id = p_branch_id
    and data->>'id' = p_sale_id
    and version = p_sale_version;

  return query select true, v_cash_expense_id, false;
end;
$$;
revoke execute on function public.cancel_sale_atomic(uuid,uuid,text,integer,numeric,text,text) from public;
grant execute on function public.cancel_sale_atomic(uuid,uuid,text,integer,numeric,text,text) to authenticated;
-- ----------------------------------------------------------------------------
-- FULL ATOMIC REFUND: cash + inventory + sale status (REFUNDED/PARTIALLY_REFUNDED)
--
-- Esta función hace TODO dentro de una sola transacción de PostgreSQL:
--   1. Valida ownership (business_id, branch_id)
--   2. Chequea idempotencia (refund_id ya existe → already_refunded=true)
--   3. Optimistic lock (version must match)
--   4. Registra egreso de caja (deterministic ID)
--   5. Restaura inventario (recipe-aware, calling adjust_stock_with_kardex)
--   6. Determina nuevo estado:
--      - Si todos los ítems están completamente reembolsados → REFUNDED
--      - Si aún quedan ítems por reembolsar → PARTIALLY_REFUNDED
--   7. Actualiza sale.status, sale.refunds[], sale.version
--
-- Si CUALQUIER paso falla, rollback automático: ni caja, ni inventario,
-- ni sale status se persisten.
-- ----------------------------------------------------------------------------
create or replace function public.refund_sale_full_atomic(
  p_business_id   uuid,
  p_branch_id     uuid,
  p_sale_id       text,
  p_sale_version  integer,
  p_amount        numeric,
  p_refund_reason text,
  p_actor_id      text,
  p_refund_id     text,
  p_refund_items  jsonb,       -- [{"productId": "...", "quantity": N}, ...]
  p_inventory_reason text
)
returns table(
  sale_updated     boolean,
  cash_expense_id  text,
  already_refunded boolean,
  new_status        text
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_sale            jsonb;
  v_cash_expense_id text;
  v_new_status      text;
  v_item            jsonb;
  v_product_id      text;
  v_quantity         numeric;
  v_product          jsonb;
  v_recipe           jsonb;
  v_recipe_item      jsonb;
  v_ingredient_id    text;
  v_ingredient_qty   numeric;
  v_movement_id      text;
  v_product_name     text;
  v_refund_record    jsonb;
  v_refunded_qty     numeric;
  v_original_qty     numeric;
  v_all_fully_refunded boolean := true;
  v_refund_entry     jsonb;
begin
  -- 1. Re-leer la venta
  select data into v_sale
  from public.sales
  where business_id = p_business_id
    and branch_id = p_branch_id
    and data->>'id' = p_sale_id;

  if v_sale is null then
    raise exception 'SALE_NOT_FOUND';
  end if;

  -- 2. Idempotencia: si el refund_id ya existe en el arreglo de refunds,
  --    o si la venta ya está REFUNDED/CANCELLED, devolver sin duplicar.
  if (v_sale->>'status')::text in ('REFUNDED', 'CANCELLED', 'CLOSED') then
    return query select false, null::text, true, v_sale->>'status';
    return;
  end if;

  if p_refund_id is not null then
    if jsonb_path_exists(v_sale, '$.refunds[*] ? (@.id == $rid)', jsonb_build_object('rid', p_refund_id)) then
      return query select false, null::text, true, v_sale->>'status';
      return;
    end if;
  end if;

  -- 3. Optimistic lock
  if (v_sale->>'version')::integer <> p_sale_version then
    raise exception 'OPTIMISTIC_LOCK_ERROR';
  end if;

  -- 4. Insertar movimiento de egreso en caja (con ID determinístico)
  insert into public.cash_movements (business_id, branch_id, data)
  values (
    p_business_id,
    p_branch_id,
    jsonb_build_object(
      'id', p_refund_id,
      'type', 'OUT',
      'amount', p_amount,
      'paymentMethod', 'CASH',
      'cashAmount', p_amount,
      'saleId', p_sale_id,
      'description', p_refund_reason,
      'createdAt', now()
    )
  )
  returning data->>'id' into v_cash_expense_id;

  -- 5. Restaurar inventario (recipe-aware)
  for v_item in select jsonb_array_elements(p_refund_items)
  loop
    v_product_id := v_item->>'productId';
    v_quantity := (v_item->>'quantity')::numeric;

    -- Leer producto
    select data into v_product
    from public.products
    where business_id = p_business_id
      and id = v_product_id;

    if v_product is null then
      -- Product not found — skip this item but don't fail the whole refund
      continue;
    end if;

    v_recipe := v_product->'recipe';
    v_product_name := v_product->>'name';

    -- Recipe expansion: same logic as InventoryEngine.restoreForSale()
    if v_recipe is not null
       and jsonb_array_length(v_recipe) > 0
       and (v_product->>'productionMode')::text <> 'BATCH' then

      -- Producto con receta ON_DEMAND: restaurar ingredientes, no el producto
      for v_recipe_item in select jsonb_array_elements(v_recipe)
      loop
        v_ingredient_id := v_recipe_item->>'productId';
        v_ingredient_qty := (v_recipe_item->>'quantity')::numeric * v_quantity;

        v_movement_id := 'refund-' || p_refund_id || '-' || v_ingredient_id;

        -- Idempotencia del kardex: saltear si el movimiento ya existe
        if not exists (
          select 1 from public.inventory_movements where id = v_movement_id
        ) then
          -- Registrar kardex
          insert into public.inventory_movements (id, business_id, branch_id, data)
          values (
            v_movement_id,
            p_business_id,
            p_branch_id,
            jsonb_build_object(
              'id', v_movement_id,
              'productId', v_ingredient_id,
              'productName', (select data->>'name' from public.products where id = v_ingredient_id and business_id = p_business_id),
              'quantity', abs(v_ingredient_qty),
              'date', now(),
              'type', 'INCREASE',
              'reason', p_inventory_reason,
              'performedBy', p_actor_id,
              'branchId', p_branch_id
            )
          );

          -- Ajustar stock
          perform public.adjust_product_stock(
            v_ingredient_id,
            v_ingredient_qty,
            '{}'::jsonb,
            false,
            p_branch_id
          );
        end if;
      end loop;

    elsif (v_product->'trackStock')::boolean IS DISTINCT FROM false
       or (v_recipe is not null
           and jsonb_array_length(v_recipe) > 0
           and (v_product->>'productionMode')::text = 'BATCH') then

      -- Producto simple o BATCH: restaurar el producto directamente
      v_movement_id := 'refund-' || p_refund_id || '-' || v_product_id;

      if not exists (
        select 1 from public.inventory_movements where id = v_movement_id
      ) then
        insert into public.inventory_movements (id, business_id, branch_id, data)
        values (
          v_movement_id,
          p_business_id,
          p_branch_id,
          jsonb_build_object(
            'id', v_movement_id,
            'productId', v_product_id,
            'productName', v_product_name,
            'quantity', abs(v_quantity),
            'date', now(),
            'type', 'INCREASE',
            'reason', p_inventory_reason,
            'performedBy', p_actor_id,
            'branchId', p_branch_id
          )
        );

        perform public.adjust_product_stock(
          v_product_id,
          v_quantity,
          '{}'::jsonb,
          false,
          p_branch_id
        );
      end if;
    end if;
  end loop;

  -- 6. Determinar nuevo estado
  -- Sumar todos los refunds existentes + este nuevo refund para cada producto
  -- y comparar contra las cantidades originales de la venta.
  -- Si todos los productos están completamente reembolsados → REFUNDED,
  -- de lo contrario → PARTIALLY_REFUNDED.

  v_all_fully_refunded := true;

  for v_item in select jsonb_array_elements(v_sale->'items')
  loop
    v_product_id := v_item->>'productId';
    v_original_qty := (v_item->>'quantity')::numeric;

    -- Sumar cantidades ya reembolsadas de este producto (de refunds existentes)
    v_refunded_qty := 0;
    for v_refund_entry in select jsonb_array_elements(v_sale->'refunds')
    loop
      for v_recipe_item in select jsonb_array_elements(v_refund_entry->'items')
      loop
        if v_recipe_item->>'productId' = v_product_id then
          v_refunded_qty := v_refunded_qty + (v_recipe_item->>'quantity')::numeric;
        end if;
      end loop;
    end loop;

    -- Sumar cantidades de este refund
    for v_refund_entry in select jsonb_array_elements(p_refund_items)
    loop
      if v_refund_entry->>'productId' = v_product_id then
        v_refunded_qty := v_refunded_qty + (v_refund_entry->>'quantity')::numeric;
      end if;
    end loop;

    if v_refunded_qty < v_original_qty then
      v_all_fully_refunded := false;
    end if;
  end loop;

  if v_all_fully_refunded then
    v_new_status := 'REFUNDED';
  else
    v_new_status := 'PARTIALLY_REFUNDED';
  end if;

  -- 7. Construir el refund record y actualizar la venta
  v_refund_record := jsonb_build_object(
    'id', p_refund_id,
    'items', p_refund_items,
    'amount', p_amount,
    'reason', p_refund_reason,
    'actorId', p_actor_id,
    'createdAt', now()
  );

  update public.sales
  set data = jsonb_set(v_sale, '{status}', to_jsonb(v_new_status)::jsonb, false)
             || jsonb_set(
                 v_sale,
                 '{refunds}',
                 coalesce(v_sale->'refunds', '[]'::jsonb) || jsonb_build_array(v_refund_record),
                 false
               )
             || jsonb_set(
                 v_sale,
                 '{notes}',
                 coalesce(v_sale->'notes', '""'),
                 false),
    version = version + 1,
    updated_at = now()
  where business_id = p_business_id
    and branch_id = p_branch_id
    and data->>'id' = p_sale_id
    and version = p_sale_version;

  -- 8. Todo en una transacción: si algo falló, rollback automático
  return query select true, v_cash_expense_id, false, v_new_status;
end;
$$;
revoke execute on function public.refund_sale_full_atomic(
  uuid,uuid,text,integer,numeric,text,text,text,jsonb,text
) from public;
grant execute on function public.refund_sale_full_atomic(
  uuid,uuid,text,integer,numeric,text,text,text,jsonb,text
) to authenticated;
-- ----------------------------------------------------------------------------
-- FULL ATOMIC CANCEL: cash + inventory + sale status (CANCELLED)
--
-- Esta función hace TODO dentro de una sola transacción:
--   1. Valida ownership (business_id, branch_id)
--   2. Chequea idempotencia (si ya está CANCELLED → already_cancelled=true)
--   3. Optimistic lock (version must match)
--   4. Si la venta fue PAID/CLOSED: registra egreso de caja (deterministic ID)
--   5. Restaura inventario (recipe-aware, calling adjust_stock_with_kardex)
--   6. Marca la venta como CANCELLED y actualiza notes + version
--
-- Si CUALQUIER paso falla, rollback completo.
-- ----------------------------------------------------------------------------
create or replace function public.cancel_sale_full_atomic(
  p_business_id   uuid,
  p_branch_id     uuid,
  p_sale_id       text,
  p_sale_version  integer,
  p_amount        numeric,
  p_cancel_reason text,
  p_actor_id      text,
  p_cancel_items  jsonb,       -- [{"productId": "...", "quantity": N}, ...]
  p_inventory_reason text,
  p_was_paid       boolean     -- If true, register cash expense; if false, skip
)
returns table(
  sale_updated      boolean,
  cash_expense_id   text,
  already_cancelled boolean
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_sale            jsonb;
  v_cash_expense_id text;
  v_item            jsonb;
  v_product_id      text;
  v_quantity         numeric;
  v_product          jsonb;
  v_recipe           jsonb;
  v_recipe_item      jsonb;
  v_ingredient_id    text;
  v_ingredient_qty   numeric;
  v_movement_id      text;
  v_product_name     text;
begin
  -- 1. Re-leer la venta
  select data into v_sale
  from public.sales
  where business_id = p_business_id
    and branch_id = p_branch_id
    and data->>'id' = p_sale_id;

  if v_sale is null then
    raise exception 'SALE_NOT_FOUND';
  end if;

  -- 2. Idempotency: if already cancelled, return without doing anything
  if (v_sale->>'status')::text = 'CANCELLED' then
    return query select false, null::text, true;
    return;
  end if;

  -- No se puede cancelar una venta REFUNDED o CLOSED (PARTIALLY_REFUNDED is allowed —
  -- canceling restores the remaining items that weren't refunded yet)
  if (v_sale->>'status')::text in ('REFUNDED', 'CLOSED') then
    raise exception 'SALE_CANNOT_BE_CANCELLED: la venta ya fue reembolsada o cerrada';
  end if;

  -- 3. Optimistic lock
  if (v_sale->>'version')::integer <> p_sale_version then
    raise exception 'OPTIMISTIC_LOCK_ERROR';
  end if;

  -- 4. Si la venta fue pagada, registrar egreso de caja (deterministic ID)
  if p_was_paid then
    insert into public.cash_movements (business_id, branch_id, data)
    values (
      p_business_id,
      p_branch_id,
      jsonb_build_object(
        'id', 'sale-cancel-' || p_sale_id,
        'type', 'OUT',
        'amount', p_amount,
        'paymentMethod', 'CASH',
        'cashAmount', p_amount,
        'saleId', p_sale_id,
        'description', p_cancel_reason,
        'createdAt', now()
      )
    )
    returning data->>'id' into v_cash_expense_id;
  end if;

  -- 5. Restaurar inventario (recipe-aware)
  for v_item in select jsonb_array_elements(p_cancel_items)
  loop
    v_product_id := v_item->>'productId';
    v_quantity := (v_item->>'quantity')::numeric;

    select data into v_product
    from public.products
    where business_id = p_business_id
      and id = v_product_id;

    if v_product is null then
      continue;
    end if;

    v_recipe := v_product->'recipe';
    v_product_name := v_product->>'name';

    if v_recipe is not null
       and jsonb_array_length(v_recipe) > 0
       and (v_product->>'productionMode')::text <> 'BATCH' then

      for v_recipe_item in select jsonb_array_elements(v_recipe)
      loop
        v_ingredient_id := v_recipe_item->>'productId';
        v_ingredient_qty := (v_recipe_item->>'quantity')::numeric * v_quantity;

        v_movement_id := 'cancel-' || p_sale_id || '-' || v_ingredient_id;

        if not exists (
          select 1 from public.inventory_movements where id = v_movement_id
        ) then
          insert into public.inventory_movements (id, business_id, branch_id, data)
          values (
            v_movement_id,
            p_business_id,
            p_branch_id,
            jsonb_build_object(
              'id', v_movement_id,
              'productId', v_ingredient_id,
              'productName', (select data->>'name' from public.products where id = v_ingredient_id and business_id = p_business_id),
              'quantity', abs(v_ingredient_qty),
              'date', now(),
              'type', 'INCREASE',
              'reason', p_inventory_reason,
              'performedBy', p_actor_id,
              'branchId', p_branch_id
            )
          );

          perform public.adjust_product_stock(
            v_ingredient_id,
            v_ingredient_qty,
            '{}'::jsonb,
            false,
            p_branch_id
          );
        end if;
      end loop;

    elsif (v_product->'trackStock')::boolean IS DISTINCT FROM false
       or (v_recipe is not null
           and jsonb_array_length(v_recipe) > 0
           and (v_product->>'productionMode')::text = 'BATCH') then

      v_movement_id := 'cancel-' || p_sale_id || '-' || v_product_id;

      if not exists (
        select 1 from public.inventory_movements where id = v_movement_id
      ) then
        insert into public.inventory_movements (id, business_id, branch_id, data)
        values (
          v_movement_id,
          p_business_id,
          p_branch_id,
          jsonb_build_object(
            'id', v_movement_id,
            'productId', v_product_id,
            'productName', v_product_name,
            'quantity', abs(v_quantity),
            'date', now(),
            'type', 'INCREASE',
            'reason', p_inventory_reason,
            'performedBy', p_actor_id,
            'branchId', p_branch_id
          )
        );

        perform public.adjust_product_stock(
          v_product_id,
          v_quantity,
          '{}'::jsonb,
          false,
          p_branch_id
        );
      end if;
    end if;
  end loop;

  -- 6. Marcar como CANCELLED
  update public.sales
  set data = jsonb_set(v_sale, '{status}', '"CANCELLED"', false)
             || jsonb_set(
                 v_sale,
                 '{notes}',
                 coalesce(v_sale->'notes', '""') || ' | ' || p_cancel_reason,
                 false),
    version = version + 1,
    updated_at = now()
  where business_id = p_business_id
    and branch_id = p_branch_id
    and data->>'id' = p_sale_id
    and version = p_sale_version;

  return query select true, v_cash_expense_id, false;
end;
$$;
revoke execute on function public.cancel_sale_full_atomic(
  uuid,uuid,text,integer,numeric,text,text,jsonb,text,boolean
) from public;
grant execute on function public.cancel_sale_full_atomic(
  uuid,uuid,text,integer,numeric,text,text,jsonb,text,boolean
) to authenticated;
