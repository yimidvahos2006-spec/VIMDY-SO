-- ============================================================================
-- VIMDY OS — FIX DE SEGURIDAD: Verificación de membresía en RPCs (v2)
-- ----------------------------------------------------------------------------
-- Este archivo corrige vulnerabilidades IDOR donde cualquier usuario
-- autenticado podía manipular datos de otros negocios.
--
-- PROBLEMAS CORREGIDOS:
--   1. can_start_trial: Ahora verifica membresía
--   2. mark_trial_used: Ahora verifica membresía
--   3. save_payment_credentials: Ahora verifica rol ADMIN
--   4. test_payment_credentials: Ahora verifica membresía
--   5. register_sale_payment_movements: Ahora verifica membresía
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. can_start_trial: Verificar que el usuario pertenece al negocio
-- ----------------------------------------------------------------------------
create or replace function public.can_start_trial(p_business_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Si hay un usuario autenticado, verificar que pertenece al negocio
  if auth.uid() is not null then
    if not exists (
      select 1 from business_members
      where business_id = p_business_id
        and user_id = auth.uid()
    ) then
      raise exception 'NOT_A_MEMBER: no perteneces a este negocio.';
    end if;
  end if;

  return not exists (
    select 1 from businesses
    where id = p_business_id
      and trial_used_at is not null
  );
end;
$$;

-- ----------------------------------------------------------------------------
-- 2. mark_trial_used: Verificar que el usuario pertenece al negocio
-- ----------------------------------------------------------------------------
create or replace function public.mark_trial_used(p_business_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Si hay un usuario autenticado, verificar que pertenece al negocio
  if auth.uid() is not null then
    if not exists (
      select 1 from business_members
      where business_id = p_business_id
        and user_id = auth.uid()
    ) then
      raise exception 'NOT_A_MEMBER: no perteneces a este negocio.';
    end if;
  end if;

  update businesses
  set trial_used_at = now()
  where id = p_business_id
    and trial_used_at is null;
end;
$$;

-- ----------------------------------------------------------------------------
-- 3. save_payment_credentials: Verificar que el usuario es ADMIN del negocio
-- ----------------------------------------------------------------------------
create or replace function public.save_payment_credentials(
  p_business_id uuid,
  p_provider text,
  p_public_key text,
  p_private_key text,
  p_integrity_secret text,
  p_events_secret text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  -- Si hay un usuario autenticado, verificar que es ADMIN del negocio
  if auth.uid() is not null then
    if not public.has_business_role(p_business_id, array['ADMIN']) then
      raise exception 'FORBIDDEN: solo un administrador puede guardar credenciales.';
    end if;
  end if;

  update business_payment_credentials
  set
    public_key_encrypted = p_public_key,
    private_key_encrypted = p_private_key,
    integrity_secret_encrypted = p_integrity_secret,
    events_secret_encrypted = p_events_secret,
    is_active = true,
    updated_at = now()
  where business_id = p_business_id and provider = p_provider
  returning id into v_id;

  if v_id is null then
    insert into business_payment_credentials (
      business_id, provider, public_key_encrypted, private_key_encrypted,
      integrity_secret_encrypted, events_secret_encrypted, is_active
    ) values (
      p_business_id, p_provider,
      p_public_key, p_private_key,
      p_integrity_secret, p_events_secret,
      true
    ) returning id into v_id;
  end if;

  return v_id;
end;
$$;

-- ----------------------------------------------------------------------------
-- 4. test_payment_credentials: Verificar que el usuario pertenece al negocio
-- ----------------------------------------------------------------------------
create or replace function public.test_payment_credentials(
  p_business_id uuid,
  p_provider text
)
returns table (
  success boolean,
  error_message text
)
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Si hay un usuario autenticado, verificar que pertenece al negocio
  if auth.uid() is not null then
    if not exists (
      select 1 from business_members
      where business_id = p_business_id
        and user_id = auth.uid()
    ) then
      raise exception 'NOT_A_MEMBER: no perteneces a este negocio.';
    end if;
  end if;

  if not exists (
    select 1 from business_payment_credentials
    where business_id = p_business_id and provider = p_provider and is_active = true
  ) then
    return query select false, 'No hay credenciales guardadas para este proveedor.';
    return;
  end if;

  if exists (
    select 1 from business_payment_credentials
    where business_id = p_business_id and provider = p_provider and is_active = true
      and (public_key_encrypted is null or public_key_encrypted = '')
  ) then
    return query select false, 'Public key vacía.';
    return;
  end if;

  return query select true, 'Credenciales válidas (formato correcto).';
end;
$$;

-- ----------------------------------------------------------------------------
-- 5. register_sale_payment_movements: Verificar que el usuario pertenece al negocio
-- ----------------------------------------------------------------------------
create or replace function public.register_sale_payment_movements(
  p_business_id uuid,
  p_branch_id uuid,
  p_sale_id text,
  p_amount numeric,
  p_payment_method text,
  p_cash_amount numeric,
  p_change numeric
)
returns table(income_id text, change_id text)
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Si hay un usuario autenticado, verificar que pertenece al negocio
  if auth.uid() is not null then
    if not exists (
      select 1
      from unnest(public.auth_business_ids()) AS bid
      WHERE bid = p_business_id
    ) then
      raise exception 'NOT_A_MEMBER: no perteneces a este negocio.';
    end if;
  end if;

  return query
  with payment_movements as (
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
    returning id, data->>'id' as income_id
  ),
  change_movement as (
    insert into cash_movements (business_id, branch_id, data)
    select p_business_id, p_branch_id, jsonb_build_object(
      'id', gen_random_uuid(),
      'type', 'OUT',
      'amount', p_change,
      'paymentMethod', 'CASH',
      'cashAmount', p_change,
      'saleId', p_sale_id,
      'createdAt', now()
    )
    where p_change > 0
    returning id, data->>'id' as change_id
  )
  select pm.income_id, cm.change_id
  from payment_movements pm
  left join change_movement cm on true;
end;
$$;

-- ============================================================================
-- FIN DE MIGRACIÓN DE SEGURIDAD
-- ============================================================================
