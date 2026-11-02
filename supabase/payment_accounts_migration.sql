-- ============================================================================
-- VIMDY OS — Migración: Cuentas de cobro y QR por negocio
-- ----------------------------------------------------------------------------
-- Cómo usarlo:
--   1. Supabase -> "SQL Editor" -> New query.
--   2. Pega TODO este archivo y dale "Run". Se puede correr varias veces.
--
-- Qué crea:
--   * business_payment_accounts: las cuentas (Nequi, Bancolombia, Daviplata,
--     Bre-B) donde el negocio recibe transferencias. Sirven para que el
--     Radar Antifraude sepa a qué cuentas pertenece cada negocio.
--   * RLS por negocio (auth_business_ids()). Cualquier miembro puede VER las
--     cuentas; solo el ADMIN puede crear, editar o borrar.
-- ============================================================================

create table if not exists business_payment_accounts (
  id               uuid primary key default gen_random_uuid(),
  business_id      uuid not null references businesses(id) on delete cascade,
  bank_name        text not null
                   check (bank_name in ('Nequi', 'Bancolombia', 'Daviplata', 'Bre-B')),
  account_number   text not null check (length(trim(account_number)) between 3 and 40),
  holder_name      text,
  -- true = QR universal / multi-cuenta (ej. Bre-B); false = cuenta o QR único.
  is_universal_qr  boolean not null default false,
  is_active        boolean not null default true,
  created_at       timestamptz not null default now()
);

create unique index if not exists business_payment_accounts_unique
  on business_payment_accounts (business_id, bank_name, account_number);

create index if not exists business_payment_accounts_business_idx
  on business_payment_accounts (business_id);

alter table business_payment_accounts enable row level security;

drop policy if exists business_payment_accounts_read on business_payment_accounts;
create policy business_payment_accounts_read on business_payment_accounts
  for select
  using (business_id in (select auth_business_ids()));

drop policy if exists business_payment_accounts_admin_write on business_payment_accounts;
create policy business_payment_accounts_admin_write on business_payment_accounts
  for all
  using (
    business_id in (select auth_business_ids())
    and public.has_business_role(business_id, array['ADMIN'])
  )
  with check (
    business_id in (select auth_business_ids())
    and public.has_business_role(business_id, array['ADMIN'])
  );

revoke all on business_payment_accounts from anon;
grant select, insert, update, delete on business_payment_accounts to authenticated;

-- Verificación: debe devolver 2 filas (las dos políticas).
select policyname from pg_policies
where tablename = 'business_payment_accounts'
order by policyname;