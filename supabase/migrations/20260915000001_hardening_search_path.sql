-- Migration: 20260915000001_hardening_search_path
-- Purpose: Fix "Function Search Path Mutable" warnings from Security Advisor
-- Adds SET search_path = public to auth_branch_ids(), check_branch_access(),
-- and re-affirms register_sale_payment_movements (already has it from 20260831).

-- IMPORTANT: Use CREATE OR REPLACE (not DROP CASCADE) to avoid breaking
-- dependent RLS policies and functions that call these helpers.

-- 0a. auth_branch_ids — add search_path
create or replace function public.auth_branch_ids()
returns uuid[]
language sql
stable
set search_path = public
as $$
  select coalesce(array_agg(b.id) filter (where b.id is not null), '{}')
  from branches b
  join business_members bm ON bm.business_id = b.business_id
  where bm.user_id = auth.uid()
    and b.business_id in (select auth_business_ids());
$$;
grant execute on function public.auth_branch_ids() to authenticated, service_role;
-- 0b. check_branch_access — add search_path
create or replace function public.check_branch_access(p_branch_id uuid)
returns void
language plpgsql
security invoker
set search_path = public
as $$
begin
  if p_branch_id is not null and auth.uid() is not null then
    if not exists (
      select 1 from unnest(public.auth_branch_ids()) AS bid WHERE bid = p_branch_id
    ) then
      raise exception 'NOT_A_BRANCH_MEMBER: sucursal no autorizada.';
    end if;
  end if;
end;
$$;
grant execute on function public.check_branch_access(uuid) to authenticated, service_role;
-- 0c. register_sale_payment_movements — re-affirm search_path
-- Already has SET search_path = public from 20260831_fix_idor_security_rpcs.sql,
-- but recreating to be certain it's set on the remote.
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
