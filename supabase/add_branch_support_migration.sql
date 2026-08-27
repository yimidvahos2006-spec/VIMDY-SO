-- add_branch_support_migration.sql
-- ===========================================================================
-- Migración: agrega soporte de sucursales y business_invitations
-- Proyecto: VIMDY OS
-- Compatibilidad: segura de re-ejecutar (usa IF NOT EXISTS / OR REPLACE)
--
-- CORRECCIONES aplicadas sobre la versión original (revisión previa a
-- correr en producción):
--   1. Paso 3: se quitó la comparación "old.business_id / new.business_id"
--      dentro de la política RLS — old/new NO existen en USING/WITH CHECK
--      de una política, solo dentro de triggers. Tal como estaba escrito,
--      esto hacía fallar la migración completa con un error de sintaxis
--      en la primera tabla del loop. Si más adelante se quiere impedir que
--      alguien cambie el business_id de un registro existente vía UPDATE,
--      eso necesita un trigger BEFORE UPDATE aparte — no es parte de esta
--      migración, queda como mejora futura opcional.
--   2. Función accept_invitation: "auth.email" no es una columna válida
--      ahí (no fallaba al crear la función, pero sí la primera vez que se
--      usara de verdad). Se corrigió a "email", igual que ya estaba bien
--      escrito en la política business_invitations_self_accept.
--   3. Política business_invitations_admin_access usaba
--      "has_business_role(business_id, array['ADMIN'])", una función que
--      NO existe en este proyecto (habría fallado al aplicar la
--      migración). Se corrigió a "auth_role(business_id) = 'ADMIN'",
--      la función real ya usada en role_rls_migration.sql.
--
--   Verificado antes de aplicar (2026-08-13): la tabla branches y sus
--   funciones NO existen todavía en la base de datos real, así que el
--   Paso 1 de esta migración sí hace falta (no es redundante).
-- ===========================================================================

-- 1. Tabla branches
create table if not exists branches (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  name text not null,
  is_main boolean not null default false,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists branches_business_id_idx on branches (business_id);

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

create or replace function auth_branch_ids()
returns setof uuid
language sql
security definer
stable
as $$
  select id from branches where business_id in (select auth_business_ids());
$$;

alter table branches enable row level security;
drop policy if exists branches_tenant_isolation on branches;
create policy branches_tenant_isolation on branches
  for all
  using (business_id in (select auth_business_ids()))
  with check (business_id in (select auth_business_ids()));

-- 2. branch_id en tablas genéricas
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
    execute format('alter table %I add column if not exists branch_id uuid references branches(id) on delete set null;', store_name);
    execute format('create index if not exists %I on %I (branch_id);', store_name || '_branch_id_idx', store_name);
  end loop;
end $$;

-- 3. Recrear RLS policies para incluir branch_id
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
    execute format('
      drop policy if exists %I on %I;
      create policy %I on %I
        for all
        using (
          business_id in (select auth_business_ids())
          and (
            branch_id is null
            or branch_id in (select auth_branch_ids())
          )
        )
        with check (
          business_id in (select auth_business_ids())
          and (
            branch_id is null
            or branch_id in (select auth_branch_ids())
          )
        );
    ', store_name || '_tenant_isolation', store_name, store_name || '_tenant_isolation', store_name);
  end loop;
end $$;

-- 4. business_invitations
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

create index if not exists business_invitations_business_id_idx on business_invitations (business_id);
create index if not exists business_invitations_token_idx on business_invitations (token);
create index if not exists business_invitations_email_idx on business_invitations (email);
create index if not exists business_invitations_user_id_idx on business_invitations (user_id);

alter table business_invitations enable row level security;
drop policy if exists business_invitations_admin_access on business_invitations;
create policy business_invitations_admin_access on business_invitations
  for all
  using (
    business_id in (select auth_business_ids())
    and auth_role(business_id) = 'ADMIN'
  )
  with check (
    business_id in (select auth_business_ids())
    and auth_role(business_id) = 'ADMIN'
  );

drop policy if exists business_invitations_self_accept on business_invitations;
create policy business_invitations_self_accept on business_invitations
  for select
  using (
    email = (select email from auth.users where id = auth.uid())
    and expires_at > now()
    and accepted_at is null
  );

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

  if v_invitation.email != (select email from auth.users where id = auth.uid()) then
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

-- 5. Verificación final (no modifica datos, solo consultas)
-- Ejecutar estas consultas después de la migración para confirmar:
-- - SELECT table_name FROM information_schema.columns WHERE table_schema = 'public' AND column_name = 'branch_id';
-- - SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_name IN ('branches', 'business_invitations');