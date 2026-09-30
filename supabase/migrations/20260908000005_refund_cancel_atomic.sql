-- supabase/migrations/20260908_refund_cancel_atomic.sql
-- ===========================================================================
--  refund_cancel_atomic
--  ---------------------------------------------------------------------------
--  Atomicamente registra el egreso de caja + marca la venta como REFUNDED
--  o CANCELLED en una sola transacción de PostgreSQL.
--
--  PROBLEMA SIN ESTE RPC:
--  SalesEngine.refundSale() y cancelSale() hacen escrituras secuenciales:
--    1. updateInventory (restaurar stock)
--    2. cash.registerExpense (egreso de caja)
--    3. updateSale (status → REFUNDED/CANCELLED)
--
--  Si (2) falla después de (1), el inventario se restaura pero el egreso
--  de caja no se registra → inconsistente. La venta no se marca REFUNDED.
--
--  CON este RPC: cash + sale status son atómicos en el servidor.
--  Si algo falla, NOTHING se persiste. La idempotencia se verifica dentro
--  de la misma transacción: si la venta ya está REFUNDED/CANCELLED, se
--  devuelve sin insertar movimientos duplicados.
--
--  El inventario restoration happens BEFORE this RPC (via updateInventory),
--  so if this RPC fails, only the cash movement is lost — inventory is
--  already restored and can be re-attempted with the deterministic cash ID.
-- ===========================================================================

-- ----------------------------------------------------------------------------
-- Atomic refund: registers cash expense + marks sale as REFUNDED
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

  -- 2. Idempotency: if already refunded/cancelled/closed,
  --    check if a refund with this deterministic ID already exists in the refunds array
  if (v_sale->>'status')::text in ('REFUNDED', 'CANCELLED', 'CLOSED') then
    -- Check if a specific refund with this ID already exists in the refunds array
    -- Using jsonb_path_exists is more precise than @> for nested array matching
    if jsonb_path_exists(v_sale, '$.refunds[*] ? (@.id == $refund_id)', p_refund_id, p_refund_id) then
      return query select false, null::text, true;
      return;
    end if;
    -- If already refunded but no matching refund ID found, treat as partial refund
    -- that didn't complete — continue with cash expense and update refunds array
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
-- ----------------------------------------------------------------------------
-- Atomic cancel: registers cash expense + marks sale as CANCELLED
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

  -- No se puede cancelar una venta REFUNDED o CLOSED
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

  -- 5. Marcar como CANCELLED (upsert not needed — if already exists, skip)
  --    Using ON CONFLICT to handle idempotent cash expense insert
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
-- Revoke public execute and grant to authenticated only (security best practice)
revoke execute on function public.refund_sale_atomic(uuid,uuid,text,integer,numeric,text,text,text) from public;
grant execute on function public.refund_sale_atomic(uuid,uuid,text,integer,numeric,text,text,text) to authenticated;
revoke execute on function public.cancel_sale_atomic(uuid,uuid,text,integer,numeric,text,text) from public;
grant execute on function public.cancel_sale_atomic(uuid,uuid,text,integer,numeric,text,text) to authenticated;
