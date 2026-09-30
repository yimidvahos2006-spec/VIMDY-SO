-- ============================================================================
-- VIMDY OS — Migración inicial segura para Supabase
-- ============================================================================
-- INSTRUCCIONES DE USO:
-- 1. Abre Supabase Dashboard → SQL Editor
-- 2. Pega TODO este archivo
-- 3. Ejecuta
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. HABILITAR EXTENSIONES
-- ----------------------------------------------------------------------------
create extension if not exists "uuid-ossp";
create extension if not exists pgcrypto;

-- ----------------------------------------------------------------------------
-- 2. TABLAS BASE (sin dependencias entre sí)
-- ----------------------------------------------------------------------------
create table if not exists businesses (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  plan text not null default 'trial',
  trial_ends_at timestamptz,
  created_at timestamptz not null default now(),
  country text not null default 'CO',
  currency text not null default 'COP',
  language text not null default 'es',
  timezone text not null default 'America/Bogota',
  tax_rate numeric not null default 19,
  onboarding_completed boolean not null default false,
  business_type text,
  enabled_modules text[] not null default '{}',
  salida_cocina text not null default 'pantalla',
  trial_used_at timestamptz,
  renewal_date timestamptz,
  next_charge_at timestamptz,
  payment_method text,
  payment_status text not null default 'none',
  subscription_status text not null default 'trial'
);

create table if not exists branches (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  name text not null,
  is_main boolean not null default false,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists business_invitations (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  user_id uuid references auth.users(id) on delete cascade,
  email text not null,
  role text not null default 'MESERO',
  token text not null unique,
  invited_by uuid not null references auth.users(id) on delete cascade,
  expires_at timestamptz not null,
  accepted_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists business_members (
  user_id uuid not null references auth.users(id) on delete cascade,
  business_id uuid not null references businesses(id) on delete cascade,
  role text not null default 'MESERO',
  created_at timestamptz not null default now(),
  primary key (user_id, business_id)
);

create table if not exists user_trial_usage (
  user_id uuid primary key references auth.users(id) on delete cascade,
  business_id uuid not null references businesses(id) on delete cascade,
  plan text not null default 'trial',
  used_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create table if not exists subscription_payments (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  plan text not null,
  amount numeric not null,
  currency text not null default 'COP',
  status text not null,
  payment_method text,
  wompi_reference text,
  mercadopago_reference text,
  paypal_order_id text,
  paypal_capture_id text,
  idempotency_key text,
  renewal_number integer not null default 0,
  provider_refund_id text,
  refunded_at timestamptz,
  paid_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create table if not exists subscription_audit_log (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  action text not null,
  actor_type text not null default 'system',
  actor_id uuid,
  details jsonb not null default '{}'::jsonb,
  ip_address inet,
  created_at timestamptz not null default now()
);

-- ----------------------------------------------------------------------------
-- 3. FUNCIONES AUXILIARES (tablas base ya existen)
-- ----------------------------------------------------------------------------
create or replace function public.is_business_member(target_business_id uuid)
returns boolean
language sql
security definer
set search_path = public
as $$
  select exists(
    select 1 from business_members
    where business_id = target_business_id
      and user_id = auth.uid()
  );
$$;

create or replace function public.has_business_role(
  target_business_id uuid,
  allowed_roles text[]
)
returns boolean
language sql
security definer
set search_path = public
as $$
  select exists(
    select 1 from business_members
    where business_id = target_business_id
      and user_id = auth.uid()
      and role = any(allowed_roles)
  );
$$;

create or replace function auth_business_ids()
returns setof uuid
language sql
security definer
stable
as $$
  select business_id from business_members where user_id = auth.uid();
$$;

create or replace function auth_branch_ids()
returns setof uuid
language sql
security definer
stable
as $$
  select id from branches where business_id in (select auth_business_ids());
$$;

create or replace function public.is_business_subscription_active(p_business_id uuid)
returns boolean
language sql
security definer
stable
as $$
  select exists(
    select 1 from businesses
    where id = p_business_id
      and (
        subscription_status = 'trial'
        or subscription_status = 'monthly'
        or subscription_status = 'yearly'
      )
  );
$$;

create or replace function public.has_user_used_trial(p_user_id uuid)
returns boolean
language sql
security definer
stable
as $$
  select exists(
    select 1 from user_trial_usage
    where user_id = p_user_id
  );
$$;

create or replace function public.accept_invitation(p_token text)
returns uuid
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_invitation business_invitations;
  v_business_id uuid;
begin
  select * into v_invitation
  from business_invitations
  where token = p_token
    and accepted_at is null
    and expires_at > now()
  limit 1;

  if not found then
    raise exception 'INVITATION_NOT_FOUND_OR_EXPIRED' using errcode = 'P0002';
  end if;

  if v_invitation.email != (select auth.email from auth.users where id = auth.uid()) then
    raise exception 'INVITATION_EMAIL_MISMATCH' using errcode = 'P0002';
  end if;

  v_business_id := v_invitation.business_id;

  insert into business_members (user_id, business_id, role)
  values (auth.uid(), v_business_id, v_invitation.role)
  on conflict (user_id, business_id) do update set role = excluded.role;

  update business_invitations
  set accepted_at = now()
  where id = v_invitation.id;

  return v_business_id;
end;
$$;

revoke all on function public.accept_invitation(text) from public, anon;
grant execute on function public.accept_invitation(text) to authenticated;

create or replace function public.ensure_branch_for_business(p_business_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_branch_id uuid;
begin
  select id into v_branch_id
  from branches
  where business_id = p_business_id and is_main = true
  limit 1;

  if v_branch_id is not null then
    return v_branch_id;
  end if;

  insert into branches (business_id, name, is_main, active)
  values (p_business_id, 'Sucursal principal', true, true)
  returning id into v_branch_id;

  return v_branch_id;
end;
$$;

-- NOTA: register_sale_payment_movements se define al final porque inserta en
-- cash_movements, que se crea dentro del bloque DO $$ de tablas genéricas.

-- ----------------------------------------------------------------------------
-- 4. TABLAS GENÉRICAS DE DATOS (solo tablas, sin policies)
-- ----------------------------------------------------------------------------
do $$
declare
  store_name text;
  store_names text[] := array[
    'products', 'sales', 'customers', 'kitchen_orders', 'alerts',
    'inventory_movements', 'cash_movements', 'tables', 'orders',
    'shifts', 'roles', 'permissions', 'audit_logs', 'categories', 'suppliers',
    'business_snapshots', 'purchase_orders', 'waiters', 'receipts', 'notifications'
  ];
begin
  foreach store_name in array store_names loop
    execute format('create table if not exists %I (id uuid primary key default gen_random_uuid(),business_id uuid not null references businesses(id) on delete cascade,branch_id uuid references branches(id) on delete set null,version integer not null default 1,data jsonb not null,created_at timestamptz not null default now(),updated_at timestamptz not null default now());', store_name);
    execute format('create index if not exists %I on %I (business_id);', store_name || '_business_id_idx', store_name);
    execute format('alter table %I enable row level security;', store_name);
    execute format('grant all on %I to service_role;', store_name);
  end loop;
end $$;

-- ----------------------------------------------------------------------------
-- 5. TABLAS DEPENDIENTES (requieren products/sales/kitchen_orders)
-- ----------------------------------------------------------------------------
create table if not exists sale_items (
  id uuid primary key default gen_random_uuid(),
  sale_id uuid not null references sales(id) on delete cascade,
  product_id uuid not null references products(id) on delete cascade,
  quantity numeric not null,
  unit_price numeric not null,
  subtotal numeric not null,
  notes text,
  created_at timestamptz not null default now()
);

create table if not exists kitchen_order_items (
  id uuid primary key default gen_random_uuid(),
  kitchen_order_id uuid not null references kitchen_orders(id) on delete cascade,
  sale_item_id uuid not null references sale_items(id) on delete cascade,
  status text not null default 'pending',
  notes text,
  created_at timestamptz not null default now()
);

create table if not exists pending_sales (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  branch_id uuid not null references branches(id) on delete cascade,
  data jsonb not null,
  synced boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists pending_inventory_adjustments (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  data jsonb not null,
  synced boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists pending_table_operations (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  data jsonb not null,
  synced boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists pending_customer_operations (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  data jsonb not null,
  synced boolean not null default false,
  created_at timestamptz not null default now()
);

-- ----------------------------------------------------------------------------
-- 6. ÍNDICES ESPECÍFICOS
-- ----------------------------------------------------------------------------
create index if not exists branches_business_id_idx on branches (business_id);
create index if not exists business_invitations_business_id_idx on business_invitations (business_id);
create index if not exists business_invitations_token_idx on business_invitations (token);
create index if not exists business_invitations_email_idx on business_invitations (email);
create index if not exists business_invitations_user_id_idx on business_invitations (user_id);
create index if not exists subscription_payments_business_id_idx on subscription_payments (business_id);
create unique index if not exists subscription_payments_idempotency_key_unique on subscription_payments (business_id, idempotency_key) where idempotency_key is not null;
create unique index if not exists subscription_payments_wompi_reference_unique on subscription_payments (business_id, wompi_reference) where wompi_reference is not null;
create unique index if not exists subscription_payments_mercadopago_reference_unique on subscription_payments (business_id, mercadopago_reference) where mercadopago_reference is not null;
create unique index if not exists subscription_payments_paypal_order_id_unique on subscription_payments (business_id, paypal_order_id) where paypal_order_id is not null;
create index if not exists subscription_audit_log_business_id_idx on subscription_audit_log (business_id);
create index if not exists subscription_audit_log_action_idx on subscription_audit_log (action);
create index if not exists subscription_audit_log_created_at_idx on subscription_audit_log (created_at);
create index if not exists user_trial_usage_used_at_idx on user_trial_usage (used_at);

-- ----------------------------------------------------------------------------
-- 7. FUNCIONES QUE DEPENDEN DE TABLAS GENÉRICAS (cash_movements, etc.)
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
language sql
security definer
as $$
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
$$;

grant execute on function public.register_sale_payment_movements(uuid, uuid, text, numeric, text, numeric, numeric) to authenticated;

-- ----------------------------------------------------------------------------
-- 8. RLS Y POLICIES (funciones auxiliares ya existen)
-- ----------------------------------------------------------------------------
alter table businesses enable row level security;
drop policy if exists businesses_member_access on businesses;
create policy businesses_member_access on businesses
  for select
  using (id in (select auth_business_ids()));

drop policy if exists businesses_insert_own on businesses;
create policy businesses_insert_own on businesses
  for insert
  with check (
    auth.uid() is not null
    and not public.has_user_used_trial(auth.uid())
  );

drop policy if exists businesses_update_own on businesses;
create policy businesses_update_own on businesses
  for update
  using (
    id in (select auth_business_ids())
    and public.has_business_role(id, array['ADMIN'])
  )
  with check (
    id in (select auth_business_ids())
    and public.has_business_role(id, array['ADMIN'])
    and public.is_business_subscription_active(id)
  );

alter table business_members enable row level security;
drop policy if exists business_members_self_read on business_members;
create policy business_members_self_read on business_members
  for select
  using (user_id = auth.uid());

drop policy if exists business_members_self_insert on business_members;
create policy business_members_self_insert on business_members
  for insert
  with check (
    user_id = auth.uid()
    and exists (
      select 1 from business_invitations
      where business_id = business_members.business_id
        and (email = (select email from auth.users where id = auth.uid())
             or user_id = auth.uid())
        and accepted_at is null
        and expires_at > now()
    )
    and public.is_business_subscription_active(business_members.business_id)
  );

drop policy if exists business_members_update_role on business_members;
create policy business_members_update_role on business_members
  for update
  using (
    business_id in (select auth_business_ids())
    and public.has_business_role(business_id, array['ADMIN'])
    and public.is_business_subscription_active(business_id)
  )
  with check (
    business_id in (select auth_business_ids())
    and public.has_business_role(business_id, array['ADMIN'])
    and public.is_business_subscription_active(business_id)
  );

drop policy if exists business_members_delete_member on business_members;
create policy business_members_delete_member on business_members
  for delete
  using (
    business_id in (select auth_business_ids())
    and (
      public.has_business_role(business_id, array['ADMIN'])
      or user_id = auth.uid()
    )
    and public.is_business_subscription_active(business_id)
  );

alter table branches enable row level security;
drop policy if exists branches_tenant_read on branches;
create policy branches_tenant_read on branches
  for select
  using (business_id in (select auth_business_ids()));

drop policy if exists branches_tenant_insert on branches;
create policy branches_tenant_insert on branches
  for insert
  with check (
    business_id in (select auth_business_ids())
    and public.is_business_subscription_active(business_id)
  );

drop policy if exists branches_tenant_update on branches;
create policy branches_tenant_update on branches
  for update
  using (
    business_id in (select auth_business_ids())
    and public.has_business_role(business_id, array['ADMIN'])
  )
  with check (
    business_id in (select auth_business_ids())
    and public.is_business_subscription_active(business_id)
  );

drop policy if exists branches_tenant_delete on branches;
create policy branches_tenant_delete on branches
  for delete
  using (
    business_id in (select auth_business_ids())
    and public.has_business_role(business_id, array['ADMIN'])
    and public.is_business_subscription_active(business_id)
  );

alter table business_invitations enable row level security;
drop policy if exists business_invitations_admin_read on business_invitations;
create policy business_invitations_admin_read on business_invitations
  for select
  using (
    business_id in (select auth_business_ids())
    and public.has_business_role(business_id, array['ADMIN'])
  );

drop policy if exists business_invitations_admin_insert on business_invitations;
create policy business_invitations_admin_insert on business_invitations
  for insert
  with check (
    business_id in (select auth_business_ids())
    and public.has_business_role(business_id, array['ADMIN'])
    and public.is_business_subscription_active(business_id)
  );

drop policy if exists business_invitations_admin_update on business_invitations;
create policy business_invitations_admin_update on business_invitations
  for update
  using (
    business_id in (select auth_business_ids())
    and public.has_business_role(business_id, array['ADMIN'])
    and public.is_business_subscription_active(business_id)
  )
  with check (
    business_id in (select auth_business_ids())
    and public.has_business_role(business_id, array['ADMIN'])
    and public.is_business_subscription_active(business_id)
  );

drop policy if exists business_invitations_admin_delete on business_invitations;
create policy business_invitations_admin_delete on business_invitations
  for delete
  using (
    business_id in (select auth_business_ids())
    and public.has_business_role(business_id, array['ADMIN'])
    and public.is_business_subscription_active(business_id)
  );

drop policy if exists business_invitations_self_accept on business_invitations;
create policy business_invitations_self_accept on business_invitations
  for select
  using (
    email = (select email from auth.users where id = auth.uid())
    and expires_at > now()
    and accepted_at is null
  );

alter table subscription_payments enable row level security;
drop policy if exists subscription_payments_tenant_isolation on subscription_payments;
create policy subscription_payments_tenant_isolation on subscription_payments
  for select
  using (business_id in (select auth_business_ids()));

drop policy if exists subscription_payments_service_insert on subscription_payments;
create policy subscription_payments_service_insert on subscription_payments
  for insert
  with check (false);

alter table subscription_audit_log enable row level security;
drop policy if exists subscription_audit_log_tenant_isolation on subscription_audit_log;
create policy subscription_audit_log_tenant_isolation on subscription_audit_log
  for select
  using (business_id in (select auth_business_ids()));

drop policy if exists subscription_audit_log_service_insert on subscription_audit_log;
create policy subscription_audit_log_service_insert on subscription_audit_log
  for insert
  with check (false);

alter table user_trial_usage enable row level security;
drop policy if exists user_trial_usage_service_all on user_trial_usage;
create policy user_trial_usage_service_all on user_trial_usage
  for all
  using (false)
  with check (false);

do $$
declare
  store_name text;
  store_names text[] := array[
    'products', 'sales', 'customers', 'kitchen_orders', 'alerts',
    'inventory_movements', 'cash_movements', 'tables', 'orders',
    'shifts', 'roles', 'permissions', 'audit_logs', 'categories', 'suppliers',
    'business_snapshots', 'purchase_orders', 'waiters', 'receipts', 'notifications'
  ];
begin
  foreach store_name in array store_names loop
    execute format('alter table %I enable row level security;', store_name);
    execute format('drop policy if exists %I on %I;', store_name || '_tenant_read', store_name);
    execute format('create policy %I on %I for select using (business_id in (select auth_business_ids()) and (branch_id is null or branch_id in (select auth_branch_ids())));', store_name || '_tenant_read', store_name, store_name || '_tenant_read', store_name);
    execute format('drop policy if exists %I on %I;', store_name || '_tenant_insert', store_name);
    execute format('create policy %I on %I for insert with check (business_id in (select auth_business_ids()) and (branch_id is null or branch_id in (select auth_branch_ids())) and public.is_business_subscription_active(business_id));', store_name || '_tenant_insert', store_name, store_name || '_tenant_insert', store_name);
    execute format('drop policy if exists %I on %I;', store_name || '_tenant_update', store_name);
    execute format('create policy %I on %I for update using (business_id in (select auth_business_ids()) and (branch_id is null or branch_id in (select auth_branch_ids()))) with check (business_id in (select auth_business_ids()) and (branch_id is null or branch_id in (select auth_branch_ids())) and public.is_business_subscription_active(business_id));', store_name || '_tenant_update', store_name, store_name || '_tenant_update', store_name);
    execute format('drop policy if exists %I on %I;', store_name || '_tenant_delete', store_name);
    execute format('create policy %I on %I for delete using (business_id in (select auth_business_ids()) and (branch_id is null or branch_id in (select auth_branch_ids())) and public.is_business_subscription_active(business_id));', store_name || '_tenant_delete', store_name, store_name || '_tenant_delete', store_name);
    execute format('grant all on %I to service_role;', store_name);
  end loop;
end $$;

alter table sale_items enable row level security;
alter table kitchen_order_items enable row level security;
alter table pending_sales enable row level security;
alter table pending_inventory_adjustments enable row level security;
alter table pending_table_operations enable row level security;
alter table pending_customer_operations enable row level security;

-- ----------------------------------------------------------------------------
-- 8. GRANTS FINALES
-- ----------------------------------------------------------------------------
grant all on businesses to service_role;
grant all on business_members to service_role;
grant all on business_invitations to service_role;
grant all on branches to service_role;
grant all on subscription_payments to service_role;
grant select on subscription_payments to authenticated;
grant all on subscription_audit_log to service_role;
grant select on subscription_audit_log to authenticated;
grant all on user_trial_usage to service_role;
revoke all on user_trial_usage from authenticated, anon, public;
grant select on user_trial_usage to service_role;

grant all on sale_items to service_role;
grant all on kitchen_order_items to service_role;
grant all on pending_sales to service_role;
grant all on pending_inventory_adjustments to service_role;
grant all on pending_table_operations to service_role;
grant all on pending_customer_operations to service_role;

-- ----------------------------------------------------------------------------
-- FIN
-- ----------------------------------------------------------------------------
select 'Schema aplicado correctamente' as status;
