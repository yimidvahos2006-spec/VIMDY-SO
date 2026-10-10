-- VIMDY OS — Subscription payment concurrency hardening
--
-- Makes payment activation idempotent even when the same provider event is
-- delivered concurrently. The advisory lock serializes activation for each
-- business while preserving the existing service-role authorization boundary.

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
  v_lock_key bigint;
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

  -- Transaction-level advisory lock: released automatically at commit/rollback.
  -- Serializes all concurrent activation attempts for the same business.
  -- (hashtext() solo acepta 1 argumento; se usa hashtextextended -> bigint.)
  v_lock_key := pg_catalog.hashtextextended('subscription-activation:' || p_business_id::text, 0);
  perform pg_advisory_xact_lock(v_lock_key);

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