-- ============================================================================
-- VIMDY OS — FASE 4D — HARDENING DE RPCs FINANCIEROS CRÍTICOS
-- ----------------------------------------------------------------------------
-- Cierres de seguridad, concurrencia e integridad financiera para los
-- RPCs que manejan dinero, inventario y estado de venta.
--
-- CAMBIOS:
--   1. complete_payment_atomic: FOR UPDATE + auth check
--   2. refund_sale_full_atomic:  FOR UPDATE + auth check + item/amount validation
--   3. cancel_sale_full_atomic:  FOR UPDATE + auth check + item/amount validation
--   4. Unique index en cash_movements(data->>'id') para idempotency a nivel DB
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 0. Unique index en cash_movements para garantizar idempotencia a nivel DB
--    El ID determinístico (refund-<saleId>-<refundId>, sale-cancel-<saleId>)
--    se almacena en data->>'id'. Un índice UNIQUE evita que dos requests
--    concurrentes inserten movimientos duplicados.
-- ----------------------------------------------------------------------------
create unique index if not exists cash_movements_business_deterministic_id
  on cash_movements (business_id, (data->>'id'))
  where data->>'id' is not null;
-- ----------------------------------------------------------------------------
-- 1. complete_payment_atomic — Hardening
--    - FOR UPDATE en el SELECT de la venta
--    - Auth check: el usuario autenticado debe ser miembro del negocio
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
  -- Auth check: el usuario autenticado debe pertenecer al negocio
  if auth.uid() is not null then
    if not exists (
      select 1 from unnest(public.auth_business_ids()) AS bid
      WHERE bid = p_business_id
    ) then
      raise exception 'NOT_A_MEMBER: no perteneces a este negocio.';
    end if;
  end if;

  -- 1. Re-leer la venta con FOR UPDATE (row locking para concurrencia)
  select data into v_sale
  from public.sales
  where business_id = p_business_id
    and branch_id = p_branch_id
    and data->>'id' = p_sale_id
  for update;

  if v_sale is null then
    raise exception 'SALE_NOT_FOUND';
  end if;

  -- 2. Idempotencia: si ya está PAID/CLOSED, no hacer nada
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
    and version = p_sale_version;

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

  -- 7. Todo en una transacción: si algo falló, rollback automático
  return query select true, v_income_id, v_change_id;
end;
$$;
revoke execute on function public.complete_payment_atomic(
  uuid,uuid,text,integer,text,numeric,numeric,numeric
) from public;
grant execute on function public.complete_payment_atomic(
  uuid,uuid,text,integer,text,numeric,numeric,numeric
) to authenticated;
-- ----------------------------------------------------------------------------
-- 2. refund_sale_full_atomic — Hardening
--    - FOR UPDATE en el SELECT de la venta
--    - Auth check
--    - Validación de items: producto pertenece a la venta, cantidad válida
--    - Validación de monto: no excede el importe restante reembolsable
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
  p_refund_items  jsonb,
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
  v_sale_item       jsonb;
  v_product_id      text;
  v_quantity         numeric;
  v_unit_price      numeric;
  v_expected_amount numeric := 0;
  v_original_qty    numeric;
  v_refunded_qty    numeric;
  v_total_remaining numeric;
  v_refunded_total  numeric;
  v_refund_entry    jsonb;
  -- Variables for recipe-aware inventory restoration (same logic as before)
  v_product          jsonb;
  v_recipe           jsonb;
  v_recipe_item      jsonb;
  v_ingredient_id    text;
  v_ingredient_qty   numeric;
  v_movement_id      text;
  v_product_name     text;
  v_refund_record    jsonb;
  v_all_fully_refunded boolean := true;
begin
  -- Auth check: el usuario autenticado debe pertenecer al negocio
  if auth.uid() is not null then
    if not exists (
      select 1 from unnest(public.auth_business_ids()) AS bid
      WHERE bid = p_business_id
    ) then
      raise exception 'NOT_A_MEMBER: no perteneces a este negocio.';
    end if;
  end if;

  -- 1. Re-leer la venta con FOR UPDATE (row locking)
  select data into v_sale
  from public.sales
  where business_id = p_business_id
    and branch_id = p_branch_id
    and data->>'id' = p_sale_id
  for update;

  if v_sale is null then
    raise exception 'SALE_NOT_FOUND';
  end if;

  -- 2. Idempotencia: si ya está en estado terminal, verificar refund_id
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

  -- 4. VALIDACIÓN DE ITEMS y CÁLCULO DE MONTO ESPERADO
  -- Para cada item en p_refund_items:
  --   - Verificar que el producto existe en la venta
  --   - Verificar cantidad > 0
  --   - Verificar que cantidad <= (original - ya reembolsado)
  --   - Acumular el monto esperado (precio_unitario * cantidad)
  v_expected_amount := 0;
  for v_item in select jsonb_array_elements(p_refund_items)
  loop
    v_product_id := v_item->>'productId';
    v_quantity := (v_item->>'quantity')::numeric;

    -- Cantidad debe ser > 0
    if v_quantity <= 0 then
      raise exception 'INVALID_REFUND_QUANTITY: la cantidad debe ser mayor a 0 para %', v_product_id;
    end if;

    -- Buscar el producto en los items de la venta
    v_unit_price := null;
    v_original_qty := 0;
    for v_sale_item in select jsonb_array_elements(v_sale->'items')
    loop
      if v_sale_item->>'productId' = v_product_id then
        v_unit_price := (v_sale_item->>'price')::numeric;
        v_original_qty := (v_sale_item->>'quantity')::numeric;
        exit;
      end if;
    end loop;

    -- Producto debe pertenecer a la venta
    if v_unit_price is null then
      raise exception 'REFUND_ITEM_NOT_IN_SALE: el producto % no pertenece a esta venta.', v_product_id;
    end if;

    -- Calcular cuánto se ha reembolsado ya de este producto
    v_refunded_qty := 0;
    for v_refund_entry in select jsonb_array_elements(coalesce(v_sale->'refunds', '[]'::jsonb))
    loop
      for v_recipe_item in select jsonb_array_elements(v_refund_entry->'items')
      loop
        if v_recipe_item->>'productId' = v_product_id then
          v_refunded_qty := v_refunded_qty + (v_recipe_item->>'quantity')::numeric;
        end if;
      end loop;
    end loop;

    -- Cantidad solicitada no debe exceder lo disponible
    if v_quantity > (v_original_qty - v_refunded_qty) then
      raise exception 'REFUND_EXCEEDS_AVAILABLE: solo quedan % unidad(es) reembolsables de % (de % compradas).',
        (v_original_qty - v_refunded_qty), v_product_id, v_original_qty;
    end if;

    -- Acumular monto esperado
    v_expected_amount := v_expected_amount + v_unit_price * v_quantity;
  end loop;

  -- 5. VALIDACIÓN DE MONTO: no debe exceder el importe restante reembolsable
  v_refunded_total := 0;
  for v_refund_entry in select jsonb_array_elements(coalesce(v_sale->'refunds', '[]'::jsonb))
  loop
    v_refunded_total := v_refunded_total + (v_refund_entry->>'amount')::numeric;
  end loop;
  v_total_remaining := (v_sale->>'total')::numeric - v_refunded_total;

  if p_amount > v_total_remaining then
    raise exception 'REFUND_AMOUNT_EXCEEDS_REMAINING: el monto solicitado (%) excede el importe restante (%)',
      p_amount, v_total_remaining;
  end if;

  -- Usar el monto esperado recalculado (más conservador que confiar en p_amount)
  -- Pero permitir una pequeña tolerancia por redondeos
  if abs(p_amount - v_expected_amount) > 1 then
    -- Si p_amount no coincide con el cálculo, usar el recalculado
    -- Esto previene manipulación de montos desde el cliente
    p_amount := v_expected_amount;
  end if;

  -- 6. Insertar movimiento de egreso en caja (con ID determinístico)
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

  -- 7. Restaurar inventario (recipe-aware) — MISMO LÓGICA QUE ANTES
  for v_item in select jsonb_array_elements(p_refund_items)
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

        v_movement_id := 'refund-' || p_refund_id || '-' || v_ingredient_id;

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

  -- 8. Determinar nuevo estado
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

  -- 9. Construir el refund record y actualizar la venta
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
-- 3. cancel_sale_full_atomic — Hardening
--    - FOR UPDATE en el SELECT de la venta
--    - Auth check
--    - Validación de items: producto pertenece a la venta, cantidad válida
--    - Validación de monto: recalcula remaining desde la venta + refunds existentes
--    - PARTIALLY_REFUNDED es un estado válido para cancelar (restaura lo pendiente)
-- ----------------------------------------------------------------------------
create or replace function public.cancel_sale_full_atomic(
  p_business_id   uuid,
  p_branch_id     uuid,
  p_sale_id       text,
  p_sale_version  integer,
  p_amount        numeric,
  p_cancel_reason text,
  p_actor_id      text,
  p_cancel_items  jsonb,
  p_inventory_reason text,
  p_was_paid       boolean
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
  v_sale_item       jsonb;
  v_product_id      text;
  v_quantity         numeric;
  v_unit_price      numeric;
  v_original_qty    numeric;
  v_refunded_qty    numeric;
  v_expected_remaining numeric;
  v_refunded_total  numeric;
  v_refund_entry    jsonb;
  v_recipe_item     jsonb;
  -- Variables for recipe-aware inventory restoration
  v_product          jsonb;
  v_recipe           jsonb;
  -- v_recipe_item already declared above
  v_ingredient_id    text;
  v_ingredient_qty   numeric;
  v_movement_id      text;
  v_product_name     text;
begin
  -- Auth check: el usuario autenticado debe pertenecer al negocio
  if auth.uid() is not null then
    if not exists (
      select 1 from unnest(public.auth_business_ids()) AS bid
      WHERE bid = p_business_id
    ) then
      raise exception 'NOT_A_MEMBER: no perteneces a este negocio.';
    end if;
  end if;

  -- 1. Re-leer la venta con FOR UPDATE (row locking)
  select data into v_sale
  from public.sales
  where business_id = p_business_id
    and branch_id = p_branch_id
    and data->>'id' = p_sale_id
  for update;

  if v_sale is null then
    raise exception 'SALE_NOT_FOUND';
  end if;

  -- 2. Idempotency: if already cancelled, return without doing anything
  if (v_sale->>'status')::text = 'CANCELLED' then
    return query select false, null::text, true;
    return;
  end if;

  -- No se puede cancelar una venta REFUNDED o CLOSED
  -- (PARTIALLY_REFUNDED IS ALLOWED — canceling restores remaining items)
  if (v_sale->>'status')::text in ('REFUNDED', 'CLOSED') then
    raise exception 'SALE_CANNOT_BE_CANCELLED: la venta ya fue reembolsada o cerrada';
  end if;

  -- 3. Optimistic lock
  if (v_sale->>'version')::integer <> p_sale_version then
    raise exception 'OPTIMISTIC_LOCK_ERROR';
  end if;

  -- 4. VALIDACIÓN DE ITEMS: cada producto debe pertenecer a la venta
  --    y la cantidad cancelada no debe exceder lo disponible (original - refunded)
  for v_item in select jsonb_array_elements(p_cancel_items)
  loop
    v_product_id := v_item->>'productId';
    v_quantity := (v_item->>'quantity')::numeric;

    if v_quantity <= 0 then
      raise exception 'INVALID_CANCEL_QUANTITY: la cantidad debe ser mayor a 0 para %', v_product_id;
    end if;

    -- Buscar el producto en los items de la venta
    v_unit_price := null;
    v_original_qty := 0;
    for v_sale_item in select jsonb_array_elements(v_sale->'items')
    loop
      if v_sale_item->>'productId' = v_product_id then
        v_unit_price := (v_sale_item->>'price')::numeric;
        v_original_qty := (v_sale_item->>'quantity')::numeric;
        exit;
      end if;
    end loop;

    if v_unit_price is null then
      raise exception 'CANCEL_ITEM_NOT_IN_SALE: el producto % no pertenece a esta venta.', v_product_id;
    end if;

    -- Calcular cuánto se ha reembolsado ya de este producto
    v_refunded_qty := 0;
    for v_refund_entry in select jsonb_array_elements(coalesce(v_sale->'refunds', '[]'::jsonb))
    loop
      for v_recipe_item in select jsonb_array_elements(v_refund_entry->'items')
      loop
        if v_recipe_item->>'productId' = v_product_id then
          v_refunded_qty := v_refunded_qty + (v_recipe_item->>'quantity')::numeric;
        end if;
      end loop;
    end loop;

    -- La cantidad a cancelar no debe exceder lo disponible (original - refunded)
    if v_quantity > (v_original_qty - v_refunded_qty) then
      raise exception 'CANCEL_EXCEEDS_AVAILABLE: solo quedan % unidad(es) cancelables de % (de % originales, % ya reembolsadas)',
        (v_original_qty - v_refunded_qty), v_product_id, v_original_qty, v_refunded_qty;
    end if;
  end loop;

  -- 5. VALIDACIÓN DE MONTO: recalcular el monto restante desde la venta
  --    y los refunds existentes. El monto recibido no debe excedir el restante.
  v_refunded_total := 0;
  for v_refund_entry in select jsonb_array_elements(coalesce(v_sale->'refunds', '[]'::jsonb))
  loop
    v_refunded_total := v_refunded_total + (v_refund_entry->>'amount')::numeric;
  end loop;
  v_expected_remaining := (v_sale->>'total')::numeric - v_refunded_total;

  if p_was_paid and p_amount > v_expected_remaining then
    raise exception 'CANCEL_AMOUNT_EXCEEDS_REMAINING: el monto solicitado (%) excede el importe restante (%)',
      p_amount, v_expected_remaining;
  end if;

  -- 6. Si fue pagada, registrar egreso de caja (deterministic ID)
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

  -- 7. Restaurar inventario (recipe-aware) — MISMO LÓGICA QUE ANTES
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

  -- 8. Marcar como CANCELLED
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
-- ============================================================================
-- FIN DE HARDENING FASE 4D
-- ============================================================================;
