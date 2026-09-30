-- supabase/migrations/20260908_complete_payment_atomic.sql
-- ===========================================================================
--  complete_payment_atomic
--  ---------------------------------------------------------------------------
--  Atomicamente marca una venta como PAID y registra los movimientos de caja
--  (ingreso + cambio) en una sola transacción de base de datos.
--
--  ANTES de este RPC: SalesEngine.registerPayment hacía 3 escrituras
--  independientes desde el cliente:
--    1. cash.registerExpense  (cambio)
--    2. cash.registerIncome   (ingreso)
--    3. saleRepository.update (status → PAID)
--
--  Si (3) fallaba después de que (1) y (2) habían tenido éxito, la caja
--  registraba el ingreso pero la venta no quedaba PAID → inconsistente.
--  El cliente nunca podía corregir esto sin un reintento manual.
--
--  CON este RPC: todo es una sola transacción. Si algo falla,
--  NOTHING se persiste. La idempotencia se verifica dentro del mismo
--  ámbito transaccional: si la venta ya está PAID, se devuelve sin
--  insertar movimientos duplicados.
-- ===========================================================================

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
as $$
declare
  v_sale jsonb;
  v_income_id text;
  v_change_id text;
begin
  -- 1. Re-leer la venta con su versión actual (optimistic lock)
  select data into v_sale
  from sales
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
  update sales
  set data = jsonb_set(v_sale, '{status}', '"PAID"', false)
             || jsonb_set(v_sale, '{paymentMethod}', to_jsonb(p_payment_method), false),
    version = version + 1,
    updated_at = now()
  where business_id = p_business_id
    and branch_id = p_branch_id
    and data->>'id' = p_sale_id
    and version = p_sale_version;  -- doble chequeo optimista

  -- 5. Insertar movimiento de ingreso en caja
  insert into cash_movements (business_id, branch_id, data)
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
    insert into cash_movements (business_id, branch_id, data)
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
grant execute on function public.complete_payment_atomic to authenticated;
