-- ============================================================================
-- VIMDY — FASE 7.1: Sistema definitivo de suscripciones (migración v2)
-- ============================================================================
-- Esta migración implementa:
--   1. Auditoría completa de suscripciones
--   2. Protección contra trial duplicado
--   3. Cálculo server-side de 12+2 meses para plan anual
--   4. Idempotencia en activación/renovación/reembolso
--   5. Estado efectivo cacheado para consultas rápidas
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Tabla de auditoría de suscripciones
-- ----------------------------------------------------------------------------
create table if not exists subscription_audit_log (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  action text not null, -- 'TRIAL_STARTED' | 'TRIAL_EXPIRED' | 'SUBSCRIPTION_ACTIVATED' | 'SUBSCRIPTION_RENEWED' | 'SUBSCRIPTION_EXPIRED' | 'SUBSCRIPTION_REFUNDED' | 'SUBSCRIPTION_CANCELLED' | 'PAYMENT_APPROVED' | 'PAYMENT_DECLINED' | 'PAYMENT_REFUNDED' | 'PAYMENT_PENDING' | 'PAYMENT_VOIDED'
  actor_type text not null default 'system', -- 'system' | 'admin' | 'webhook' | 'payment_provider' | 'cron'
  actor_id uuid, -- user_id si es admin, null en otros casos
  details jsonb not null default '{}'::jsonb,
  ip_address inet,
  created_at timestamptz not null default now()
);

create index if not exists subscription_audit_log_business_id_idx
  on subscription_audit_log (business_id);
create index if not exists subscription_audit_log_action_idx
  on subscription_audit_log (action);
create index if not exists subscription_audit_log_created_at_idx
  on subscription_audit_log (created_at);

alter table subscription_audit_log enable row level security;

drop policy if exists subscription_audit_log_tenant_isolation on subscription_audit_log;
create policy subscription_audit_log_tenant_isolation on subscription_audit_log
  for select
  using (business_id in (select auth_business_ids()));

drop policy if exists subscription_audit_log_service_insert on subscription_audit_log;
create policy subscription_audit_log_service_insert on subscription_audit_log
  for insert
  with check (false);

grant all on subscription_audit_log to service_role;
grant select on subscription_audit_log to authenticated;

-- ----------------------------------------------------------------------------
-- 2. Columnas nuevas en businesses
-- ----------------------------------------------------------------------------
-- trial_used_at: cuándo se usó el trial. NULL = nunca lo tuvo.
alter table businesses add column if not exists trial_used_at timestamptz;

-- subscription_status: estado efectivo cacheado para consultas rápidas.
-- Se calcula en triggers/funciones, no se confía en el frontend.
alter table businesses add column if not exists subscription_status text not null default 'trial';

-- ----------------------------------------------------------------------------
-- 3. Columnas nuevas en subscription_payments
-- ----------------------------------------------------------------------------
-- idempotency_key: clave única para evitar dobles pagos desde el frontend.
alter table subscription_payments add column if not exists idempotency_key text;

-- renewal_number: 0 = primera activación, 1 = primera renovación, etc.
alter table subscription_payments add column if not exists renewal_number integer not null default 0;

-- provider_refund_id: ID del reembolso en el proveedor (Wompi/PayPal/MP).
alter table subscription_payments add column if not exists provider_refund_id text;

-- refunded_at: cuándo se reembolsó.
alter table subscription_payments add column if not exists refunded_at timestamptz;

-- paypal_capture_id: ID de la captura de PayPal (para reembolsos).
alter table subscription_payments add column if not exists paypal_capture_id text;

-- ----------------------------------------------------------------------------
-- 4. Constraints únicos
-- ----------------------------------------------------------------------------
-- Un negocio no puede tener dos pagos con la misma idempotency_key.
create unique index if not exists subscription_payments_idempotency_key_unique
  on subscription_payments (business_id, idempotency_key)
  where idempotency_key is not null;

-- Un negocio no puede tener dos pagos con la misma referencia de Wompi.
create unique index if not exists subscription_payments_wompi_reference_unique
  on subscription_payments (business_id, wompi_reference)
  where wompi_reference is not null;

-- Un negocio no puede tener dos pagos con la misma referencia de MercadoPago.
create unique index if not exists subscription_payments_mercadopago_reference_unique
  on subscription_payments (business_id, mercadopago_reference)
  where mercadopago_reference is not null;

-- Un negocio no puede tener dos pagos con el mismo order_id de PayPal.
create unique index if not exists subscription_payments_paypal_order_id_unique
  on subscription_payments (business_id, paypal_order_id)
  where paypal_order_id is not null;

-- ----------------------------------------------------------------------------
-- 5. Función: verificar si un negocio puede empezar trial
-- ----------------------------------------------------------------------------
create or replace function public.can_start_trial(p_business_id uuid)
returns boolean
language plpgsql
security definer
as $$
begin
  return not exists (
    select 1 from businesses
    where id = p_business_id
      and trial_used_at is not null
  );
end;
$$;

revoke all on function public.can_start_trial(uuid) from public, anon;
grant execute on function public.can_start_trial(uuid) to service_role, authenticated;

-- ----------------------------------------------------------------------------
-- 6. Función: marcar trial como usado
-- ----------------------------------------------------------------------------
create or replace function public.mark_trial_used(p_business_id uuid)
returns void
language plpgsql
security definer
as $$
begin
  update businesses
  set trial_used_at = now()
  where id = p_business_id
    and trial_used_at is null;
end;
$$;

revoke all on function public.mark_trial_used(uuid) from public, anon;
grant execute on function public.mark_trial_used(uuid) to service_role, authenticated;

-- ----------------------------------------------------------------------------
-- 7. Función: calcular días de acceso para plan anual (12 pagados + 2 gratis)
-- ----------------------------------------------------------------------------
create or replace function public.get_plan_period_days(p_plan text)
returns integer
language plpgsql
immutable
as $$
begin
  if p_plan = 'monthly' then
    return 30;
  elsif p_plan = 'yearly' then
    return 30 * 14; -- 12 meses pagados + 2 meses gratis = 14 meses
  else
    raise exception 'Plan inválido: %', p_plan;
  end if;
end;
$$;

revoke all on function public.get_plan_period_days(text) from public, anon;
grant execute on function public.get_plan_period_days(text) to service_role, authenticated;

-- ----------------------------------------------------------------------------
-- 8. Función: activar suscripción (server-side, idempotente)
-- ----------------------------------------------------------------------------
-- Esta es la ÚNICA función autorizada para activar/renovar planes.
-- Nadie (ni el frontend ni las Edge Functions) debe actualizar businesses
-- directamente para cambiar plan/renewal_date/next_charge_at/payment_status.
-- Todos deben llamar a esta función.
create or replace function public.activate_subscription_server_side(
  p_business_id uuid,
  p_plan text, -- 'monthly' | 'yearly'
  p_payment_id uuid,
  p_now timestamptz default now()
)
returns jsonb
language plpgsql
security definer
as $$
declare
  v_payment record;
  v_period_days integer;
  v_renewal_date timestamptz;
  v_next_charge_at timestamptz;
  v_result jsonb;
  v_audit_id uuid;
begin
  -- 1) Validar plan
  if p_plan not in ('monthly', 'yearly') then
    raise exception 'Plan inválido: %', p_plan;
  end if;

  -- 1.1) Validar que el llamante pertenece al negocio (service_role bypassea)
  if auth.uid() is not null then
    if not exists (
      select 1 from unnest(public.auth_business_ids()) as bid where bid = p_business_id
    ) then
      raise exception 'NOT_A_MEMBER: no perteneces a este negocio.';
    end if;
  end if;

  -- 2) Buscar el pago
  select * into v_payment
  from subscription_payments
  where id = p_payment_id
    and business_id = p_business_id;

  if not found then
    raise exception 'Pago no encontrado: %', p_payment_id;
  end if;

  -- 3) Idempotencia: si ya está approved y ya tiene renewal_number >= 0,
  --    no volver a activar/renovar.
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

  -- 4) Calcular período usando la fecha ORIGINAL del pago si existe,
  --    no la fecha actual del webhook. Esto evita que un webhook retrasado
  --    otorgue días extra gratuitos al usuario.
  v_period_days := public.get_plan_period_days(p_plan);
  if v_payment.paid_at is not null then
    v_renewal_date := (v_payment.paid_at + (v_period_days || ' days')::interval);
  else
    v_renewal_date := (p_now + (v_period_days || ' days')::interval);
  end if;
  v_next_charge_at := v_renewal_date;

  -- 4.1) Blindaje anti-doble-activación: si el negocio ya tiene un
  --    renewal_date posterior al que calculamos para ESTE pago, significa
  --    que ya fue activado/renovado por un pago más reciente. Este pago
  --    es obsoleto (webhook retrasado, duplicado, etc.) y NO debe volver
  --    a extender la suscripción.
  if exists (
    select 1 from businesses
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

  -- 5) Actualizar negocio
  update businesses
  set
    plan = p_plan,
    renewal_date = v_renewal_date,
    next_charge_at = v_next_charge_at,
    payment_status = 'approved',
    subscription_status = p_plan
  where id = p_business_id;

  -- 6) Actualizar pago
  update subscription_payments
  set
    status = 'approved',
    paid_at = p_now,
    renewal_number = coalesce(renewal_number, 0) + 1
  where id = p_payment_id;

  -- 7) Si es la primera activación (renewal_number = 1), marcar trial como usado
  if v_payment.renewal_number is null or v_payment.renewal_number = 0 then
    perform public.mark_trial_used(p_business_id);
  end if;

  -- 8) Auditoría
  insert into subscription_audit_log (business_id, action, actor_type, details)
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

  -- 9) Respuesta
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
-- 9. Función: renovar suscripción (server-side, idempotente)
-- ----------------------------------------------------------------------------
create or replace function public.renew_subscription_server_side(
  p_business_id uuid,
  p_plan text, -- 'monthly' | 'yearly'
  p_payment_id uuid,
  p_now timestamptz default now()
)
returns jsonb
language plpgsql
security definer
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

  -- 1.1) Validar que el llamante pertenece al negocio (service_role bypassea)
  if auth.uid() is not null then
    if not exists (
      select 1 from unnest(public.auth_business_ids()) as bid where bid = p_business_id
    ) then
      raise exception 'NOT_A_MEMBER: no perteneces a este negocio.';
    end if;
  end if;

  -- 1.2) No renovar suscripciones canceladas
  if exists (
    select 1 from businesses
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
  from subscription_payments
  where id = p_payment_id
    and business_id = p_business_id;

  if not found then
    raise exception 'Pago no encontrado: %', p_payment_id;
  end if;

  -- Idempotencia
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
    select 1 from businesses
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

  update businesses
  set
    plan = p_plan,
    renewal_date = v_renewal_date,
    next_charge_at = v_next_charge_at,
    payment_status = 'approved',
    subscription_status = p_plan
  where id = p_business_id;

  update subscription_payments
  set
    status = 'approved',
    paid_at = p_now,
    renewal_number = coalesce(renewal_number, 0) + 1
  where id = p_payment_id;

  insert into subscription_audit_log (business_id, action, actor_type, details)
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
-- 10. Función: marcar suscripción como vencida
-- ----------------------------------------------------------------------------
create or replace function public.expire_subscription_server_side(
  p_business_id uuid,
  p_now timestamptz default now()
)
returns jsonb
language plpgsql
security definer
as $$
declare
  v_audit_id uuid;
  v_business record;
begin
  select * into v_business from businesses where id = p_business_id;

  if not found then
    raise exception 'Negocio no encontrado: %', p_business_id;
  end if;

  if auth.uid() is not null then
    if not exists (
      select 1 from unnest(public.auth_business_ids()) as bid where bid = p_business_id
    ) then
      raise exception 'NOT_A_MEMBER: no perteneces a este negocio.';
    end if;
  end if;

  update businesses
  set
    payment_status = 'past_due',
    subscription_status = 'suspended'
  where id = p_business_id
    and subscription_status <> 'suspended';

  if not found then
    return jsonb_build_object('ok', true, 'already_expired', true);
  end if;

  insert into subscription_audit_log (business_id, action, actor_type, details)
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
-- 11. Función: cancelar suscripción (server-side, idempotente)
-- ----------------------------------------------------------------------------
-- Marca el negocio como cancelado sin eliminar datos ni reembolsar.
-- El usuario conserva acceso hasta su renewal_date actual. A partir de ahí,
-- ni webhooks ni cron volverán a renovar.
create or replace function public.cancel_subscription_server_side(
  p_business_id uuid,
  p_now timestamptz default now()
)
returns jsonb
language plpgsql
security definer
as $$
declare
  v_business record;
  v_audit_id uuid;
begin
  select * into v_business
  from businesses
  where id = p_business_id;

  if not found then
    raise exception 'Negocio no encontrado: %', p_business_id;
  end if;

  if auth.uid() is not null then
    if not exists (
      select 1 from unnest(public.auth_business_ids()) as bid where bid = p_business_id
    ) then
      raise exception 'NOT_A_MEMBER: no perteneces a este negocio.';
    end if;
  end if;

  if v_business.subscription_status = 'cancelled' then
    return jsonb_build_object('ok', true, 'already_cancelled', true);
  end if;

  update businesses
  set
    subscription_status = 'cancelled',
    payment_status = case
      when payment_status = 'approved' then 'past_due'
      else payment_status
    end,
    next_charge_at = null
  where id = p_business_id;

  insert into subscription_audit_log (business_id, action, actor_type, details)
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
-- 12. Función: reembolsar pago de suscripción
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
as $$
declare
  v_payment record;
  v_business_id uuid;
  v_new_status text;
  v_audit_id uuid;
begin
  select * into v_payment
  from subscription_payments
  where id = p_payment_id;

  if not found then
    raise exception 'Pago no encontrado: %', p_payment_id;
  end if;

  if v_payment.status <> 'approved' then
    raise exception 'Solo se puede reembolsar pagos aprobados. Status actual: %', v_payment.status;
  end if;

  if p_refund_amount > v_payment.amount then
    raise exception 'El monto de reembolso (%, %) excede el pago original (%, %)',
      p_refund_amount, v_payment.currency, v_payment.amount, v_payment.currency;
  end if;

  v_business_id := v_payment.business_id;

  -- 1.1) Validar que el llamante pertenece al negocio del pago (service_role bypassea)
  if auth.uid() is not null then
    if not exists (
      select 1 from unnest(public.auth_business_ids()) as bid where bid = v_business_id
    ) then
      raise exception 'NOT_A_MEMBER: no perteneces a este negocio.';
    end if;
  end if;

  -- Si es reembolso total, marcar negocio como declinado
  if p_refund_amount >= v_payment.amount then
    v_new_status := 'declined';

    update businesses
      set payment_status = 'declined'
      where id = v_business_id;
  else
    v_new_status := 'approved'; -- parcial: sigue activo
  end if;

  update subscription_payments
  set
    status = 'refunded',
    refunded_at = p_now,
    provider_refund_id = p_provider_refund_id
  where id = p_payment_id;

  insert into subscription_audit_log (business_id, action, actor_type, details)
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
-- 12. Trigger: mantener subscription_status sincronizado
-- ----------------------------------------------------------------------------
create or replace function public.sync_subscription_status()
returns trigger
language plpgsql
as $$
declare
  v_days_remaining integer;
  v_new_status text;
begin
  if NEW.plan = 'trial' then
    if NEW.trial_ends_at is not null then
      v_days_remaining := ceil(extract(epoch from (NEW.trial_ends_at - now())) / 86400);
      if v_days_remaining > 0 then
        v_new_status := 'trial';
      else
        v_new_status := 'suspended';
      end if;
    else
      v_new_status := 'suspended';
    end if;
  elsif NEW.payment_status in ('approved') then
    v_new_status := NEW.plan;
  elsif NEW.payment_status in ('declined', 'past_due') then
    v_new_status := 'suspended';
  else
    v_new_status := NEW.plan;
  end if;

  NEW.subscription_status := v_new_status;
  return NEW;
end;
$$;

drop trigger if exists sync_subscription_status_trigger on businesses;
create trigger sync_subscription_status_trigger
  before insert or update of plan, trial_ends_at, payment_status on businesses
  for each row
  execute function public.sync_subscription_status();

-- ============================================================================
-- FIN DE MIGRACIÓN
-- ============================================================================
