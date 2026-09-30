-- ============================================================================
-- VIMDY OS — SECURITY HARDENING — Subscription RPC Authorization & Refund Guards
-- ----------------------------------------------------------------------------
-- Addresses audit findings from 20260914:
--
--   1. Dead RPC `register_sale_payment_movements` still GRANTed to authenticated.
--      REVOKE to prevent authenticated users from calling it directly.
--      (It is not invoked from the VIMDY client; all payment registration goes
--       through `complete_payment_atomic`.)
--
--   2. Subscription management RPCs (activate / renew / expire / cancel) only
--      verified business membership, not ADMIN role. Any authenticated member
--      could activate, renew, or expire subscriptions. Now they require the
--      ADMIN role via `public.has_business_role(p_business_id, array['ADMIN'])`.
--
--   3. `refund_subscription_payment_server_side` had no negative-amount guard.
--      A caller could pass a negative refund_amount, which would invert logic
--      (e.g. `p_refund_amount >= v_payment.amount` becomes true for -1 on a 0
--      amount payment, falsely marking business as declined). Add explicit guard.
--
--   4. Simplified `refund_sale_atomic` and `cancel_sale_atomic` (called from
--      SaleRepository.ts:189,232) had NO auth check — only the *_full_atomic
--      versions had it. Now both verify business membership via auth_business_ids().
--      Also add negative-amount guards to both.
--
--   Architecture note:
--   The long-term plan is to REVOKE these subscription RPCs from authenticated
--   entirely and route all browser calls through an Edge Function wrapper that
--   uses SUPABASE_SERVICE_ROLE_KEY. Until those wrappers are deployed, the ADMIN
--   role check inside each function provides the necessary defense-in-depth.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. REVOKE dead RPC register_sale_payment_movements from authenticated
-- ----------------------------------------------------------------------------
-- This RPC is not called from any client code. All sale-payment registration
-- now flows through `complete_payment_atomic`. Revokeing prevents any
-- authenticated user from invoking it directly.
revoke all on function public.register_sale_payment_movements(
  uuid, uuid, text, numeric, text, numeric, numeric
) from authenticated;
grant execute on function public.register_sale_payment_movements(
  uuid, uuid, text, numeric, text, numeric, numeric
) to service_role;
-- ----------------------------------------------------------------------------
-- 2. activate_subscription_server_side — require ADMIN role
-- ----------------------------------------------------------------------------
create or replace function public.activate_subscription_server_side(
  p_business_id uuid,
  p_plan text,
  p_payment_id uuid,
  p_now timestamptz default now()
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_payment record;
  v_period_days integer;
  v_renewal_date timestamptz;
  v_next_charge_at timestamptz;
  v_result jsonb;
  v_audit_id uuid;
begin
  if p_plan not in ('monthly', 'yearly') then
    raise exception 'Plan inválido: %', p_plan;
  end if;

  if auth.uid() is not null then
    if not public.has_business_role(p_business_id, array['ADMIN']) then
      raise exception 'FORBIDDEN: solo un administrador puede activar suscripciones.';
    end if;
  end if;

  select * into v_payment
  from public.subscription_payments
  where id = p_payment_id
    and business_id = p_business_id;

  if not found then
    raise exception 'Pago no encontrado: %', p_payment_id;
  end if;

  if v_payment.status = 'approved' then
    return jsonb_build_object(
      'ok', true,
      'already_activated', true,
      'renewal_number', v_payment.renewal_number
    );
  end if;

  if v_payment.status = 'declined' then
    raise exception 'El pago % ya fue declinado. No se puede activar.', p_payment_id;
  end if;

  v_period_days := public.get_plan_period_days(p_plan);
  if v_payment.paid_at is not null then
    v_renewal_date := (v_payment.paid_at + (v_period_days || ' days')::interval);
  else
    v_renewal_date := (p_now + (v_period_days || ' days')::interval);
  end if;
  v_next_charge_at := v_renewal_date;

  if exists (
    select 1 from public.businesses
    where id = p_business_id
      and renewal_date > v_renewal_date
  ) then
    return jsonb_build_object(
      'ok', true,
      'already_activated', true,
      'renewal_number', v_payment.renewal_number,
      'reason', 'obsolete_payment'
    );
  end if;

  update public.businesses
  set
    plan = p_plan,
    renewal_date = v_renewal_date,
    next_charge_at = v_next_charge_at,
    payment_status = 'approved',
    subscription_status = p_plan
  where id = p_business_id;

  update public.subscription_payments
  set
    status = 'approved',
    paid_at = p_now,
    renewal_number = coalesce(renewal_number, 0) + 1
  where id = p_payment_id;

  if v_payment.renewal_number is null or v_payment.renewal_number = 0 then
    perform public.mark_trial_used(p_business_id);
  end if;

  insert into public.subscription_audit_log (business_id, action, actor_type, details)
  values (
    p_business_id,
    'SUBSCRIPTION_ACTIVATED',
    'payment_provider',
    jsonb_build_object(
      'plan', p_plan,
      'payment_id', p_payment_id,
      'renewal_number', coalesce(v_payment.renewal_number, 0) + 1,
      'renewal_date', to_char(v_renewal_date, 'YYYY-MM-DD HH24:MI:SS')
    )
  )
  returning id into v_audit_id;

  v_result := jsonb_build_object(
    'ok', true,
    'already_activated', false,
    'renewal_number', coalesce(v_payment.renewal_number, 0) + 1,
    'renewal_date', to_char(v_renewal_date, 'YYYY-MM-DD HH24:MI:SS'),
    'audit_id', v_audit_id
  );

  return v_result;
end;
$$;
revoke all on function public.activate_subscription_server_side(uuid, text, uuid, timestamptz) from public, anon;
grant execute on function public.activate_subscription_server_side(uuid, text, uuid, timestamptz) to service_role, authenticated;
-- ----------------------------------------------------------------------------
-- 3. renew_subscription_server_side — require ADMIN role
-- ----------------------------------------------------------------------------
create or replace function public.renew_subscription_server_side(
  p_business_id uuid,
  p_plan text,
  p_payment_id uuid,
  p_now timestamptz default now()
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_payment record;
  v_period_days integer;
  v_renewal_date timestamptz;
  v_next_charge_at timestamptz;
  v_audit_id uuid;
begin
  if p_plan not in ('monthly', 'yearly') then
    raise exception 'Plan inválido: %', p_plan;
  end if;

  if auth.uid() is not null then
    if not public.has_business_role(p_business_id, array['ADMIN']) then
      raise exception 'FORBIDDEN: solo un administrador puede renovar suscripciones.';
    end if;
  end if;

  if exists (
    select 1 from public.businesses
    where id = p_business_id
      and subscription_status = 'cancelled'
  ) then
    return jsonb_build_object(
      'ok', true,
      'already_renewed', false,
      'reason', 'subscription_cancelled'
    );
  end if;

  select * into v_payment
  from public.subscription_payments
  where id = p_payment_id
    and business_id = p_business_id;

  if not found then
    raise exception 'Pago no encontrado: %', p_payment_id;
  end if;

  if v_payment.status = 'approved' then
    return jsonb_build_object(
      'ok', true,
      'already_renewed', true,
      'renewal_number', v_payment.renewal_number
    );
  end if;

  if v_payment.status = 'declined' then
    raise exception 'El pago % ya fue declinado. No se puede renovar.', p_payment_id;
  end if;

  v_period_days := public.get_plan_period_days(p_plan);
  if v_payment.paid_at is not null then
    v_renewal_date := (v_payment.paid_at + (v_period_days || ' days')::interval);
  else
    v_renewal_date := (p_now + (v_period_days || ' days')::interval);
  end if;
  v_next_charge_at := v_renewal_date;

  if exists (
    select 1 from public.businesses
    where id = p_business_id
      and renewal_date > v_renewal_date
  ) then
    return jsonb_build_object(
      'ok', true,
      'already_renewed', true,
      'renewal_number', v_payment.renewal_number,
      'reason', 'obsolete_payment'
    );
  end if;

  update public.businesses
  set
    plan = p_plan,
    renewal_date = v_renewal_date,
    next_charge_at = v_next_charge_at,
    payment_status = 'approved',
    subscription_status = p_plan
  where id = p_business_id;

  update public.subscription_payments
  set
    status = 'approved',
    paid_at = p_now,
    renewal_number = coalesce(renewal_number, 0) + 1
  where id = p_payment_id;

  insert into public.subscription_audit_log (business_id, action, actor_type, details)
  values (
    p_business_id,
    'SUBSCRIPTION_RENEWED',
    'payment_provider',
    jsonb_build_object(
      'plan', p_plan,
      'payment_id', p_payment_id,
      'renewal_number', coalesce(v_payment.renewal_number, 0) + 1,
      'renewal_date', to_char(v_renewal_date, 'YYYY-MM-DD HH24:MI:SS')
    )
  )
  returning id into v_audit_id;

  return jsonb_build_object(
    'ok', true,
    'already_renewed', false,
    'renewal_number', coalesce(v_payment.renewal_number, 0) + 1,
    'renewal_date', to_char(v_renewal_date, 'YYYY-MM-DD HH24:MI:SS'),
    'audit_id', v_audit_id
  );
end;
$$;
revoke all on function public.renew_subscription_server_side(uuid, text, uuid, timestamptz) from public, anon;
grant execute on function public.renew_subscription_server_side(uuid, text, uuid, timestamptz) to service_role, authenticated;
-- ----------------------------------------------------------------------------
-- 4. expire_subscription_server_side — require ADMIN role
-- ----------------------------------------------------------------------------
create or replace function public.expire_subscription_server_side(
  p_business_id uuid,
  p_now timestamptz default now()
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_audit_id uuid;
  v_business record;
begin
  select * into v_business from public.businesses where id = p_business_id;

  if not found then
    raise exception 'Negocio no encontrado: %', p_business_id;
  end if;

  if auth.uid() is not null then
    if not public.has_business_role(p_business_id, array['ADMIN']) then
      raise exception 'FORBIDDEN: solo un administrador puede expirar suscripciones.';
    end if;
  end if;

  update public.businesses
  set
    payment_status = 'past_due',
    subscription_status = 'suspended'
  where id = p_business_id
    and subscription_status <> 'suspended';

  if not found then
    return jsonb_build_object('ok', true, 'already_expired', true);
  end if;

  insert into public.subscription_audit_log (business_id, action, actor_type, details)
  values (
    p_business_id,
    'SUBSCRIPTION_EXPIRED',
    'cron',
    jsonb_build_object('expired_at', to_char(p_now, 'YYYY-MM-DD HH24:MI:SS'))
  )
  returning id into v_audit_id;

  return jsonb_build_object('ok', true, 'already_expired', false, 'audit_id', v_audit_id);
end;
$$;
revoke all on function public.expire_subscription_server_side(uuid, timestamptz) from public, anon;
grant execute on function public.expire_subscription_server_side(uuid, timestamptz) to service_role, authenticated;
-- ----------------------------------------------------------------------------
-- 5. cancel_subscription_server_side — require ADMIN role
-- ----------------------------------------------------------------------------
create or replace function public.cancel_subscription_server_side(
  p_business_id uuid,
  p_now timestamptz default now()
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_business record;
  v_audit_id uuid;
begin
  select * into v_business
  from public.businesses
  where id = p_business_id;

  if not found then
    raise exception 'Negocio no encontrado: %', p_business_id;
  end if;

  if auth.uid() is not null then
    if not public.has_business_role(p_business_id, array['ADMIN']) then
      raise exception 'FORBIDDEN: solo un administrador puede cancelar suscripciones.';
    end if;
  end if;

  if v_business.subscription_status = 'cancelled' then
    return jsonb_build_object('ok', true, 'already_cancelled', true);
  end if;

  update public.businesses
  set
    subscription_status = 'cancelled',
    payment_status = case
      when payment_status = 'approved' then 'past_due'
      else payment_status
    end,
    next_charge_at = null
  where id = p_business_id;

  insert into public.subscription_audit_log (business_id, action, actor_type, details)
  values (
    p_business_id,
    'SUBSCRIPTION_CANCELLED',
    'user',
    jsonb_build_object('cancelled_at', to_char(p_now, 'YYYY-MM-DD HH24:MI:SS'))
  )
  returning id into v_audit_id;

  return jsonb_build_object('ok', true, 'already_cancelled', false, 'audit_id', v_audit_id);
end;
$$;
revoke all on function public.cancel_subscription_server_side(uuid, timestamptz) from public, anon;
grant execute on function public.cancel_subscription_server_side(uuid, timestamptz) to service_role, authenticated;
-- ----------------------------------------------------------------------------
-- 6. refund_subscription_payment_server_side — add negative amount guard
-- ----------------------------------------------------------------------------
create or replace function public.refund_subscription_payment_server_side(
  p_payment_id uuid,
  p_refund_amount numeric,
  p_provider_refund_id text,
  p_now timestamptz default now()
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_payment record;
  v_business_id uuid;
  v_new_status text;
  v_audit_id uuid;
begin
  select * into v_payment
  from public.subscription_payments
  where id = p_payment_id;

  if not found then
    raise exception 'Pago no encontrado: %', p_payment_id;
  end if;

  if v_payment.status <> 'approved' then
    raise exception 'Solo se puede reembolsar pagos aprobados. Status actual: %', v_payment.status;
  end if;

  -- Guard: negative amounts must be rejected explicitly.
  -- (Without this, a negative p_refund_amount could invert logic such as
  --  p_refund_amount >= v_payment.amount, falsely marking a business as
  --  declined.)
  if p_refund_amount < 0 then
    raise exception 'El monto de reembolso no puede ser negativo: %', p_refund_amount;
  end if;

  if p_refund_amount > v_payment.amount then
    raise exception 'El monto de reembolso (%, %) excede el pago original (%, %)',
      p_refund_amount, v_payment.currency, v_payment.amount, v_payment.currency;
  end if;

  v_business_id := v_payment.business_id;

  -- 1.1) Validar que el llamante pertenece al negocio del pago (service_role bypassea)
  if auth.uid() is not null then
    if not public.has_business_role(v_business_id, array['ADMIN']) then
      raise exception 'FORBIDDEN: solo un administrador puede reembolsar pagos.';
    end if;
  end if;

  -- Si es reembolso total, marcar negocio como declinado
  if p_refund_amount >= v_payment.amount then
    v_new_status := 'declined';

    update public.businesses
      set payment_status = 'declined'
      where id = v_business_id;
  else
    v_new_status := 'approved'; -- parcial: sigue activo
  end if;

  update public.subscription_payments
  set
    status = 'refunded',
    refunded_at = p_now,
    provider_refund_id = p_provider_refund_id
  where id = p_payment_id;

  insert into public.subscription_audit_log (business_id, action, actor_type, details)
  values (
    v_business_id,
    'SUBSCRIPTION_REFUNDED',
    'payment_provider',
    jsonb_build_object(
      'payment_id', p_payment_id,
      'refund_amount', p_refund_amount,
      'original_amount', v_payment.amount,
      'currency', v_payment.currency,
      'provider_refund_id', p_provider_refund_id,
      'is_total_refund', p_refund_amount >= v_payment.amount,
      'new_payment_status', v_new_status
    )
  )
  returning id into v_audit_id;

  return jsonb_build_object(
    'ok', true,
    'is_total_refund', p_refund_amount >= v_payment.amount,
    'new_payment_status', v_new_status,
    'audit_id', v_audit_id
  );
end;
$$;
revoke all on function public.refund_subscription_payment_server_side(uuid, numeric, text, timestamptz) from public, anon;
grant execute on function public.refund_subscription_payment_server_side(uuid, numeric, text, timestamptz) to service_role, authenticated;
-- ----------------------------------------------------------------------------
-- 7. refund_sale_atomic — add auth check + negative amount guard
--    (called from SaleRepository.ts:189 — currently has NO auth verification)
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
  -- Auth check: user must belong to the business
  if auth.uid() is not null then
    if not exists (
      select 1 from unnest(public.auth_business_ids()) AS bid
      WHERE bid = p_business_id
    ) then
      raise exception 'NOT_A_MEMBER: no perteneces a este negocio.';
    end if;
  end if;

  -- Negative amount guard
  if p_amount < 0 then
    raise exception 'INVALID_REFUND_AMOUNT: el monto no puede ser negativo.';
  end if;

  -- 1. Re-leer la venta con su versión actual (optimistic lock)
  select data into v_sale
  from public.sales
  where business_id = p_business_id
    and branch_id = p_branch_id
    and data->>'id' = p_sale_id;

  if v_sale is null then
    raise exception 'SALE_NOT_FOUND';
  end if;

  -- 2. Idempotency
  if (v_sale->>'status')::text in ('REFUNDED', 'CANCELLED', 'CLOSED') then
    if jsonb_path_exists(v_sale, '$.refunds[*] ? (@.id == $refund_id)', p_refund_id, p_refund_id) then
      return query select false, null::text, true;
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

  -- 5. Marcar la venta como REFUNDED
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

  return query select true, v_cash_expense_id, false;
end;
$$;
revoke all on function public.refund_sale_atomic(uuid,uuid,text,integer,numeric,text,text,text) from public, anon;
grant execute on function public.refund_sale_atomic(uuid,uuid,text,integer,numeric,text,text,text) to service_role, authenticated;
-- ----------------------------------------------------------------------------
-- 8. cancel_sale_atomic — add auth check + negative amount guard
--    (called from SaleRepository.ts:232 — currently has NO auth verification)
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
  -- Auth check: user must belong to the business
  if auth.uid() is not null then
    if not exists (
      select 1 from unnest(public.auth_business_ids()) AS bid
      WHERE bid = p_business_id
    ) then
      raise exception 'NOT_A_MEMBER: no perteneces a este negocio.';
    end if;
  end if;

  -- Negative amount guard
  if p_amount < 0 then
    raise exception 'INVALID_CANCEL_AMOUNT: el monto no puede ser negativo.';
  end if;

  -- 1. Re-leer la venta
  select data into v_sale
  from public.sales
  where business_id = p_business_id
    and branch_id = p_branch_id
    and data->>'id' = p_sale_id;

  if v_sale is null then
    raise exception 'SALE_NOT_FOUND';
  end if;

  -- 2. Idempotency
  if (v_sale->>'status')::text = 'CANCELLED' then
    return query select false, null::text, true;
    return;
  end if;

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
revoke all on function public.cancel_sale_atomic(uuid,uuid,text,integer,numeric,text,text) from public, anon;
grant execute on function public.cancel_sale_atomic(uuid,uuid,text,integer,numeric,text,text) to service_role, authenticated;
