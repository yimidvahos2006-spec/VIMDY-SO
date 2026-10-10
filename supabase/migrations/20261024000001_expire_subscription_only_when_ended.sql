-- ============================================================================
-- VIMDY OS - expire_subscription_server_side: no suspender una suscripción vigente
-- ============================================================================
-- PROBLEMA: los webhooks de Wompi, Mercado Pago y PayPal (y payments-reconcile)
-- llaman a expire_subscription_server_side cuando un intento de pago es
-- rechazado. La función suspendía el negocio SIEMPRE, aunque su prueba gratis de
-- 14 días o su suscripción pagada siguieran vigentes. Un intento de pago fallido
-- dentro de la prueba dejaba al negocio suspendido.
--
-- CORRECCIÓN: la función ahora solo suspende si el acceso realmente terminó
-- (misma regla que is_business_subscription_active). Si sigue vigente, no hace
-- nada y devuelve skipped = true. Arregla los 4 llamadores sin tocarlos.
-- ============================================================================

BEGIN;

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

  -- Acceso todavía vigente: un pago rechazado NO debe suspender el negocio.
  if (
    (v_business.plan = 'trial'
      and v_business.trial_ends_at is not null
      and v_business.trial_ends_at > p_now)
    or
    (v_business.plan in ('monthly', 'yearly')
      and (v_business.renewal_date is null or v_business.renewal_date > p_now))
  ) then
    return jsonb_build_object('ok', true, 'skipped', true, 'reason', 'SUBSCRIPTION_STILL_ACTIVE');
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

COMMIT;